import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[2]


class ContainerWorkflowTest(unittest.TestCase):
    def test_tag_only_operator_guard_and_native_cross_compile(self):
        w = yaml.load(
            (ROOT / ".github/workflows/container.yml").read_text(),
            Loader=yaml.BaseLoader,
        )
        self.assertEqual(w["on"], {"push": {"tags": ["v*.*.*"]}})
        j = w["jobs"]["publish"]
        self.assertEqual(j["environment"], "release-auto")
        self.assertEqual(j["steps"][0]["env"]["RELEASE_ACTOR_LOGIN"], "mss-boot-sys")
        self.assertEqual(j["permissions"]["packages"], "write")
        dockerfile = (ROOT / "Dockerfile").read_text()
        self.assertIn("FROM --platform=$BUILDPLATFORM golang:", dockerfile)
        self.assertIn("GOOS=${TARGETOS} GOARCH=${TARGETARCH}", dockerfile)

    def run_image(self, mode):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            docker = root / "docker"
            docker.write_text("""#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:];mode=os.environ['MODE']
with open(os.environ['LOG'],'a') as f:f.write(json.dumps(args)+'\\n')
if 'build' in args:sys.exit(0)
if '--format' in args:
    commit='b'*40 if mode=='mismatch' else 'a'*40
    print(json.dumps({p:{'config':{'Labels':{'org.opencontainers.image.version':'v1.3.9','org.opencontainers.image.revision':commit}}} for p in ['linux/amd64','linux/arm64']}));sys.exit(0)
if mode=='auth':print('unauthorized',file=sys.stderr);sys.exit(1)
if mode=='absent' and not os.path.exists(os.environ['MARKER']):
    open(os.environ['MARKER'],'w').close();print('manifest unknown',file=sys.stderr);sys.exit(1)
print(json.dumps({'manifests':[{'platform':{'os':'linux','architecture':arch}} for arch in ['amd64','arm64']]}))
""")
            docker.chmod(0o755)
            log = root / "log"
            env = os.environ.copy()
            env.update(
                PATH=str(root) + os.pathsep + env["PATH"],
                MODE=mode,
                LOG=str(log),
                MARKER=str(root / "marker"),
                RUNNER_TEMP=str(root),
                GITHUB_SHA="a" * 40,
                RELEASE_VERSION="v1.3.9",
                REGISTRY="ghcr.io",
                IMAGE_NAME="mss-boot-sys/mss-boot-admin",
                GITHUB_REPOSITORY="mss-boot-sys/mss-boot-admin",
            )
            result = subprocess.run(
                ["bash", str(ROOT / "tools/release/publish_image.sh"), "root"],
                env=env,
                text=True,
                capture_output=True,
            )
            return result, [json.loads(line) for line in log.read_text().splitlines()]

    def test_existing_same_identity_is_never_overwritten(self):
        result, calls = self.run_image("exact")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any("build" in call for call in calls))

    def test_mismatched_or_unreadable_image_fails_without_push(self):
        for mode in ("mismatch", "auth"):
            result, calls = self.run_image(mode)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(any("build" in call for call in calls))

    def test_absent_image_builds_both_platforms_with_identity_and_sbom(self):
        result, calls = self.run_image("absent")
        self.assertEqual(result.returncode, 0, result.stderr)
        build = next(c for c in calls if "build" in c)
        for required in (
            "linux/amd64,linux/arm64",
            "--sbom=true",
            "--provenance=true",
            "--push",
            "VERSION=v1.3.9",
            "COMMIT=" + "a" * 40,
        ):
            self.assertIn(required, build)


if __name__ == "__main__":
    unittest.main()
