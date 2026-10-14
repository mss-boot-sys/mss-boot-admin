import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("check_published_module_sums.py")
SPEC = importlib.util.spec_from_file_location("check_published_module_sums", MODULE_PATH)
assert SPEC and SPEC.loader
SUMS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SUMS)

ADMIN = "github.com/mss-boot-sys/mss-boot-admin/admin"
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]

# The v1.5.0 regression: the template pinned the candidate-tree sum computed
# before stray SQLite files were removed from admin/ in the same release PR.
STALE_V150 = "h1:lgMtwmHW1bYO/r+4RKUElC+uwel266OMYuHryQmlNqw="
PUBLISHED_V150 = "h1:4a+E4pf3Obs8jldFUVk3HqMCxyo5jw3VBJ45+tlidBo="
PUBLISHED_V150_MOD = "h1:FUFM57YFlIwbcy8Sr3jPmjWrGUT+n27mnrSwDKxc270="


def fake_lookup(published):
    calls = []

    def lookup(module, version):
        calls.append((module, version))
        return published.get((module, version))

    lookup.calls = calls
    return lookup


def go_sum(module_hash):
    return (
        f"{ADMIN} v1.5.0 {module_hash}\n"
        f"{ADMIN} v1.5.0/go.mod {PUBLISHED_V150_MOD}\n"
        "github.com/other/module v1.0.0 h1:ignored=\n"
    )


class PublishedModuleSumsTest(unittest.TestCase):
    def setUp(self):
        self.lookup = fake_lookup(
            {(ADMIN, "v1.5.0"): {"v1.5.0": PUBLISHED_V150, "v1.5.0/go.mod": PUBLISHED_V150_MOD}}
        )

    def test_rejects_the_v150_stale_template_sum(self):
        failures, _ = SUMS.check({"go.sum": go_sum(STALE_V150)}, self.lookup)
        self.assertEqual(len(failures), 1)
        self.assertIn(STALE_V150, failures[0])
        self.assertIn(PUBLISHED_V150, failures[0])

    def test_accepts_published_sums_and_ignores_other_modules(self):
        failures, skipped = SUMS.check({"go.sum": go_sum(PUBLISHED_V150)}, self.lookup)
        self.assertEqual((failures, skipped), ([], []))
        self.assertEqual(self.lookup.calls, [(ADMIN, "v1.5.0")])

    def test_skips_unpublished_release_candidates(self):
        text = f"{ADMIN} v9.9.9 h1:candidate=\n{ADMIN} v9.9.9/go.mod h1:candidate-mod=\n"
        failures, skipped = SUMS.check({"go.sum": text}, self.lookup)
        self.assertEqual(failures, [])
        self.assertEqual(len(skipped), 1)

    def test_repository_template_pins_the_published_v150_admin_sum(self):
        text = (REPOSITORY_ROOT / "templates/application/go.sum").read_text(encoding="utf-8")
        pinned = SUMS.parse_pinned(text)
        if (ADMIN, "v1.5.0") in pinned:
            self.assertEqual(pinned[(ADMIN, "v1.5.0")], PUBLISHED_V150)


if __name__ == "__main__":
    unittest.main()
