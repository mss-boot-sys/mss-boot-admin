import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.ci import pr_checks as checks


class PRChecksTest(unittest.TestCase):
    def test_components_and_mixed_changes_select_only_their_consumers(self):
        cases = [
            (["docs/docs/guide.md"], [], [], False, True),
            (["README.md"], [], [], False, False),
            (["web/antd-v6/src/app.tsx", "docs/docs/guide.md"], [], ["javascript-typescript"], True, True),
            (["admin/oidc/token.go", "docs/docs/oidc.md"], ["admin"], ["go"], False, True),
            (["mss-boot/server.go"], ["admin", "mss-boot"], ["go"], False, False),
            (["compose/kafka/go.mod"], ["compose/kafka"], ["go"], False, False),
        ]
        for paths, modules, languages, web, docs in cases:
            with self.subTest(paths=paths):
                self.assertEqual(checks.plan_checks(paths), {
                    "go_modules": modules, "languages": languages, "web": web, "docs": docs,
                })

    def test_shared_and_unknown_changes_fail_toward_full_coverage(self):
        for path in [".github/workflows/pr-checks.yml", "go.work", ".mss/project.yaml",
                     "tools/security/check-pnpm-audit.mjs", "web-new/app.tsx",
                     "templates/application/README.md", ".agents/skills/example/SKILL.md"]:
            with self.subTest(path=path):
                self.assertEqual(checks.plan_checks([path]), {
                    "go_modules": checks.GO_MODULES, "languages": checks.LANGUAGES,
                    "web": True, "docs": True,
                })

    def test_documentation_is_required_for_contract_changes(self):
        for path in ["admin/apis/client.go", "admin/config/config.go",
                     "admin/migration/oidc.go", ".github/workflows/pr-checks.yml"]:
            with self.subTest(path=path):
                with self.assertRaises(ValueError):
                    checks.check_documentation([path])
                checks.check_documentation([path, "docs/docs/ci.md"])

    def test_preserves_the_existing_pr_size_limit(self):
        paths = [f"docs/{index}.md" for index in range(141)]
        checks.check_pr_contract(paths[:140])
        with self.assertRaisesRegex(ValueError, "maximum is 140"):
            checks.check_pr_contract(paths)

    def test_aggregate_rejects_failure_cancellation_and_unexpected_skips(self):
        for paths in [["docs/docs/index.md"], ["go.work"], ["README.md"]]:
            plan = checks.plan_checks(paths)
            needs = {"plan": {"result": "success", "outputs": {"plan": json.dumps(plan)}}}
            selected = [bool(plan["go_modules"]), plan["web"], plan["docs"], bool(plan["languages"])]
            for job, active in zip(checks.JOBS, selected):
                needs[job] = {"result": "success" if active else "skipped"}
            checks.check_results(needs)
            for job in ["plan", *checks.JOBS]:
                previous = needs[job]["result"]
                for result in {"success", "skipped", "cancelled", "failure"} - {previous}:
                    needs[job]["result"] = result
                    with self.assertRaises(ValueError):
                        checks.check_results(needs)
                needs[job]["result"] = previous
            del needs["codeql"]
            with self.assertRaises(ValueError):
                checks.check_results(needs)

    def test_invalid_comparison_never_becomes_an_empty_success(self):
        for value in ["", "main", "0" * 40, "a" * 39, "$(id)"]:
            with self.assertRaises(ValueError):
                checks.changed_paths(value, "a" * 40)
        with patch.object(checks.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "git")):
            with self.assertRaises(subprocess.CalledProcessError):
                checks.changed_paths("a" * 40, "b" * 40)

    def test_merge_base_ignores_unrelated_main_changes_and_tracks_both_rename_sides(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(["git", "-C", directory, *args], text=True).strip()
            git("init", "-q", "-b", "main")
            git("config", "user.name", "CI Test")
            git("config", "user.email", "ci@example.invalid")
            (root / "admin").mkdir()
            (root / "admin/test.go").write_text("package admin\n")
            git("add", ".")
            git("commit", "-qm", "base")
            git("checkout", "-qb", "pr")
            (root / "mss-boot").mkdir()
            git("mv", "admin/test.go", "mss-boot/test.go")
            git("commit", "-qm", "move")
            head = git("rev-parse", "HEAD")
            git("checkout", "-q", "main")
            (root / "unrelated").write_text("main only")
            git("add", ".")
            git("commit", "-qm", "advance main")
            base = git("rev-parse", "HEAD")
            original_run = subprocess.run
            with patch.object(checks.subprocess, "run", side_effect=lambda args, **kw: original_run(args, cwd=root, **kw)):
                self.assertEqual(checks.changed_paths(base, head), ["admin/test.go", "mss-boot/test.go"])


if __name__ == "__main__":
    unittest.main()
