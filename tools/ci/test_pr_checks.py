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

    def test_migration_classification_requires_exact_bytes(self):
        before = b'package api\nimport "github.com/mss-boot-io/mss-boot-admin/admin/models"\n'
        after = before.replace(b'mss-boot-io', b'mss-boot-sys')
        self.assertTrue(checks.migration_only_change('admin/api.go', before, after))
        self.assertFalse(checks.migration_only_change('admin/api.go', before, after + b'// extra edit\n'))
        self.assertFalse(checks.migration_only_change('admin/api.go', before, before))
        self.assertFalse(checks.migration_only_change('admin/api.go', None, after))
        self.assertFalse(checks.migration_only_change('admin/api.go', before, None))
        self.assertFalse(checks.migration_only_change('data', b'\0' + before, b'\0' + after))
        revision = b'const templateRevision = "1.3.7-core-presentation-v2.1"\n'
        self.assertTrue(checks.migration_only_change('generator.go', before + revision, after + revision))

    def test_distribution_versions_do_not_discount_third_party_dependency_updates(self):
        before = b'require github.com/mss-boot-io/mss-boot-admin/mss-boot v1.3.7\nrequire example.com/dep v1.3.7\n'
        expected = b'require github.com/mss-boot-sys/mss-boot-admin/mss-boot v1.3.9\nrequire example.com/dep v1.3.7\n'
        self.assertTrue(checks.migration_only_change('admin/go.mod', before, expected))
        self.assertFalse(checks.migration_only_change('admin/go.mod', before, expected.replace(b'example.com/dep v1.3.7', b'example.com/dep v1.3.9')))
        self.assertTrue(checks.migration_only_change('README.md', b'v1.3.7\n', b'v1.3.9\n'))
        self.assertFalse(checks.migration_only_change('README.md', b'v1.3.70\n', b'v1.3.90\n'))

    def test_migration_does_not_reduce_required_verification_scope(self):
        paths = [f'admin/model{index}.go' for index in range(141)] + ['README.md']
        with patch.object(checks, 'mechanical_migration_paths', return_value=set(paths[:-1])):
            counts = checks.check_pr_contract(paths, base='a' * 40, head='b' * 40)
        self.assertEqual(counts, {'total': 142, 'substantive': 1, 'migration_only': 141})
        self.assertIn('admin', checks.plan_checks(paths)['go_modules'])
        with patch.object(checks, 'mechanical_migration_paths', return_value=set()):
            with self.assertRaisesRegex(ValueError, 'maximum is 140'):
                checks.check_pr_contract(paths, base='a' * 40, head='b' * 40)

    def test_migration_exemption_requires_root_module_transition(self):
        with patch.object(checks.subprocess, 'check_output', return_value='a' * 40 + '\n'):
            with patch.object(checks, 'git_blob', return_value=b'module github.com/mss-boot-sys/mss-boot-admin\n'):
                self.assertEqual(checks.mechanical_migration_paths('a' * 40, 'b' * 40, ['README.md']), set())

    def test_package_identity_migration_does_not_discount_dependency_edits(self):
        before = b'{"name":"@mss-boot-io/admin-web","version":"1.3.7-development","publishConfig":{"registry": "https://registry.npmjs.org"},"dependencies":{"react":"19.3.0"}}'
        after = before.replace(b'mss-boot-io', b'mss-boot-sys').replace(b'1.3.7-development', b'1.3.9').replace(b'registry.npmjs.org', b'npm.pkg.github.com')
        self.assertTrue(checks.migration_only_change('web/antd-v6/package.json', before, after))
        self.assertFalse(checks.migration_only_change('web/antd-v6/package.json', before, after.replace(b'19.3.0', b'19.4.0')))
        self.assertFalse(checks.migration_only_change('other/package.json', before, after))

    def test_real_git_migration_keeps_the_semantic_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args], text=True).strip()
            git('init', '-q', '-b', 'main')
            git('config', 'user.name', 'CI Test')
            git('config', 'user.email', 'ci@example.invalid')
            (root / 'go.mod').write_bytes(b'module ' + checks.OLD_MODULE + b'\n')
            (root / 'README.md').write_text('Namespace migration\n')
            for index in range(141):
                (root / f'file{index}.go').write_bytes(b'package p\n// ' + checks.OLD_MODULE + b'\n')
            git('add', '.')
            git('commit', '-qm', 'base')
            base = git('rev-parse', 'HEAD')
            for path in root.glob('*.go'):
                path.write_bytes(path.read_bytes().replace(checks.OLD_MODULE, checks.NEW_MODULE))
            (root / 'go.mod').write_bytes(b'module ' + checks.NEW_MODULE + b'\n')
            git('add', '.')
            git('commit', '-qm', 'namespace')
            head = git('rev-parse', 'HEAD')
            original_run = subprocess.run
            def run_in_repository(args, **kwargs):
                kwargs.setdefault('cwd', root)
                return original_run(args, **kwargs)
            with patch.object(checks.subprocess, 'run', side_effect=run_in_repository):
                paths = checks.changed_paths(base, head)
                self.assertEqual(checks.check_pr_contract(paths, base=base, head=head)['substantive'], 0)
            for path in root.glob('*.go'):
                path.write_bytes(path.read_bytes() + b'var semanticChange = true\n')
            git('add', '.')
            git('commit', '-qm', 'additional behavior')
            head = git('rev-parse', 'HEAD')
            with patch.object(checks.subprocess, 'run', side_effect=run_in_repository):
                paths = checks.changed_paths(base, head)
                with self.assertRaisesRegex(ValueError, 'maximum is 140'):
                    checks.check_pr_contract(paths, base=base, head=head)

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
