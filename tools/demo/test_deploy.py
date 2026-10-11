import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import tarfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deploy
from cloudflare import CloudflareError, EXCEPTIONS, HOST, WORKER, validate_routes, verify_assets
from verify_live import VerificationError, normalize_edge_html, BEACON_URL, BEACON_INTEGRITY

RELEASE = {"schema_version": 1, "repository": "mss-boot-sys/mss-boot-admin", "version": "v1.3.9",
           "commit": "a" * 40, "image": "ghcr.io/mss-boot-sys/mss-boot-admin@sha256:" + "b" * 64,
           "digest": "sha256:" + "b" * 64,
           "frontend": {"assets_dir": ".mss/run/test-assets"}}
PREVIOUS = {"version_id": "11111111-1111-4111-8111-111111111111", "routes": [], "subdomain": {}}
NEW_VERSION = "22222222-2222-4222-8222-222222222222"


class FakeCloudflare:
    def __init__(self, events, fail=None):
        self.events, self.fail = events, fail
        self.version = PREVIOUS["version_id"]

    def snapshot(self):
        self.events.append("snapshot")
        return {**copy.deepcopy(PREVIOUS), "version_id": self.version}

    def stage(self, *args):
        self.events.append("stage")
        if self.fail == "stage":
            raise CloudflareError("stage failed")
        return NEW_VERSION

    def assert_boundaries(self, *args):
        self.events.append("boundaries")
        return {**copy.deepcopy(PREVIOUS), "version_id": self.version}

    def assert_public_identity(self, release):
        self.events.append("identity")

    def activate(self, version, message):
        action = "frontend" if version == NEW_VERSION else "frontend-rollback"
        self.events.append(action)
        self.version = version
        if self.fail == action:
            raise CloudflareError("activate failed")
        return {"version_id": version}


