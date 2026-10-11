#!/usr/bin/env python3
"""Offline policy, digest, archive confinement, and replay regression tests."""

import copy
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import resolve_release as resolver


VERSION = "v1.3.9"
COMMIT = "1" * 40
MAIN = "2" * 40


def encoded(value):
    return json.dumps(value, sort_keys=True).encode()


def archive(extra=(), *, version=VERSION, commit=COMMIT):
    entries = [("dist/index.html", b"<!doctype html>"),
               ("dist/release.json", encoded({"application": "mss-boot-admin-antd-v6",
                                               "version": version, "commit": commit}))]
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w:gz") as handle:
        for name, content in entries + list(extra):
            if isinstance(content, tarfile.TarInfo):
                handle.addfile(content)
            else:
                info = tarfile.TarInfo(name)
                info.size = len(content)
                handle.addfile(info, io.BytesIO(content))
    return data.getvalue()


def frontend_files(data=None):
    files = {"dist-v6.tar.gz": data or archive(), "FRONTEND-V6-BUILD-INFO":
             f"application=mss-boot-admin-antd-v6\nversion={VERSION}\ncommit={COMMIT}\n".encode()}
    files["SHA256SUMS.frontend-v6"] = "".join(
        f"{resolver.sha256(content)}  {name}\n" for name, content in files.items()).encode()
    return files


class FakeGitHub:
    def __init__(self):
        self.responses = {}
        self.files = frontend_files()
        self.assets = {}
        root_names = {"SHA256SUMS", f"SHA256SUMS.tools-{VERSION}", "install-mss.sh", "install-mss.ps1"}
        for platform in ("linux", "darwin", "windows"):
            for arch in ("amd64", "arm64"):
                root_names.add(f"mss-boot-admin-{platform}-{arch}.zip")
                root_names.add(f"mss-tools-{VERSION}-{platform}-{arch}." + ("zip" if platform == "windows" else "tar.gz"))
        for component, (prefix, workflow) in resolver.COMPONENTS.items():
            tag = f"{prefix}{VERSION}"
            safe = resolver.quote(tag, safe="")
            self.responses[f"git/ref/tags/{safe}"] = {"ref": f"refs/tags/{tag}", "object": {"type": "commit", "sha": COMMIT}}
            names = root_names if component == "root" else self.files if component == "frontend" else []
            assets = []
            for name in names:
                content = self.files.get(name, b"fixture")
                identity = len(self.assets) + 1
                self.assets[identity] = content
                assets.append({"name": name, "id": identity, "state": "uploaded", "size": len(content),
                               "digest": "sha256:" + resolver.sha256(content)})
            self.responses[f"releases/tags/{safe}"] = {"id": len(self.responses), "tag_name": tag,
                  "target_commitish": COMMIT, "draft": False, "prerelease": False,
                  "published_at": "2026-10-11T00:00:00Z", "assets": assets}
            self.add_workflow(workflow, tag)
        self.add_workflow("container.yml", VERSION)
        self.responses["git/ref/heads/main"] = {"object": {"sha": MAIN}}
        self.responses[f"compare/{COMMIT}...{MAIN}"] = {"status": "ahead", "merge_base_commit": {"sha": COMMIT}}

    def add_workflow(self, workflow, tag):
        query = resolver.urlencode({"head_sha": COMMIT, "event": "push", "per_page": 100})
        self.responses[f"actions/workflows/{workflow}/runs?{query}"] = {"workflow_runs": [
            {"id": len(self.responses), "head_sha": COMMIT, "head_branch": tag,
             "path": f".github/workflows/{workflow}", "event": "push", "run_number": 1,
             "run_attempt": 1, "status": "completed", "conclusion": "success",
             "actor": {"login": "mss-boot-sys"}, "triggering_actor": {"login": "mss-boot-sys"}}
        ]}

    def get(self, path):
        if path not in self.responses:
            raise resolver.NotReady("Missing fixture resource")
        return self.responses[path]

    def asset(self, asset):
        return self.assets[asset["id"]]

    def workflow(self, name):
        return next(value["workflow_runs"][0] for path, value in self.responses.items()
                    if path.startswith(f"actions/workflows/{name}/"))


