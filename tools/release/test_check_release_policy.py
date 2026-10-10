import importlib.util
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

MODULE_PATH = Path(__file__).with_name("check_release_policy.py")
SPEC = importlib.util.spec_from_file_location("check_release_policy", MODULE_PATH)
assert SPEC and SPEC.loader
POLICY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POLICY)


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
POLICY_PATH = REPOSITORY_ROOT / ".mss" / "release-policy.yaml"
GITHUB_EXPRESSION = re.compile(r"\$\{\{.*?\}\}", re.DOTALL)


class ReleasePolicyTest(unittest.TestCase):
    def setUp(self):
        self.policy = POLICY.load_policy(POLICY_PATH)

    def test_first_sys_release_is_direct_and_legacy_identity_remains_historical(self):
        self.assertEqual(self.policy["publicationMode"], "direct")
        self.assertEqual(self.policy["nextPublicVersion"], "v1.3.9")
        self.assertEqual(self.policy["legacyRepository"], "mss-boot-io/mss-boot-admin")
        self.assertEqual(self.policy["legacyStableVersion"], "v1.3.8")
        self.assertNotIn("stablePromotionReady", self.policy)
        self.assertNotIn("immutableStoppedTrains", self.policy)
        self.assertEqual(self.policy["currentStableCommit"], "pending")

    def test_canonical_components_publish_only_reviewed_version(self):
        for component in POLICY.COMPONENT_TEMPLATE_KEYS:
            ref = POLICY.release_ref(self.policy, component, "v1.3.9")
            POLICY.check_public_ref(self.policy, component, "v1.3.9", ref)
            for version in ("v1.3.8", "v1.3.7", "v1.4.0", "v1.3.9-rc.1", "v01.3.9"):
                with self.assertRaises(POLICY.PolicyError):
                    POLICY.check_public_ref(
                        self.policy,
                        component,
                        version,
                        POLICY.release_ref(self.policy, component, version),
                    )
            with self.assertRaises(POLICY.PolicyError):
                POLICY.check_public_ref(
                    self.policy, component, "v1.3.9", "wrong/v1.3.9"
                )

    def test_publication_switch_fails_closed_for_every_surface(self):
        self.policy["publicationWorkflowsReady"] = False
        for component in POLICY.COMPONENT_TEMPLATE_KEYS:
            ref = POLICY.release_ref(self.policy, component, "v1.3.9")
            POLICY.check_public_ref(
                self.policy, component, "v1.3.9", ref, intent="qualify"
            )
            with self.assertRaises(POLICY.PolicyError):
                POLICY.check_public_ref(self.policy, component, "v1.3.9", ref)

    def test_unknown_duplicate_or_weakened_contract_is_rejected(self):
        original = POLICY_PATH.read_text()
        candidates = [
            original + "  unknownField: true\n",
            original + "  nextPublicVersion: v1.3.9\n",
        ]
        for old, new in [
            (
                "requireMergedPullRequestSource: true",
                "requireMergedPullRequestSource: false",
            ),
            ("releaseBranch: main", "releaseBranch: topic"),
            ("distributionVersion: v1.3.9", "distributionVersion: v1.3.8"),
            ("publicPrereleases: false", "publicPrereleases: true"),
            ("currentStableCommit: pending", "currentStableCommit: invalid"),
            ("@mss-boot-sys/admin-web", "@other/admin-web"),
        ]:
            candidates.append(original.replace(old, new))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "policy.yaml"
            for candidate in candidates:
                path.write_text(candidate)
                with self.assertRaises(POLICY.PolicyError):
                    POLICY.load_policy(path)

    def test_static_release_builds_normalize_dynamic_route_placeholders(self):
        frontend_package = (
            REPOSITORY_ROOT / "web" / "antd-v6" / "package.json"
        ).read_text(encoding="utf-8")
        docs_package = (REPOSITORY_ROOT / "docs" / "package.json").read_text(
            encoding="utf-8"
        )
        self.assertIn("prepare_portable_frontend.py dist", frontend_package)
        self.assertIn(
            "prepare_portable_frontend.py dist --markdown-root docs", docs_package
        )

    def test_local_browser_qualification_cannot_reuse_the_development_server(self):
        playwright = (
            REPOSITORY_ROOT / "web" / "antd-v6" / "playwright.config.ts"
        ).read_text(encoding="utf-8")
        runner = (
            REPOSITORY_ROOT / "tools" / "verification" / "run-frontend-e2e.sh"
        ).read_text(encoding="utf-8")
        package = (REPOSITORY_ROOT / "web" / "antd-v6" / "package.json").read_text(
            encoding="utf-8"
        )
        support = (
            REPOSITORY_ROOT / "web" / "antd-v6" / "e2e" / "support" / "session.ts"
        ).read_text(encoding="utf-8")
        backend = (
            REPOSITORY_ROOT / "web" / "antd-v6" / "scripts" / "start-e2e-backend.sh"
        ).read_text(encoding="utf-8")
        e2e_config = (
            REPOSITORY_ROOT / "admin" / "config" / "application-e2e.yml"
        ).read_text(encoding="utf-8")
        package_business_config = (
            REPOSITORY_ROOT / "web" / "antd-v6" / "package" / "business.cjs"
        ).read_text(encoding="utf-8")
        generated_supplier = (
            REPOSITORY_ROOT
            / "web"
            / "antd-v6"
            / "e2e"
            / "generated"
            / "supplier.spec.ts"
        ).read_text(encoding="utf-8")
        supplier_template = (
            REPOSITORY_ROOT
            / "templates"
            / "module"
            / "frontend-v6"
            / "e2e.spec.ts.tmpl"
        ).read_text(encoding="utf-8")

        self.assertNotIn("reuseExistingServer: !process.env.CI", playwright)
        self.assertEqual(playwright.count("reuseExistingServer: false"), 2)
        self.assertIn("http://127.0.0.1:18001", playwright)
        for required in (
            "MSS_V6_BACKEND_ORIGIN",
            "MSS_V6_BACKEND_PORT",
            "MSS_V6_WEB_PORT",
            "qualificationBackendOrigin",
            "qualificationWebPort",
            "corepack pnpm@10.34.5 exec max dev",
        ):
            self.assertIn(required, playwright)
        for required in (
            "flock -w 600",
            "current.bind(('127.0.0.1', 0))",
            'export MSS_V6_BACKEND_ORIGIN="http://127.0.0.1:${backend_port}"',
            'export MSS_V6_BASE_URL="http://127.0.0.1:${web_port}"',
            'export MSS_E2E_BACKEND_API_URL="${MSS_V6_BACKEND_ORIGIN}/admin/api"',
            'export MSS_V6_E2E_EVIDENCE_ROOT="${evidence_root}"',
            "corepack pnpm@10.34.5 run test:e2e",
        ):
            self.assertIn(required, runner)
        self.assertNotIn("exec playwright test", runner)
        self.assertLess(
            runner.index("playwright install chromium"),
            runner.index("read -r backend_port web_port"),
        )
        for required in (
            "MSS_V6_BACKEND_PORT",
            "MSS_V6_WEB_PORT",
            '"${runtime_dir}/config/application.yml"',
            '"${runtime_dir}/config/application-e2e.yml"',
            "MSS_V6_E2E_RUN_ID",
            'case "${run_root}/" in',
            '"${repo_dir}/.mss/run/"*)',
            'run_dir="$(realpath -m "${run_root}/${run_id}")"',
        ):
            self.assertIn(required, backend)
        self.assertIn('"start:e2e"', package)
        self.assertIn("MSS_V6_E2E=1", package)
        for required in (
            "MSS_V6_E2E_RUN_ID=baseline playwright test --grep-invert @presentation",
            "MSS_V6_E2E_RUN_ID=presentation playwright test --grep @presentation",
        ):
            self.assertIn(required, package)
        for required in (
            "MSS_V6_E2E_EVIDENCE_ROOT",
            "MSS_V6_E2E_RUN_ID",
            "outputDir",
            "outputFolder",
        ):
            self.assertIn(required, playwright)
        self.assertIn(
            "persistentCaching: !browserQualification", package_business_config
        )
        for content in (
            support,
            backend,
            e2e_config,
            generated_supplier,
            supplier_template,
        ):
            self.assertIn("18001", content)
        for content in (support, backend, generated_supplier, supplier_template):
            self.assertNotIn("http://127.0.0.1:8001", content)
        for content in (generated_supplier, supplier_template):
            self.assertIn("const authorizedMenu = page.waitForResponse", content)
            self.assertIn("{ timeout: 20_000 }", content)
            self.assertIn("toBeVisible({ timeout: 15_000 })", content)

    def test_e2e_backend_rejects_a_symlinked_run_root_outside_the_repository(self):
        source = (
            REPOSITORY_ROOT / "web" / "antd-v6" / "scripts" / "start-e2e-backend.sh"
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository = root / "repository"
            script = repository / "web" / "antd-v6" / "scripts" / source.name
            script.parent.mkdir(parents=True)
            script.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
            run_parent = repository / ".mss" / "run"
            run_parent.mkdir(parents=True)
            outside = root / "outside"
            outside.mkdir()
            (run_parent / "antd-v6-e2e").symlink_to(outside, target_is_directory=True)

            result = subprocess.run(
                ["bash", str(script)],
                cwd=repository,
                text=True,
                capture_output=True,
                check=False,
            )

        self.assertEqual(result.returncode, 1)
        self.assertIn(
            "Refusing to use an E2E run root outside the repository",
            result.stderr,
        )


if __name__ == "__main__":
    unittest.main()
