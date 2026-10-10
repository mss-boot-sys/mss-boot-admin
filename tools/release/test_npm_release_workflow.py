"""GitHub Packages is the only npm publication surface."""

import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from publish_github_package import same_identity, REGISTRY


class PackagePublicationTest(unittest.TestCase):
    def setUp(self):
        self.evidence = {
            "package": {
                "name": "@mss-boot-sys/admin-web",
                "version": "1.3.9",
                "gitHead": "a" * 40,
                "repository": {
                    "type": "git",
                    "url": "git+https://github.com/mss-boot-sys/mss-boot-admin.git",
                    "directory": "web/antd-v6",
                },
            },
            "artifact": {"integrity": "sha512-exact"},
        }
        self.metadata = {
            **self.evidence["package"],
            "dist": {"integrity": "sha512-exact"},
        }

    def test_exact_identity_is_reusable(self):
        same_identity(self.metadata, self.evidence)

    def test_different_source_repository_version_or_bytes_is_rejected(self):
        for key, value in [
            ("name", "@other/admin-web"),
            ("version", "1.3.8"),
            ("gitHead", "b" * 40),
            ("repository", {}),
            ("dist", {"integrity": "sha512-other"}),
        ]:
            candidate = copy.deepcopy(self.metadata)
            candidate[key] = value
            with self.assertRaises(ValueError):
                same_identity(candidate, self.evidence)

    def test_npmjs_promotion_is_removed(self):
        root = Path(__file__).resolve().parents[2]
        self.assertFalse((root / ".github/workflows/npm-release.yml").exists())
        source = (root / "tools/release/publish_github_package.py").read_text()
        self.assertEqual(REGISTRY, "https://npm.pkg.github.com")
        self.assertIn('code != "E404"', source)
        self.assertIn("--ignore-scripts", source)
        self.assertNotIn("provenance", source)
        self.assertNotIn("registry.npmjs.org", source)


if __name__ == "__main__":
    unittest.main()