class FakeRegistry(resolver.Registry):
    def __init__(self):
        self.objects = {}
        manifests = []
        for arch in ("amd64", "arm64"):
            config = {"architecture": arch, "os": "linux", "config": {"Labels": {
                "org.opencontainers.image.version": VERSION,
                "org.opencontainers.image.revision": COMMIT,
                "org.opencontainers.image.source": f"https://github.com/{resolver.REPOSITORY}",
            }}}
            config_digest = self.add("blobs", config)
            manifest_digest = self.add("manifests", {"schemaVersion": 2, "config": {"digest": config_digest}})
            manifests.append({"digest": manifest_digest, "platform": {"os": "linux", "architecture": arch}})
        self.index = {"schemaVersion": 2, "mediaType": "application/vnd.oci.image.index.v1+json", "manifests": manifests}
        self.digest = self.add("manifests", self.index)
        self.objects[f"manifests/{VERSION}"] = self.objects[f"manifests/{self.digest}"]

    def add(self, kind, value):
        data = encoded(value)
        digest = "sha256:" + resolver.sha256(data)
        self.objects[f"{kind}/{digest}"] = (data, {"docker-content-digest": digest})
        return digest

    def fetch(self, path, *, media=True):
        return self.objects[path]


class ReleaseIdentityTests(unittest.TestCase):
    def setUp(self):
        self.github = FakeGitHub()

    def test_complete_release_resolves(self):
        manifest, files = resolver.resolve(self.github, FakeRegistry(), VERSION)
        self.assertEqual(manifest["commit"], COMMIT)
        self.assertEqual(manifest["remote_main"], MAIN)
        self.assertEqual(set(manifest["workflow_runs"]), {"root", "framework", "admin", "frontend", "container"})
        self.assertEqual(manifest["frontend"]["file_count"], 2)
        self.assertIn("@sha256:", manifest["image"])
        self.assertEqual(files, self.github.files)

    def test_stable_version_only(self):
        for version in ("latest", "v1.3.9-rc.1", "v01.3.9", "v1.3.9;id", "web/antd-v6/v1.3.9"):
            with self.subTest(version=version), self.assertRaises(resolver.InvalidRelease):
                resolver.metadata(self.github, version)

    def test_component_tag_mismatch_fails_closed(self):
        self.github.responses["git/ref/tags/admin%2Fv1.3.9"]["object"]["sha"] = MAIN
        with self.assertRaisesRegex(resolver.InvalidRelease, "same source commit"):
            resolver.metadata(self.github, VERSION)

    def test_annotated_tag_peels_to_commit(self):
        self.github.responses["git/ref/tags/v1.3.9"]["object"] = {"type": "tag", "sha": MAIN}
        self.github.responses[f"git/tags/{MAIN}"] = {"object": {"type": "commit", "sha": COMMIT}}
        self.assertEqual(resolver.tag_commit(self.github, VERSION), COMMIT)

    def test_source_must_be_ancestor_of_current_remote_main(self):
        self.github.responses[f"compare/{COMMIT}...{MAIN}"]["status"] = "diverged"
        with self.assertRaisesRegex(resolver.InvalidRelease, "remote main"):
            resolver.metadata(self.github, VERSION)

    def test_root_release_and_container_both_required(self):
        for workflow in ("release.yml", "container.yml"):
            with self.subTest(workflow=workflow):
                github = FakeGitHub()
                github.workflow(workflow)["status"] = "in_progress"
                with self.assertRaises(resolver.NotReady):
                    resolver.metadata(github, VERSION)

    def test_completed_failed_workflow_is_not_retried(self):
        self.github.workflow("container.yml")["conclusion"] = "failure"
        with self.assertRaisesRegex(resolver.InvalidRelease, "publication failed"):
            resolver.metadata(self.github, VERSION)

    def test_latest_attempt_cannot_reuse_older_success(self):
        run = self.github.workflow("container.yml")
        failed = copy.deepcopy(run)
        failed.update({"run_attempt": 2, "conclusion": "failure"})
        next(value for path, value in self.github.responses.items() if path.startswith("actions/workflows/container.yml/"))["workflow_runs"].append(failed)
        with self.assertRaisesRegex(resolver.InvalidRelease, "publication failed"):
            resolver.metadata(self.github, VERSION)

    def test_wrong_tag_workflow_does_not_count(self):
        self.github.workflow("container.yml")["head_branch"] = "other"
        with self.assertRaises(resolver.NotReady):
            resolver.metadata(self.github, VERSION)

    def test_publication_requires_release_operator(self):
        self.github.workflow("container.yml")["triggering_actor"]["login"] = "someone-else"
        with self.assertRaisesRegex(resolver.InvalidRelease, "release operator"):
            resolver.metadata(self.github, VERSION)

    def test_source_run_must_match_root_publication(self):
        with self.assertRaisesRegex(resolver.InvalidRelease, "Triggering run"):
            resolver.metadata(self.github, VERSION, 123456)

    def test_draft_is_not_ready_and_prerelease_is_invalid(self):
        release = self.github.responses["releases/tags/v1.3.9"]
        release["draft"] = True
        with self.assertRaises(resolver.NotReady):
            resolver.metadata(self.github, VERSION)
        release.update({"draft": False, "prerelease": True})
        with self.assertRaises(resolver.InvalidRelease):
            resolver.metadata(self.github, VERSION)

    def test_incomplete_root_assets_are_not_ready(self):
        self.github.responses["releases/tags/v1.3.9"]["assets"].pop()
        with self.assertRaisesRegex(resolver.NotReady, "Root artifact set"):
            resolver.metadata(self.github, VERSION)

    def test_upload_still_in_progress_is_not_ready(self):
        self.github.responses["releases/tags/v1.3.9"]["assets"][0]["state"] = "new"
        with self.assertRaisesRegex(resolver.NotReady, "upload to complete"):
            resolver.metadata(self.github, VERSION)


