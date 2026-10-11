#!/usr/bin/env python3
"""Transaction fault tests use an isolated SQLite PVC and fake Kubernetes API."""
import base64
import copy
from contextlib import closing
import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import unittest
from unittest import mock

import yaml

SPEC = importlib.util.spec_from_file_location("demo_backend", Path(__file__).with_name("backend.py"))
backend = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backend)
OLD = {"version": "v1.3.9", "commit": "a" * 40, "image": "ghcr.io/mss-boot-sys/mss-boot-admin@sha256:" + "1" * 64}
NEW = {"version": "v1.3.10", "commit": "b" * 40, "image": "ghcr.io/mss-boot-sys/mss-boot-admin@sha256:" + "2" * 64}


def request(action, transaction="gh-100-1", release=NEW):
    return {"action": action, "transaction": transaction, "release": copy.deepcopy(release)}


def fixture_deployment():
    path = Path(__file__).resolve().parents[2] / "deploy/demo/admin-demo.yaml"
    deployment = next(d for d in yaml.safe_load_all(path.read_text()) if d.get("kind") == "Deployment" and d["metadata"]["name"] == "admin-demo")
    pod = deployment["spec"]["template"]["spec"]
    pod["containers"][0]["image"] = OLD["image"]
    pod["initContainers"][0]["image"] = OLD["image"]
    return deployment


def fixture_secrets():
    config = {
        "database": {"driver": "sqlite", "source": "/app/data/admin.db?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate"},
        "application": {"origin": "https://demo.mss-boot-io.top"},
        "cache": {"redis": {"addr": "admin-demo-cache:6379", "password": "test-only-cache-value"}},
        "runtime": {"resources": {"main": {"provider": {"kind": "redis", "redis": {"mode": "standalone", "standalone": {"endpoint": "admin-demo-cache:6379"}, "credentials": {"kind": "password", "password": {"passwordRef": "env://MSS_RUNTIME_REDIS_PASSWORD"}}}}}}},
    }
    return {
        "admin-demo-config": {"type": "Opaque", "data": {"application.yml": base64.b64encode(yaml.safe_dump(config).encode()).decode()}},
        "admin-demo-cache-config": {"type": "Opaque", "data": {"password": base64.b64encode(b"test-only-cache-value").decode(), "redis.conf": base64.b64encode(b"test-only-config").decode()}},
    }


