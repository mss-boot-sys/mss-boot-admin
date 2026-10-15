from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("check_current_docs.py")
SPEC = importlib.util.spec_from_file_location("check_current_docs", SCRIPT)
assert SPEC and SPEC.loader
check_current_docs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check_current_docs)


class CurrentDocsContractTest(unittest.TestCase):
    def test_release_links_reject_mismatched_markdown_and_hero_versions(self) -> None:
        for text in (
            "[v1.6.0 release record](./docs/docs/releases/v1-5-0.md)",
            "[v1.6.0 发布说明](/releases/v1-5-0)",
            "    - text: v1.6.0 发布说明\n      link: /releases/v1-5-0\n",
        ):
            with self.subTest(text=text):
                self.assertTrue(check_current_docs.release_link_version_errors(text))
                self.assertEqual(check_current_docs.release_link_version_errors(text.replace("v1-5-0", "v1-6-0")), [])
        self.assertEqual(check_current_docs.release_link_version_errors("[v1.5.0 历史记录](/releases/v1-5-0)"), [])

    def test_route_resolution_requires_real_page(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            route = root / "docs/docs/getting-started"
            route.mkdir(parents=True)
            (route / "index.md").write_text("# start\n", encoding="utf-8")
            self.assertTrue(
                check_current_docs.route_exists(root, "/getting-started")
            )
            self.assertFalse(check_current_docs.route_exists(root, "/deleted"))

    def test_link_check_includes_root_changelogs(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "docs/docs").mkdir(parents=True)
            (root / "CHANGELOG.md").write_text(
                "[removed](docs/docs/releases/removed.md)\n",
                encoding="utf-8",
            )
            errors = check_current_docs.internal_link_errors(root)
        self.assertTrue(any("CHANGELOG.md:1" in error for error in errors))

    def test_bootstrap_password_contract_requires_environment_only(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for relative in check_current_docs.BOOTSTRAP_PASSWORD_FILES:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(
                    "Use MSS_ADMIN_INITIAL_PASSWORD only for the first migration.\n",
                    encoding="utf-8",
                )
            self.assertEqual(check_current_docs.bootstrap_password_errors(root), [])

            unsafe = root / check_current_docs.BOOTSTRAP_PASSWORD_FILES[0]
            unsafe.write_text(
                "MSS_ADMIN_INITIAL_PASSWORD\nadmin migrate --password example\n",
                encoding="utf-8",
            )
            errors = check_current_docs.bootstrap_password_errors(root)
            self.assertTrue(any("command arguments" in error for error in errors))

    def test_first_login_contract_requires_username_and_address(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for relative in check_current_docs.FIRST_LOGIN_FILES:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(
                    "Sign in as `admin` at http://127.0.0.1:8001.\n",
                    encoding="utf-8",
                )
            self.assertEqual(check_current_docs.first_login_errors(root), [])

            incomplete = root / check_current_docs.FIRST_LOGIN_FILES[0]
            incomplete.write_text("Open the generated application.\n", encoding="utf-8")
            errors = check_current_docs.first_login_errors(root)
            self.assertTrue(any("initial admin username" in error for error in errors))
            self.assertTrue(any("local Admin Web address" in error for error in errors))

    def test_upgrade_contract_requires_manifest_backup_and_no_op_proof(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            complete = (
                "Back up code and database. Hand-assembled repositories missing their manifest migrate to a clean baseline.\n"
                "mss --version\nmss-mcp --version\n.mss/blueprint-manifest.json\n"
                "mss upgrade admin v1.6.0\n"
                "mss upgrade admin v1.6.0 --apply --yes\n"
                "mss doctor --strict\nmss verify --all\n"
                "mss upgrade admin v1.6.0\n"
            )
            for relative in check_current_docs.UPGRADE_CONTRACT_FILES:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(complete, encoding="utf-8")
            self.assertEqual(check_current_docs.upgrade_contract_errors(root), [])

            incomplete = root / check_current_docs.UPGRADE_CONTRACT_FILES[0]
            incomplete.write_text("mss upgrade admin v1.6.0\n", encoding="utf-8")
            errors = check_current_docs.upgrade_contract_errors(root)
            self.assertTrue(any("blueprint-manifest" in error for error in errors))
            self.assertTrue(any("final no-op" in error for error in errors))

    def test_mcp_contract_requires_stdio_client_and_project_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for relative in check_current_docs.MCP_CONTRACT_FILES:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(
                    "stdio tools/list mss_plan_application .mss/project.yaml\n",
                    encoding="utf-8",
                )
            tooling = root / check_current_docs.MCP_CONTRACT_FILES[0]
            tooling.write_text(
                'stdio tools/list mss_plan_application .mss/project.yaml '
                '"mcpServers" "command" "args"\n',
                encoding="utf-8",
            )
            self.assertEqual(check_current_docs.mcp_contract_errors(root), [])

            tooling.write_text("stdio only\n", encoding="utf-8")
            errors = check_current_docs.mcp_contract_errors(root)
            self.assertTrue(any("tools/list" in error for error in errors))
            self.assertTrue(any('"mcpServers"' in error for error in errors))

    def test_public_skill_list_is_exact(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "docs/docs/agent/skills-and-mcp.md"
            path.parent.mkdir(parents=True)
            path.write_text(
                "## Foundation 维护者 Skills\n"
                + "\n".join(
                    f"`{name}`" for name in check_current_docs.FOUNDATION_MAINTAINER_SKILLS
                )
                + "\n## Thin Host 分发 Skills\n"
                + "\n".join(
                    f"`{name}`" for name in check_current_docs.PUBLIC_THIN_HOST_SKILLS
                ),
                encoding="utf-8",
            )
            self.assertEqual(
                check_current_docs.public_skill_documentation_errors(root), []
            )

            path.write_text(
                "## Foundation 维护者 Skills\n"
                "`mss-add-workflow`\n"
                "## Thin Host 分发 Skills\n"
                "`mss-add-workflow`\n",
                encoding="utf-8",
            )
            errors = check_current_docs.public_skill_documentation_errors(root)
            self.assertTrue(any("mss-thin-host" in error for error in errors))
            self.assertTrue(any("Thin Host section" in error for error in errors))

    def test_documentation_audience_map_separates_human_and_agent_authority(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for relative, markers in check_current_docs.AUDIENCE_BOUNDARY_MARKERS.items():
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("\n".join(markers), encoding="utf-8")
            self.assertEqual(check_current_docs.documentation_audience_errors(root), [])

            agent_index = root / "docs/docs/agent/index.md"
            agent_index.write_text("Foundation 源码\n生成 Thin Host\n", encoding="utf-8")
            errors = check_current_docs.documentation_audience_errors(root)
            self.assertTrue(any("给人类看的公开说明" in error for error in errors))

            duplicate = root / "docs/docs/agent/architecture.md"
            duplicate.write_text("duplicate\n", encoding="utf-8")
            errors = check_current_docs.documentation_audience_errors(root)
            self.assertTrue(any("duplicate Agent architecture" in error for error in errors))

    def test_template_container_bases_require_exact_versions_and_digests(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            packages = root / "docs/docs/getting-started/packages.md"
            packages.parent.mkdir(parents=True)
            packages.write_text(
                "go get github.com/mss-boot-sys/mss-boot-admin/admin@v1.6.0\n"
                "go get github.com/mss-boot-sys/mss-boot-admin/mss-boot@v1.6.0\n"
                "set -eu\n"
                "mktemp -d\n"
                "trap - EXIT INT TERM\n"
                "go mod init mss-boot-sys.local/v139-public-consumer\n"
                "$previousGowork\n[guid]::NewGuid()\n"
                "New-Item -ItemType Directory -Path $consumerDir -ErrorAction Stop\n"
                "Push-Location -LiteralPath $consumerDir -ErrorAction Stop\n"
                "go mod init mss-boot-sys.local/v139-public-consumer\n"
                "$LASTEXITCODE -ne 0\n"
                "$LASTEXITCODE -ne 0\n"
                "$LASTEXITCODE -ne 0\n"
                "$LASTEXITCODE -ne 0\n"
                "Remove-Item Env:GOWORK\n"
                "Remove-Item -LiteralPath $consumerDir -Recurse -Force\n",
                encoding="utf-8",
            )
            (root / "README.md").write_text(
                "existing external consumer module existing frontend package root "
                "docs/docs/getting-started/packages.md\n"
                "mss new app demo --module example.com/demo --destination ./demo --write --git-init\n",
                encoding="utf-8",
            )
            (root / "README.zh-CN.md").write_text(
                "已有外部 consumer module 的根目录 已有 frontend package 的根目录 "
                "docs/docs/getting-started/packages.md\n"
                "mss new app demo --module example.com/demo --destination ./demo --write --git-init\n",
                encoding="utf-8",
            )
            quick_start = root / "docs/docs/getting-started/index.md"
            quick_start.write_text(
                "mss new app demo --module example.com/demo --destination ./demo --write --git-init\n",
                encoding="utf-8",
            )
            docker = root / "docs/docs/admin/docker.md"
            docker.parent.mkdir(parents=True)
            docker.write_text(
                "不能直接部署 docker buildx build OCI index digest 业务镜像\n",
                encoding="utf-8",
            )
            dockerfile = root / "templates/application/Dockerfile"
            dockerfile.parent.mkdir(parents=True)
            digest = "a" * 64
            dockerfile.write_text(
                f"FROM --platform=$BUILDPLATFORM golang:1.27.2-alpine@sha256:{digest} AS backend\n"
                f"FROM --platform=$BUILDPLATFORM node:24.19.0-bookworm-slim@sha256:{digest} AS frontend\n"
                f"FROM alpine:3.24.1@sha256:{digest}\n",
                encoding="utf-8",
            )
            dockerignore = root / "templates/application/.dockerignore"
            dockerignore.write_text(
                ".git\n.env\n.mss/logs\n.mss/reports\n*.db\nweb/node_modules\n",
                encoding="utf-8",
            )
            self.assertEqual(
                check_current_docs.package_and_container_contract_errors(root), []
            )

            valid_packages = packages.read_text(encoding="utf-8")
            packages.write_text(
                valid_packages.replace("$LASTEXITCODE -ne 0\n", "", 1),
                encoding="utf-8",
            )
            errors = check_current_docs.package_and_container_contract_errors(root)
            self.assertTrue(any("must fail fast" in error for error in errors))
            packages.write_text(valid_packages, encoding="utf-8")

            packages.write_text(
                valid_packages.replace(" -ErrorAction Stop", "", 1),
                encoding="utf-8",
            )
            errors = check_current_docs.package_and_container_contract_errors(root)
            self.assertTrue(any("New-Item" in error for error in errors))
            packages.write_text(valid_packages, encoding="utf-8")

            readme = root / "README.md"
            valid_readme = readme.read_text(encoding="utf-8")
            readme.write_text(
                valid_readme.replace("existing external consumer module", "Go packages"),
                encoding="utf-8",
            )
            errors = check_current_docs.package_and_container_contract_errors(root)
            self.assertTrue(any("separate existing package roots" in error for error in errors))
            readme.write_text(valid_readme, encoding="utf-8")

            quick_start.write_text(
                "mss new app demo \\\n  --module example.com/demo \\\n  --destination ./demo \\\n  --write --git-init\n",
                encoding="utf-8",
            )
            errors = check_current_docs.package_and_container_contract_errors(root)
            self.assertTrue(any("single-line command" in error for error in errors))

            dockerfile.write_text("FROM golang:1.26 AS backend\n", encoding="utf-8")
            errors = check_current_docs.package_and_container_contract_errors(root)
            self.assertTrue(any("immutable digest" in error for error in errors))

    def test_repository_satisfies_contract(self) -> None:
        self.assertEqual(check_current_docs.collect_errors(), [])

    def test_policy_requires_matching_release_versions(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            policy = root / ".mss/release-policy.yaml"
            policy.parent.mkdir()
            policy.write_text("spec:\n  distributionVersion: v1.3.9\n  nextPublicVersion: v1.3.9\n")
            self.assertEqual(check_current_docs.distribution_version(root), "v1.3.9")
            policy.write_text("spec:\n  distributionVersion: v1.3.9\n  nextPublicVersion: v1.3.8\n")
            with self.assertRaisesRegex(ValueError, "must agree"):
                check_current_docs.distribution_version(root)
            policy.write_text("spec:\n  distributionVersion: v1.3.9\n")
            with self.assertRaisesRegex(ValueError, "nextPublicVersion"):
                check_current_docs.distribution_version(root)

    def test_historical_pages_are_excluded_from_current_identity_scan(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for relative in ("docs/docs/releases/v1-3-7.md", "docs/docs/releases/archive/v1-3-2.md", "docs/docs/releases/v1-4-0.md", "docs/docs/releases/v1-5-0.md", "docs/docs/releases/v1-6-0.md"):
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("historical evidence")
            paths = check_current_docs.active_markdown_paths(root)
            self.assertNotIn(Path("docs/docs/releases/v1-3-7.md"), paths)
            self.assertNotIn(Path("docs/docs/releases/archive/v1-3-2.md"), paths)
            self.assertNotIn(Path("docs/docs/releases/v1-3-9.md"), paths)
            self.assertNotIn(Path("docs/docs/releases/v1-4-0.md"), paths)
            self.assertNotIn(Path("docs/docs/releases/v1-5-0.md"), paths)
            self.assertIn(Path("docs/docs/releases/v1-6-0.md"), paths)

    def test_migration_prose_allowed_but_old_commands_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "README.md"
            path.write_text("v1.3.8 belongs to mss-boot-io. Migrate github.com/mss-boot-io/mss-boot-admin imports.\n")
            self.assertEqual(check_current_docs.current_identity_errors(root, "v1.3.9", [Path("README.md")]), [])
            path.write_text("```shell\ngo get github.com/mss-boot-io/mss-boot-admin/admin@v1.3.8\n```\n")
            errors = "\n".join(check_current_docs.current_identity_errors(root, "v1.3.9", [Path("README.md")]))
            self.assertIn("retired identity", errors)
            self.assertIn("stale operational version", errors)

    def test_new_scope_must_pin_current_package(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "README.md").write_text("@mss-boot-sys/admin-web@1.3.7")
            errors = check_current_docs.current_identity_errors(root, "v1.3.9", [Path("README.md")])
            self.assertTrue(any("stale Admin Web" in error for error in errors))

    def test_github_packages_guide_requires_auth_environment_reference(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "docs/docs/getting-started/packages.md"
            path.parent.mkdir(parents=True)
            text = "@mss-boot-sys/admin-web npm.pkg.github.com read:packages NODE_AUTH_TOKEN\n"
            path.write_text(text)
            errors = check_current_docs.registry_documentation_errors(root)
            self.assertTrue(any("scoped registry" in error for error in errors))
            path.write_text(text + "@mss-boot-sys:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n")
            self.assertEqual(check_current_docs.registry_documentation_errors(root), [])

    def test_current_guides_reject_stale_status_and_credentialless_npmjs(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "README.md").write_text("The current stable is v1.3.7. The official npmjs package installs without a token.")
            errors = "\n".join(check_current_docs.current_identity_errors(root, "v1.3.9", [Path("README.md")]))
            self.assertIn("stale current-stable", errors)
            self.assertIn("retired publication instruction", errors)


if __name__ == "__main__":
    unittest.main()