class FakeBackend:
    def __init__(self, events, fail=None):
        self.events, self.fail = events, fail
        self.state = {"ok": True, "state": "idle"}

    def call(self, action, transaction=None, release=None):
        self.events.append(action)
        if action == "status":
            return copy.deepcopy(self.state)
        if action == "prepare" and self.fail != "prepare-rejected":
            self.state = {"ok": True, "state": "preparing", "transaction": transaction,
                          "previous": {key: RELEASE[key] for key in ("version", "commit", "image")}}
        if action == self.fail or (action == "prepare" and self.fail == "prepare-rejected"):
            raise deploy.DeploymentError("injected backend failure")
        if action == "commit":
            self.state["state"] = "committed"
        if action == "rollback":
            self.state["state"] = "rollback_ready"
        if action == "finalize-rollback":
            self.state["state"] = "rolled_back"
        return copy.deepcopy(self.state)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.events = []
        self.cf = FakeCloudflare(self.events)
        self.backend = FakeBackend(self.events)
        self.addCleanup(patch.stopall)
        patch.object(deploy.time, "sleep").start()

    def run_deploy(self, verify=None):
        def ok(*args):
            self.events.append("verify")
            return {"ok": True}
        return deploy.deploy(self.cf, self.backend, copy.deepcopy(RELEASE), self.directory, "gh-123-1", verify or ok)

    def receipt(self):
        return json.loads((self.directory / "receipt.json").read_text())

    def test_stages_before_backup_and_commits_only_after_both_components_verify(self):
        self.assertEqual(self.run_deploy()["phase"], "committed")
        self.assertLess(self.events.index("stage"), self.events.index("prepare"))
        self.assertLess(self.events.index("prepare"), self.events.index("deploy"))
        self.assertLess(self.events.index("deploy"), self.events.index("frontend"))
        self.assertLess(self.events.index("frontend"), self.events.index("verify"))
        self.assertLess(self.events.index("verify"), self.events.index("commit"))

    def test_staging_failure_never_stops_backend(self):
        self.cf.fail = "stage"
        with self.assertRaises(CloudflareError):
            self.run_deploy()
        self.assertNotIn("prepare", self.events)
        self.assertNotIn("frontend-rollback", self.events)

    def test_backup_failure_after_server_started_is_recovered(self):
        self.backend.fail = "prepare"
        with self.assertRaises(deploy.DeploymentError):
            self.run_deploy()
        self.assertEqual(self.receipt()["phase"], "rolled_back")
        self.assertIn("rollback", self.events)

    def test_rejected_prepare_does_not_rollback_another_transaction(self):
        self.backend.fail = "prepare-rejected"
        with self.assertRaises(deploy.DeploymentError):
            self.run_deploy()
        self.assertEqual(self.receipt()["phase"], "aborted")
        self.assertNotIn("rollback", self.events)
        self.assertNotIn("frontend-rollback", self.events)

    def test_backend_deploy_failure_restores_both_components(self):
        self.backend.fail = "deploy"
        with self.assertRaises(deploy.DeploymentError):
            self.run_deploy()
        self.assertEqual(self.receipt()["phase"], "rolled_back")
        self.assertNotIn("frontend-rollback", self.events)
        self.assertIn("rollback", self.events)

    def test_lost_frontend_activation_response_still_restores_previous_version(self):
        self.cf.fail = "frontend"
        with self.assertRaises(CloudflareError):
            self.run_deploy()
        self.assertEqual(self.receipt()["phase"], "rolled_back")

    def test_live_verification_failure_never_commits_and_restores_database(self):
        def fail(*args):
            if len(args) > 1:
                raise VerificationError("live contract failed")
            return {"ok": True}
        with self.assertRaises(VerificationError):
            self.run_deploy(fail)
        self.assertNotIn("commit", self.events)
        self.assertEqual(self.receipt()["phase"], "rolled_back")

    def test_frontend_rollback_failure_does_not_skip_database_restore(self):
        self.cf.fail = "frontend-rollback"
        def fail(*args):
            raise VerificationError("verification failed")
        with self.assertRaisesRegex(deploy.DeploymentError, "operator recovery: frontend"):
            self.run_deploy(fail)
        self.assertIn("rollback", self.events)
        self.assertNotIn("finalize-rollback", self.events)
        self.assertEqual(self.backend.state["state"], "rollback_ready")
        self.assertEqual(self.receipt()["phase"], "rollback_failed")
        other = self.directory / "next"
        other.mkdir()
        with self.assertRaisesRegex(deploy.DeploymentError, "unfinished"):
            deploy.deploy(self.cf, self.backend, copy.deepcopy(RELEASE), other, "gh-124-1", lambda *args: {"ok": True})

    def test_remote_commit_receipt_wins_over_lost_ssh_response(self):
        self.run_deploy()
        receipt = self.receipt()
        receipt["phase"] = "verified"
        self.events.clear()
        result = deploy.rollback(self.cf, self.backend, receipt, self.directory / "receipt.json")
        self.assertEqual(result["phase"], "committed")
        self.assertEqual(self.events, ["status"])

    def test_existing_active_transaction_blocks_staging(self):
        self.backend.state = {"ok": True, "state": "prepared", "transaction": "other"}
        with self.assertRaisesRegex(deploy.DeploymentError, "unfinished"):
            self.run_deploy()
        self.assertNotIn("stage", self.events)

    def test_rollback_pair_is_refreshed_after_backend_lock(self):
        original = self.backend.call
        newer = "33333333-3333-4333-8333-333333333333"
        def interleaved(action, *args):
            if action == "prepare":
                self.cf.version = newer
            return original(action, *args)
        self.backend.call = interleaved
        result = self.run_deploy()
        self.assertEqual(result["previous_frontend"]["version_id"], newer)

    def test_recovery_waits_for_inflight_remote_operation_without_replaying_mutations(self):
        calls = iter([deploy.BackendBusy("busy"), {"state": "prepared"}])
        def call(action):
            self.assertEqual(action, "status")
            value = next(calls)
            if isinstance(value, Exception):
                raise value
            return value
        self.backend.call = call
        self.assertEqual(deploy.backend_status(self.backend)["state"], "prepared")

    def test_committed_repeat_does_not_redeploy(self):
        self.run_deploy()
        self.events.clear()
        self.assertEqual(self.run_deploy()["phase"], "committed")
        self.assertEqual(self.events, [])

    def test_manifest_rejects_mutable_image_or_foreign_repository(self):
        for key, value in (("image", "ghcr.io/mss-boot-sys/mss-boot-admin:v1.3.9"),
                           ("repository", "other/repository"), ("version", "v1.3.9-rc.1")):
            invalid = {**RELEASE, key: value}
            with self.subTest(key=key), self.assertRaises(deploy.DeploymentError):
                deploy.validate_release(invalid)

    def test_state_path_cannot_escape_repository(self):
        with self.assertRaises(deploy.DeploymentError):
            deploy.safe_path("/tmp/demo-state")


