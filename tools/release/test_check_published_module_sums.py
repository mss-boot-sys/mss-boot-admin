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

    def test_repository_template_pins_the_candidate_v160_admin_sum(self):
        text = (REPOSITORY_ROOT / "templates/application/go.sum").read_text(encoding="utf-8")
        pinned = SUMS.parse_pinned(text)
        self.assertIn((ADMIN, "v1.6.2"), pinned)
        self.assertNotIn((ADMIN, "v1.5.0"), pinned)

    def test_parse_pinned_rejects_duplicate_foundation_entries(self):
        text = go_sum(PUBLISHED_V150) + f"{ADMIN} v1.5.0 {STALE_V150}\n"
        with self.assertRaisesRegex(SUMS.PinnedSumError, "duplicate"):
            SUMS.parse_pinned(text)

    def test_parse_pinned_rejects_malformed_foundation_entries(self):
        for line in (f"{ADMIN} v1.5.0", f"{ADMIN} v1.5.0 {PUBLISHED_V150} extra", f"{ADMIN} v1.5.0 sha256:x"):
            with self.subTest(line=line):
                with self.assertRaisesRegex(SUMS.PinnedSumError, "malformed"):
                    SUMS.parse_pinned(line + "\n")

    def test_parse_pinned_ignores_malformed_lines_of_other_modules(self):
        text = go_sum(PUBLISHED_V150) + "github.com/other/module v1.0.0\n"
        self.assertEqual(len(SUMS.parse_pinned(text)), 2)


class MainTest(unittest.TestCase):
    def run_main(self, text, published, *flags):
        import contextlib, io, tempfile

        calls = []

        def lookup(module, version):
            calls.append((module, version))
            return published.get((module, version))

        sleeps = []
        out, err = io.StringIO(), io.StringIO()
        with tempfile.TemporaryDirectory() as root:
            Path(root, "go.sum").write_text(text, encoding="utf-8")
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = SUMS.main(
                    ["--root", root, *flags, "go.sum"], lookup=lookup, sleep=sleeps.append
                )
        return code, out.getvalue() + err.getvalue(), calls, sleeps

    PUBLISHED = {(ADMIN, "v1.5.0"): {"v1.5.0": PUBLISHED_V150, "v1.5.0/go.mod": PUBLISHED_V150_MOD}}

    def test_lenient_prints_counts_and_passes_when_published(self):
        code, output, _, _ = self.run_main(go_sum(PUBLISHED_V150), self.PUBLISHED)
        self.assertEqual(code, 0)
        self.assertIn("verified=2 skipped=0 mismatched=0", output)

    def test_lenient_all_skipped_passes_but_reports_zero_verified(self):
        code, output, _, _ = self.run_main(go_sum(PUBLISHED_V150), {})
        self.assertEqual(code, 0)
        self.assertIn("verified=0 skipped=1 mismatched=0", output)

    def test_strict_fails_on_404_after_retries_with_backoff(self):
        text = go_sum(PUBLISHED_V150) + f"{ADMIN} v9.9.9 h1:candidate=\n"
        code, output, calls, sleeps = self.run_main(
            text, self.PUBLISHED, "--strict", "--retries", "3", "--retry-delay", "1"
        )
        self.assertEqual(code, 1)
        self.assertEqual(calls.count((ADMIN, "v9.9.9")), 3)
        self.assertEqual(sleeps, [1.0, 2.0])
        self.assertIn("missing:", output)
        self.assertIn("verified=2 skipped=1 mismatched=0", output)

    def test_strict_fails_when_everything_was_skipped(self):
        code, output, _, _ = self.run_main(go_sum(PUBLISHED_V150), {}, "--strict", "--retries", "2")
        self.assertEqual(code, 1)
        self.assertIn("verified=0", output)

    def test_strict_fails_when_nothing_is_pinned(self):
        code, output, _, _ = self.run_main("github.com/other/module v1.0.0 h1:x=\n", {}, "--strict")
        self.assertEqual(code, 1)
        self.assertIn("no pinned Foundation module sum was verified", output)

    def test_strict_recovers_when_a_retry_finds_the_version(self):
        responses = [None, self.PUBLISHED[(ADMIN, "v1.5.0")]]

        class Flaky(dict):
            def get(self, key):
                return responses.pop(0)

        code, output, calls, sleeps = self.run_main(
            go_sum(PUBLISHED_V150), Flaky(), "--strict", "--retries", "3", "--retry-delay", "1"
        )
        self.assertEqual(code, 0)
        self.assertEqual(sleeps, [1.0])
        self.assertIn("verified=2 skipped=0 mismatched=0", output)

    def test_strict_fails_on_mismatch(self):
        code, output, _, _ = self.run_main(go_sum(STALE_V150), self.PUBLISHED, "--strict")
        self.assertEqual(code, 1)
        self.assertIn("mismatched=1", output)

    def test_malformed_entry_fails_the_run(self):
        code, output, _, _ = self.run_main(f"{ADMIN} v1.5.0\n", self.PUBLISHED)
        self.assertEqual(code, 1)
        self.assertIn("malformed", output)


if __name__ == "__main__":
    unittest.main()
