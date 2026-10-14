import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile
import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
from publish_release_assets import validate_release, verify_download


class RootReleaseWorkflowTest(unittest.TestCase):
    def test_matrix_and_tool_delivery_are_complete(self):
        w = yaml.load(
            (ROOT / ".github/workflows/release.yml").read_text(), Loader=yaml.BaseLoader
        )
        self.assertEqual(set(w["on"]), {"push"})
        self.assertEqual(
            w["jobs"]["backend-build"]["strategy"]["matrix"],
            {"os": ["linux", "windows", "darwin"], "arch": ["amd64", "arm64"]},
        )
        self.assertEqual(
            w["jobs"]["assemble"]["needs"],
            ["metadata", "backend-build", "frontend-build"],
        )
        self.assertEqual(w["jobs"]["publish"]["environment"], "release-auto")
        script = "\n".join(s.get("run", "") for s in w["jobs"]["publish"]["steps"])
        self.assertIn("--latest", script)
        self.assertNotIn("--clobber", script)

    def test_real_assembly_emits_six_runtime_and_six_minimal_tool_archives(self):
        w = yaml.load(
            (ROOT / ".github/workflows/release.yml").read_text(), Loader=yaml.BaseLoader
        )
        script = next(
            s["run"]
            for s in w["jobs"]["assemble"]["steps"]
            if s.get("name") == "Assemble release packages"
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in (
                "tools/release/check_portable_paths.py",
                "tools/install/install-mss.sh",
                "tools/install/install-mss.ps1",
            ):
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / relative, target)
            subprocess.run(["git", "init", "-q", "-b", "main"], cwd=root, check=True)
            subprocess.run(
                [
                    "git",
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@example.com",
                    "commit",
                    "--allow-empty",
                    "-qm",
                    "fixture",
                ],
                cwd=root,
                check=True,
            )
            sha = subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=root, text=True
            ).strip()
            timestamp = subprocess.check_output(
                ["git", "show", "-s", "--format=%cI", "HEAD"], cwd=root, text=True
            ).strip()
            for platform in ("linux", "darwin", "windows"):
                for arch in ("amd64", "arm64"):
                    runtime = root / f"mss-boot-admin-{platform}-{arch}"
                    runtime.mkdir()
                    (runtime / "BUILD-INFO").write_text(
                        f"version=v1.4.0\ncommit={sha}\ntimestamp={timestamp}\n"
                    )
                    (runtime / "LICENSE").write_text("MIT License\n")
                    for command in ("admin", "mss", "mss-mcp"):
                        (
                            runtime
                            / (command + (".exe" if platform == "windows" else ""))
                        ).write_bytes(b"fixture")
            frontend = root / "frontend-v6-dist"
            frontend.mkdir()
            release = {
                "application": "mss-boot-admin-antd-v6",
                "version": "v1.4.0",
                "commit": sha,
            }
            with tarfile.open(frontend / "dist-v6.tar.gz", "w:gz") as archive:
                content = json.dumps(release).encode()
                info = tarfile.TarInfo("dist/release.json")
                info.size = len(content)
                archive.addfile(info, io.BytesIO(content))
            (frontend / "FRONTEND-V6-BUILD-INFO").write_text("fixture")
            import hashlib

            (frontend / "SHA256SUMS.frontend-v6").write_text(
                "".join(
                    hashlib.sha256((frontend / n).read_bytes()).hexdigest()
                    + "  "
                    + n
                    + "\n"
                    for n in ("dist-v6.tar.gz", "FRONTEND-V6-BUILD-INFO")
                )
            )
            env = os.environ.copy()
            env.update(RELEASE_VERSION="v1.4.0", RELEASE_COMMIT=sha)
            result = subprocess.run(
                ["bash", "-c", script],
                cwd=root,
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(len(list(root.glob("mss-boot-admin-*.zip"))), 6)
            tools = list(root.glob("mss-tools-*"))
            self.assertEqual(len(tools), 6)
            for path in tools:
                if path.suffix == ".zip":
                    with zipfile.ZipFile(path) as archive:
                        self.assertEqual(
                            set(archive.namelist()),
                            {"BUILD-INFO", "LICENSE", "mss.exe", "mss-mcp.exe"},
                        )
                else:
                    with tarfile.open(path) as archive:
                        self.assertEqual(
                            set(archive.getnames()),
                            {"BUILD-INFO", "LICENSE", "mss", "mss-mcp"},
                        )
            self.assertEqual(len((root / "SHA256SUMS").read_text().splitlines()), 6)
            self.assertEqual(
                len((root / "SHA256SUMS.tools-v1.4.0").read_text().splitlines()), 8
            )
            first_checksums = (root / "SHA256SUMS").read_text()
            first_tools = (root / "SHA256SUMS.tools-v1.4.0").read_text()
            shutil.rmtree(root / "tool-staging")
            shutil.rmtree(root / "frontend-v6-extracted")
            for runtime in root.glob("mss-boot-admin-*"):
                if runtime.is_dir():
                    for member in runtime.rglob("*"):
                        os.utime(member, (1234567890, 1234567890))
                elif runtime.suffix == ".zip":
                    runtime.unlink()
            result = subprocess.run(
                ["bash", "-c", script],
                cwd=root,
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual((root / "SHA256SUMS").read_text(), first_checksums)
            self.assertEqual(
                (root / "SHA256SUMS.tools-v1.4.0").read_text(), first_tools
            )

    def test_immutable_asset_identity_rejects_changed_source_and_bytes(self):
        release = {
            "tagName": "v1.4.0",
            "targetCommitish": "a" * 40,
            "isPrerelease": False,
        }
        validate_release(release, "v1.4.0", "a" * 40)
        with self.assertRaises(ValueError):
            validate_release(release, "v1.4.0", "b" * 40)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            local = root / "local"
            remote = root / "remote"
            local.mkdir()
            remote.mkdir()
            (local / "asset").write_bytes(b"exact")
            (remote / "asset").write_bytes(b"exact")
            verify_download(remote, {"asset": local / "asset"})
            (remote / "asset").write_bytes(b"changed")
            with self.assertRaises(ValueError):
                verify_download(remote, {"asset": local / "asset"})
            (remote / "unexpected").write_bytes(b"extra")
            with self.assertRaises(ValueError):
                verify_download(remote, {"asset": local / "asset"})


if __name__ == "__main__":
    unittest.main()