class RouteTests(unittest.TestCase):
    def routes(self):
        return [{"id": "root", "pattern": HOST + "/*", "script": WORKER}] + [
            {"id": str(index), "pattern": HOST + path, "script": None} for index, path in enumerate(EXCEPTIONS)]

    def test_all_six_bypass_routes_required(self):
        for index in range(1, 7):
            routes = self.routes()
            del routes[index]
            with self.subTest(index=index), self.assertRaises(CloudflareError):
                validate_routes(routes)

    def test_worker_on_an_api_route_is_rejected(self):
        routes = self.routes()
        routes[1]["script"] = WORKER
        with self.assertRaises(CloudflareError):
            validate_routes(routes)


class IntegrityTests(unittest.TestCase):
    def test_local_js_tamper_is_rejected_against_immutable_archive(self):
        parent = deploy.ROOT / ".mss/run"
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as name:
            directory = Path(name)
            assets = directory / "assets"
            assets.mkdir()
            files = {"index.html": b"<html></html>", "app.js": b"official",
                     "release.json": json.dumps({"application": "mss-boot-admin-antd-v6",
                                                 "version": RELEASE["version"], "commit": RELEASE["commit"]}).encode()}
            archive = directory / "dist-v6.tar.gz"
            with tarfile.open(archive, "w:gz") as stream:
                for path, body in files.items():
                    info = tarfile.TarInfo("dist/" + path)
                    info.size = len(body)
                    stream.addfile(info, io.BytesIO(body))
                    (assets / path).write_bytes(body)
            release = {**RELEASE, "frontend": {"archive": str(archive),
                       "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}}
            verify_assets(assets, release)
            (assets / "app.js").write_bytes(b"tampered")
            with self.assertRaisesRegex(CloudflareError, "differ"):
                verify_assets(assets, release)

    def beacon(self):
        return (f'<script type="module" src="{BEACON_URL}" integrity="{BEACON_INTEGRITY}" '
                'data-cf-beacon=\'{"version":"2024.11.0","token":"' + 'a' * 32 +
                '","r":1,"spa":2}\' crossorigin="anonymous"></script>\n')

    def test_only_pinned_edge_beacon_can_be_normalized(self):
        original = b"<html><body>official\n</body></html>"
        injected = original.replace(b"</body>", self.beacon().encode() + b"</body>")
        self.assertEqual(normalize_edge_html(injected), original)
        for changed in (injected.replace(BEACON_URL.encode(), b"https://evil.invalid/script.js"),
                        injected.replace(b'sha512-', b'sha256-'),
                        injected.replace(b'type="module"', b'type="module" onload="evil()"')):
            with self.subTest(value=changed), self.assertRaises(VerificationError):
                normalize_edge_html(changed)

    def test_other_host_routes_untouched_but_new_demo_override_rejected(self):
        routes = RouteTests().routes() + [{"id": "other", "pattern": "other.example/*", "script": "other"}]
        self.assertEqual(len(validate_routes(routes)), 7)
        routes.append({"id": "extra", "pattern": HOST + "/admin/api/*", "script": "other"})
        with self.assertRaises(CloudflareError):
            validate_routes(routes)


if __name__ == "__main__":
    unittest.main()