class FakeBackend(backend.Backend):
    def __init__(self, root, pvc):
        super().__init__(root)
        self.pvc = pvc
        self.live = fixture_deployment()
        self.secrets = fixture_secrets()
        self.helper_image = None
        self.executed = []
        self.fail_migration = False
        self.fail_backup = False
        self.fail_health = False
        self.identity_mismatch = False
        self.migration_count = 0

    def get(self, resource, name=None):
        if resource == "deployment":
            return copy.deepcopy(self.live)
        if resource == "secret":
            return copy.deepcopy(self.secrets[name])
        if resource == "pvc":
            return {"metadata": {"uid": "fixture-pvc"}, "status": {"phase": "Bound"}, "spec": {"accessModes": ["ReadWriteOnce"]}}
        if resource == "pods":
            return {"items": []}
        raise AssertionError(resource)

    def identity(self, image):
        release = OLD if image == OLD["image"] else NEW
        if self.identity_mismatch:
            release = OLD
        return f'mss-boot-admin {release["version"]} (commit {release["commit"]})'.encode()

    def command(self, args, **kwargs):
        self.executed.append((args, kwargs))
        if args[0] == "scale":
            self.live["spec"]["replicas"] = 0
        elif args[0] == "patch":
            patch = json.loads(kwargs["payload"])
            if args[1] == "deployment":
                assert args[3] == "--type=json"
                self.live["spec"] = patch[0]["value"]
            else:
                assert args[1] == "secret"
                self.secrets[args[2]] = patch
        elif args[0] == "exec":
            if args[-1] == "version":
                return self.identity(self.live["spec"]["template"]["spec"]["containers"][0]["image"])
            if self.fail_health:
                raise backend.Refused("test_health_failure")
        elif args[0] != "rollout":
            raise AssertionError(args)
        return b""

    def helper(self, image):
        self.helper_image = image
        pod = backend.maintenance_pod(self.state["deployment"], image, self.state["pod"])
        assert all(e["name"] != "MSS_ADMIN_INITIAL_PASSWORD" for e in pod["spec"]["containers"][0]["env"])

    def delete_helper(self):
        self.helper_image = None

    def execute(self, args, **kwargs):
        self.executed.append((args, kwargs))
        if args == ["/app/mss-boot-admin", "version"]:
            return self.identity(self.helper_image)
        if args[0] == "tar":
            assert self.live["spec"]["replicas"] == 0
            if self.fail_backup:
                raise backend.Refused("test_backup_failure")
            with tarfile.open(fileobj=kwargs["output"], mode="w:gz") as archive:
                archive.add(self.pvc, arcname=".")
            return b""
        script = args[-1]
        if "migrate --domain" in script:
            self.migration_count += 1
            self.pvc.joinpath("candidate-only").write_text("partial migration data")
            with closing(sqlite3.connect(self.pvc / "admin.db")) as database, database:
                database.execute("CREATE TABLE upgraded(value TEXT)")
                database.execute("INSERT INTO upgraded VALUES ('new schema')")
            if self.fail_migration:
                raise backend.Refused("test_migration_failure")
            self.pvc.joinpath(".migrated-" + NEW["version"]).write_text(NEW["commit"])
        elif "tar -xzf" in script:
            for child in self.pvc.iterdir():
                shutil.rmtree(child) if child.is_dir() else child.unlink()
            with tarfile.open(fileobj=kwargs["input_file"], mode="r:gz") as archive:
                archive.extractall(self.pvc, filter="data")
        elif "test -s" in script:
            backend.require((self.pvc / "admin.db").exists(), "missing_database")
        else:
            raise AssertionError(args)
        return b""


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "state"
        self.root.mkdir(mode=0o700)
        self.pvc = Path(self.temp.name) / "pvc"
        self.pvc.mkdir()
        with closing(sqlite3.connect(self.pvc / "admin.db")) as database, database:
            database.execute("CREATE TABLE users(username TEXT, password_hash TEXT)")
            database.execute("INSERT INTO users VALUES ('admin', 'existing-password-hash')")
        (self.pvc / "public").mkdir()
        (self.pvc / "public/upload.bin").write_bytes(b"persistent-user-upload")
        (self.pvc / ".migrated-v1.3.9").write_text(OLD["commit"])
        self.api = FakeBackend(self.root, self.pvc)
        self.original = copy.deepcopy(self.api.live)

    def assert_original_data(self):
        with closing(sqlite3.connect(self.pvc / "admin.db")) as database, database:
            self.assertEqual(database.execute("SELECT * FROM users").fetchall(), [("admin", "existing-password-hash")])
        self.assertEqual((self.pvc / "public/upload.bin").read_bytes(), b"persistent-user-upload")

    def test_upgrade_preserves_account_upload_and_retains_private_backup(self):
        receipt = self.api.handle(request("prepare"))
        self.assertEqual(receipt["state"], "prepared")
        self.assertEqual(self.api.live["spec"]["replicas"], 0)
        self.assertNotIn("secrets", receipt)
        self.api.handle(request("deploy"))
        self.assert_original_data()
        self.api.handle(request("commit"))
        self.assertFalse((self.root / "active.json").exists())
        self.assertTrue((self.root / "gh-100-1/data.tar.gz").is_file())
        self.assertEqual((self.root / "gh-100-1/state.json").stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.api.handle({"action": "status"})["state"], "committed")

    def test_partial_migration_failure_restores_whole_volume_and_old_spec(self):
        self.api.handle(request("prepare"))
        self.api.fail_migration = True
        with self.assertRaisesRegex(backend.Refused, "test_migration_failure"):
            self.api.handle(request("deploy"))
        self.api.handle(request("rollback"))
        self.assertEqual(self.api.live, self.original)
        self.assert_original_data()
        self.assertFalse((self.pvc / "candidate-only").exists())
        with closing(sqlite3.connect(self.pvc / "admin.db")) as database, database:
            self.assertEqual(database.execute("SELECT count(*) FROM sqlite_master WHERE name='upgraded'").fetchone()[0], 0)

    def test_rollback_keeps_lock_until_public_recovery_acknowledged(self):
        self.api.handle(request("prepare"))
        self.api.handle(request("deploy"))
        restored = self.api.handle(request("rollback"))
        self.assertEqual(restored["state"], "rollback_ready")
        self.assertTrue((self.root / "active.json").exists())
        self.assertEqual(self.api.handle({"action": "status"})["state"], "rollback_ready")
        with self.assertRaisesRegex(backend.Refused, "another_transaction_is_active"):
            self.api.handle(request("prepare", "gh-101-1"))
        before = len(self.api.executed)
        self.assertEqual(self.api.handle(request("rollback")), restored)
        self.assertEqual(len(self.api.executed), before)
        self.api.handle(request("finalize-rollback"))
        self.assertFalse((self.root / "active.json").exists())
        self.assertEqual(self.api.handle({"action": "status"})["state"], "rolled_back")
        self.assertEqual(self.api.handle(request("finalize-rollback"))["state"], "rolled_back")

    def test_rollback_acknowledgement_refused_before_restore(self):
        self.api.handle(request("prepare"))
        with self.assertRaisesRegex(backend.Refused, "rollback_not_ready"):
            self.api.handle(request("finalize-rollback"))
        self.assertTrue((self.root / "active.json").exists())

    def test_rollback_resets_only_dedicated_transient_cache(self):
        self.api.handle(request("prepare"))
        self.api.handle(request("deploy"))
        self.api.handle(request("rollback"))
        restarts = [args for args, _ in self.api.executed if args[:2] == ["rollout", "restart"]]
        self.assertEqual(restarts, [["rollout", "restart", "deployment/admin-demo-cache"]])
        self.assert_original_data()

    def test_frontend_failure_rollback_removes_candidate_annotations(self):
        self.api.handle(request("prepare"))
        self.api.handle(request("deploy"))
        self.api.handle(request("rollback"))
        self.assertEqual(self.api.live, self.original)
        self.assert_original_data()

    def test_incomplete_backup_can_resume_previous_server_without_restore(self):
        self.api.fail_backup = True
        with self.assertRaises(backend.Refused):
            self.api.handle(request("prepare"))
        self.api.handle(request("rollback"))
        self.assertEqual(self.api.live, self.original)
        self.assert_original_data()

    def test_digest_identity_failure_precedes_migration(self):
        self.api.handle(request("prepare"))
        self.api.identity_mismatch = True
        with self.assertRaisesRegex(backend.Refused, "candidate_binary_identity_mismatch"):
            self.api.handle(request("deploy"))
        self.assertEqual(self.api.migration_count, 0)

    def test_no_retry_of_partially_applied_migration(self):
        self.api.handle(request("prepare"))
        self.api.fail_migration = True
        with self.assertRaises(backend.Refused):
            self.api.handle(request("deploy"))
        with self.assertRaisesRegex(backend.Refused, "transaction_not_prepared"):
            self.api.handle(request("deploy"))
        self.assertEqual(self.api.migration_count, 1)

    def test_completed_phase_replay_is_safe_and_committed_rollback_refused(self):
        for action in ("prepare", "deploy", "commit"):
            self.assertEqual(self.api.handle(request(action)), self.api.handle(request(action)))
        self.assertEqual(self.api.migration_count, 1)
        with self.assertRaisesRegex(backend.Refused, "transaction_already_finished"):
            self.api.handle(request("rollback"))

    def test_active_transaction_blocks_other_run_and_release_rebinding(self):
        self.api.handle(request("prepare"))
        with self.assertRaisesRegex(backend.Refused, "another_transaction_is_active"):
            self.api.handle(request("prepare", "gh-101-1"))
        with self.assertRaisesRegex(backend.Refused, "transaction_release_mismatch"):
            self.api.handle(request("deploy", release=OLD))

    def test_tampered_backup_keeps_server_stopped(self):
        self.api.handle(request("prepare"))
        (self.root / "gh-100-1/data.tar.gz").write_bytes(b"invalid archive")
        with self.assertRaisesRegex(backend.Refused, "backup_checksum_mismatch"):
            self.api.handle(request("rollback"))
        self.assertEqual(self.api.live["spec"]["replicas"], 0)
        self.assertTrue((self.root / "active.json").exists())

    def test_config_change_fails_before_deploy(self):
        self.api.handle(request("prepare"))
        self.api.secrets["admin-demo-config"]["data"]["application.yml"] = "changed"
        with self.assertRaisesRegex(backend.Refused, "configuration_changed_during_transaction"):
            self.api.handle(request("deploy"))
        self.assertEqual(self.api.migration_count, 0)

    def test_foreign_database_is_rejected_before_server_is_stopped(self):
        secret = self.api.secrets["admin-demo-config"]
        config = yaml.safe_load(base64.b64decode(secret["data"]["application.yml"]))
        config["database"]["driver"] = "postgres"
        secret["data"]["application.yml"] = base64.b64encode(yaml.safe_dump(config).encode()).decode()
        with self.assertRaisesRegex(backend.Refused, "demo_database_must_be_sqlite"):
            self.api.handle(request("prepare"))
        self.assertEqual(self.api.live["spec"]["replicas"], 1)

    def test_orphaned_preparing_state_only_allows_rollback(self):
        self.api.handle(request("prepare"))
        (self.root / "active.json").unlink()
        with self.assertRaisesRegex(backend.Refused, "transaction_lock_missing"):
            self.api.handle(request("deploy"))
        self.api.handle(request("rollback"))
        self.assertEqual(self.api.live, self.original)

    def test_empty_pvc_is_not_initialized(self):
        (self.pvc / "admin.db").unlink()
        with self.assertRaisesRegex(backend.Refused, "missing_database"):
            self.api.handle(request("prepare"))
        self.assertEqual(self.api.migration_count, 0)

    def test_downgrade_and_mutable_same_version_refused(self):
        for release in (dict(OLD, version="v1.3.8"), dict(OLD, commit="c" * 40), dict(OLD, image=NEW["image"])):
            with self.assertRaises(backend.Refused):
                backend.validate_upgrade(OLD, release)
        backend.validate_upgrade(OLD, OLD)
        backend.validate_upgrade(OLD, NEW)

    def test_rejects_path_shell_namespace_and_unpinned_images(self):
        for key, value in (("transaction", "../escape"), ("transaction", "x;id"), ("version", "v1.3.9;id"), ("commit", "main"), ("image", "ghcr.io/elsewhere/image@sha256:" + "1" * 64)):
            req = request("prepare")
            (req if key == "transaction" else req["release"])[key] = value
            with self.assertRaises(backend.Refused):
                backend.validate_request(req)
        req = request("prepare")
        req["namespace"] = "production"
        with self.assertRaises(backend.Refused):
            backend.validate_request(req)

    def test_helper_never_inherits_initial_password_host_mount_or_token(self):
        pod = backend.maintenance_pod(self.original, NEW["image"], "admin-demo-maint-test")
        self.assertFalse(pod["spec"]["automountServiceAccountToken"])
        self.assertNotIn("hostPath", json.dumps(pod))
        self.assertNotIn("MSS_ADMIN_INITIAL_PASSWORD", json.dumps(pod))
        self.assertEqual(pod["metadata"]["namespace"], "mss-admin-demo")

    def test_public_manifest_cannot_recreate_initialization(self):
        path = Path(__file__).resolve().parents[2] / "deploy/demo/admin-demo.yaml"
        documents = list(yaml.safe_load_all(path.read_text()))
        self.assertFalse(any(d.get("kind") == "Job" for d in documents))
        self.assertNotIn("MSS_ADMIN_INITIAL_PASSWORD", path.read_text())

    def test_raw_subprocess_error_and_secret_never_escape(self):
        api = backend.Backend(self.root)
        failure = subprocess.CompletedProcess([], 1, stdout=b"secret body", stderr=b"private-password")
        with mock.patch.object(backend.subprocess, "run", return_value=failure) as run:
            with self.assertRaisesRegex(backend.Refused, "^cluster_command_failed$"):
                api.command(["get", "secret", "admin-demo-config"])
        args = run.call_args.args[0]
        self.assertEqual(args[:3], ["kubectl", "--namespace", "mss-admin-demo"])
        self.assertNotIn("shell", run.call_args.kwargs)

    def test_version_parser_accepts_verified_binary_output(self):
        for label in ("mss-boot-admin ", "mss-boot-admin version "):
            identity = backend.binary_identity(("欢迎使用 \x1b[0;0;32m" + label + OLD["version"] + " (commit " + OLD["commit"] + ")\x1b[0m").encode())
            self.assertEqual(identity, {"version": OLD["version"], "commit": OLD["commit"]})


if __name__ == "__main__":
    unittest.main()