class RegistryTests(unittest.TestCase):
    def test_all_config_and_manifest_bytes_are_verified(self):
        registry = FakeRegistry()
        for path in registry.objects:
            if path.startswith("blobs/"):
                data, headers = registry.objects[path]
                registry.objects[path] = (data + b" ", headers)
                break
        with self.assertRaisesRegex(resolver.InvalidRelease, "content digest mismatch"):
            registry.resolve(VERSION, COMMIT)

    def test_wrong_version_and_commit_are_rejected(self):
        with self.assertRaisesRegex(resolver.InvalidRelease, "commit differs"):
            FakeRegistry().resolve(VERSION, MAIN)

    def test_tag_digest_header_is_verified(self):
        registry = FakeRegistry()
        data, _ = registry.objects[f"manifests/{VERSION}"]
        registry.objects[f"manifests/{VERSION}"] = (data, {"docker-content-digest": "sha256:" + "0" * 64})
        with self.assertRaisesRegex(resolver.InvalidRelease, "tag digest mismatch"):
            registry.resolve(VERSION, COMMIT)

    def test_missing_platform_and_duplicate_platform_are_rejected(self):
        for mode in ("missing", "duplicate"):
            with self.subTest(mode=mode):
                registry = FakeRegistry()
                if mode == "missing":
                    registry.index["manifests"].pop()
                else:
                    registry.index["manifests"].append(registry.index["manifests"][0])
                digest = registry.add("manifests", registry.index)
                registry.objects[f"manifests/{VERSION}"] = registry.objects[f"manifests/{digest}"]
                with self.assertRaises(resolver.InvalidRelease):
                    registry.resolve(VERSION, COMMIT)

    def test_github_asset_digest_is_verified(self):
        github = resolver.GitHub()
        asset = {"id": 10, "size": 5, "name": "fixture", "digest": "sha256:" + "0" * 64}
        with patch.object(github, "raw", return_value=b"bytes"), self.assertRaisesRegex(resolver.InvalidRelease, "SHA256 mismatch"):
            github.asset(asset)


class FrontendTests(unittest.TestCase):
    def test_checksum_corruption(self):
        files = frontend_files()
        files["dist-v6.tar.gz"] += b"unexpected"
        with self.assertRaisesRegex(resolver.InvalidRelease, "checksum mismatch"):
            resolver.verify_frontend(files, VERSION, COMMIT)

    def test_embedded_commit_is_verified_independently(self):
        files = frontend_files(archive(commit=MAIN))
        with self.assertRaisesRegex(resolver.InvalidRelease, "release.json"):
            resolver.verify_frontend(files, VERSION, COMMIT)

    def test_build_info_commit_is_verified_independently(self):
        files = frontend_files()
        files["FRONTEND-V6-BUILD-INFO"] = files["FRONTEND-V6-BUILD-INFO"].replace(COMMIT.encode(), MAIN.encode())
        files["SHA256SUMS.frontend-v6"] = "".join(
            f"{resolver.sha256(files[name])}  {name}\n" for name in resolver.FRONTEND_FILES[:2]).encode()
        with self.assertRaisesRegex(resolver.InvalidRelease, "build information differs"):
            resolver.verify_frontend(files, VERSION, COMMIT)

    def test_archive_traversal_absolute_path_duplicates_and_collisions(self):
        for extra in (("dist/../escape", b"bad"), ("/dist/escape", b"bad"),
                      ("other/file", b"bad"), ("dist/index.html", b"duplicate"),
                      ("dist/index.html/child", b"bad"), ("dist/a\\b", b"bad")):
            with self.subTest(name=extra[0]), self.assertRaises(resolver.InvalidRelease):
                resolver.inspect_archive(archive([extra]))

    def test_archive_links_and_special_entries(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.FIFOTYPE):
            info = tarfile.TarInfo("dist/link")
            info.type = kind
            info.linkname = "/tmp/target"
            with self.subTest(kind=kind), self.assertRaises(resolver.InvalidRelease):
                resolver.inspect_archive(archive([("unused", info)]))

    def test_checksum_file_cannot_redirect_validation(self):
        for data in (b"", ("0" * 64 + "  ../escape\n").encode(),
                     ("0" * 64 + "  dist-v6.tar.gz\n") .encode() * 2):
            with self.subTest(data=data), self.assertRaises(resolver.InvalidRelease):
                resolver.checksums(data)


class MaterializeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=resolver.ROOT / ".mss")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.output = self.root / ".mss/run/release/receipt.json"
        self.assets = self.root / ".mss/run/release/assets"
        self.manifest, self.files = resolver.resolve(FakeGitHub(), FakeRegistry(), VERSION)
        self.manifest["frontend"].update({"assets_dir": ".mss/run/release/assets", "archive": ".mss/run/release/dist-v6.tar.gz"})

    def test_materialization_and_idempotent_replay(self):
        resolver.materialize(self.manifest, self.files, self.output, self.assets, self.root)
        self.assertEqual(json.loads(self.output.read_text()), self.manifest)
        self.assertEqual((self.assets / "index.html").read_bytes(), b"<!doctype html>")
        resolver.materialize(self.manifest, self.files, self.output, self.assets, self.root)

    def test_receipt_locks_immutable_image_digest(self):
        resolver.materialize(self.manifest, self.files, self.output, self.assets, self.root)
        self.manifest["image"] = "unexpected"
        with self.assertRaisesRegex(resolver.InvalidRelease, "locks a different release"):
            resolver.materialize(self.manifest, self.files, self.output, self.assets, self.root)

    def test_rejects_paths_outside_run_directory_and_symlinks(self):
        for path in (self.root / "source", self.root.parent / "outside", self.root / ".mss/run"):
            with self.subTest(path=path), self.assertRaises(resolver.InvalidRelease):
                resolver.confined(path, self.root)
        self.output.parent.mkdir(parents=True)
        self.assets.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(resolver.InvalidRelease, "symlinks"):
            resolver.confined(self.assets, self.root)

    def test_refuses_unowned_directory_and_existing_download(self):
        self.assets.mkdir(parents=True)
        (self.assets / "important").write_text("preserve")
        with self.assertRaisesRegex(resolver.InvalidRelease, "unowned"):
            resolver.materialize(self.manifest, self.files, self.output, self.assets, self.root)
        (self.assets / "important").unlink()
        (self.output.parent / "dist-v6.tar.gz").write_text("preserve")
        with self.assertRaisesRegex(resolver.InvalidRelease, "different release bytes"):
            resolver.materialize(self.manifest, self.files, self.output, self.assets, self.root)

    def test_rejects_assets_collision_with_download_path(self):
        with self.assertRaisesRegex(resolver.InvalidRelease, "conflicts with a verified download"):
            resolver.materialize(self.manifest, self.files, self.output,
                                 self.output.parent / "dist-v6.tar.gz" / "assets", self.root)


class WaitTests(unittest.TestCase):
    def test_transient_readiness_retries_only_until_bounded_deadline(self):
        attempts = []
        clock = [0]

        def pending():
            attempts.append(True)
            raise resolver.NotReady("pending")

        def sleep(seconds):
            clock[0] += seconds

        with self.assertRaisesRegex(resolver.InvalidRelease, "deadline exceeded"):
            resolver.wait_for_release(pending, 31, sleep=sleep, monotonic=lambda: clock[0])
        self.assertEqual(clock[0], 31)
        self.assertEqual(len(attempts), 3)

    def test_identity_failure_never_retries(self):
        def invalid():
            raise resolver.InvalidRelease("identity mismatch")

        with patch.object(resolver.time, "sleep") as sleep, self.assertRaisesRegex(resolver.InvalidRelease, "identity mismatch"):
            resolver.wait_for_release(invalid, 1800)
        sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
