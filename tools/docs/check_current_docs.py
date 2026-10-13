#!/usr/bin/env python3
"""Validate current documentation without treating historical release machinery as a gate."""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[2]
DOCS_ROOT = Path("docs/docs")
EXPECTED_DISTRIBUTION_VERSION = "v1.3.9"
CURRENT_RELEASE_PAGE = Path("docs/docs/releases/v1-3-9.md")
HISTORICAL_RELEASE_PAGES = {
    Path("docs/docs/releases/v1-3-5.md"),
    Path("docs/docs/releases/v1-3-6.md"),
    Path("docs/docs/releases/v1-3-7.md"),
}


CORE_CURRENT_FILES = (
    Path("README.md"),
    Path("README.zh-CN.md"),
    Path("CONTRIBUTING.md"),
    Path("MONOREPO.md"),
    Path("SECURITY.md"),
    Path("admin/README.md"),
    Path("mss-boot/README.md"),
    Path("mss-boot/README.Zh-cn.md"),
    Path("web/antd-v6/README.md"),
    Path("docs/README.md"),
    Path("docs/CONTRIBUTING.md"),
    Path("docs/docs/index.md"),
    Path("docs/docs/getting-started/index.md"),
    Path("docs/docs/getting-started/packages.md"),
    Path("docs/docs/getting-started/tooling.md"),
    Path("docs/docs/getting-started/mss-shop.md"),
    Path("docs/docs/releases/index.md"),
    CURRENT_RELEASE_PAGE,
)

CORE_LINK_FILES = CORE_CURRENT_FILES + (
    Path("CHANGELOG.md"),
    Path("mss-boot/CHANGELOG.md"),
)

ADOPTER_ONBOARDING_FILES = (
    Path("README.md"),
    Path("README.zh-CN.md"),
    Path("docs/docs/index.md"),
    Path("docs/docs/getting-started/index.md"),
    Path("docs/docs/getting-started/packages.md"),
    Path("docs/docs/getting-started/tooling.md"),
    Path("docs/docs/getting-started/mss-shop.md"),
    Path("docs/docs/releases/index.md"),
    CURRENT_RELEASE_PAGE,
)

BOOTSTRAP_PASSWORD_FILES = (
    Path("README.md"),
    Path("README.zh-CN.md"),
    Path("admin/README.md"),
    Path("templates/application/README.md"),
    Path("docs/docs/getting-started/index.md"),
    Path("docs/docs/admin/local-debug.md"),
    Path("docs/docs/admin/docker.md"),
    Path("docs/docs/guide/faq.md"),
)

FIRST_LOGIN_FILES = (
    Path("README.md"),
    Path("README.zh-CN.md"),
    Path("templates/application/README.md"),
    Path("docs/docs/getting-started/index.md"),
    Path("docs/docs/admin/login-troubleshooting.md"),
    Path("docs/docs/guide/faq.md"),
)

UPGRADE_CONTRACT_FILES = (
    Path("docs/docs/getting-started/index.md"),
    Path("docs/docs/guide/faq.md"),
    Path("docs/docs/agent/blueprints-and-upgrades.md"),
    CURRENT_RELEASE_PAGE,
    Path("templates/application/README.md"),
)

MCP_CONTRACT_FILES = (
    Path("docs/docs/getting-started/tooling.md"),
    Path("docs/docs/agent/skills-and-mcp.md"),
)

PUBLIC_THIN_HOST_SKILLS = (
    "mss-thin-host",
    "mss-add-module",
    "mss-add-field",
    "mss-add-permission",
    "mss-debug-fullstack",
    "mss-review-change",
    "mss-upgrade-foundation",
)

FOUNDATION_MAINTAINER_SKILLS = (
    "mss-project-onboarding",
    "mss-new-application",
    "mss-add-module",
    "mss-add-field",
    "mss-add-permission",
    "mss-add-workflow",
    "mss-debug-fullstack",
    "mss-review-change",
    "mss-upgrade-foundation",
    "mss-release",
    "mss-update-release-docs",
)

AUDIENCE_BOUNDARY_MARKERS = {
    Path("docs/README.md"): (
        "## Audience and authority map",
        "`docs/docs/agent/`",
        "Foundation AI Agents",
        "Generated Thin Host AI Agents",
    ),
    Path("docs/docs/index.md"): (
        "## 人类文档与 Agent 合同",
        "Foundation AI Agent",
        "Thin Host AI Agent",
        "不是 Agent",
    ),
    Path("docs/docs/agent/index.md"): (
        "给人类看的公开说明",
        "Foundation 源码",
        "生成 Thin Host",
        "不是 Agent",
        "| --- | --- | --- |",
    ),
    Path("docs/.dumirc.ts"): (
        "Agent 协作",
        "外部 Supplier 示例",
    ),
}

ACTIVE_ADMIN_SCOPE_FILES = (
    Path("docs/docs/admin/config-cache-consistency.md"),
    Path("docs/docs/admin/configuration-guide.md"),
    Path("docs/docs/admin/governance-guide.md"),
    Path("docs/docs/admin/i18n-troubleshooting.md"),
    Path("docs/docs/admin/integration-test-guide.md"),
    Path("docs/docs/admin/legacy-capability-deprecation.md"),
)

EXACT_SECTION_CONTENT = {
    Path("docs/docs/getting-started"): {
        "index.md",
        "packages.md",
        "tooling.md",
        "mss-shop.md",
    },
    Path("docs/docs/guide"): {"index.md", "faq.md"},
    Path("docs/docs/coding"): {"first-contribution.md", "pull-request-checks.md"},
    Path("docs/docs/devops"): {"security-policy-faq.md", "demo-maintenance.md"},
    Path("docs/docs/operations"): set(),
}

REMOVED_TREES = (
    Path("aigc/prompts"),
    Path("docs/aigc"),
    Path("docs/.github"),
    Path("mss-boot/aigc"),
    Path("mss-boot/.github"),
    Path("docs/docs/aigc"),
)

REMOVED_PATHS = (
    Path("mss-boot/core/README.md"),
)

REMOVED_ADMIN_PAGES = {
    "ai-annotation-spec.md",
    "ai-annotation-templates.md",
    "ant-design-v6-migration-plan.md",
    "comprehensive-test-report.md",
    "e2e-test-plan.md",
    "extension-guardrails.md",
    "hotgo-comparison.md",
    "operations-planning.md",
    "phase-3-roadmap.md",
    "phase-4-roadmap.md",
    "phase-5-roadmap.md",
    "pre-release-checklist.md",
    "product-direction.md",
    "product-polish-governance-plan.md",
    "product-polish-remediation-round-1.md",
    "production-standardization.md",
    "quickly.md",
    "release-readiness-report.md",
    "test-cases-full.md",
    "test-execution-report.md",
    "tutorials.md",
    "ui-experience-and-static-delivery.md",
}

REQUIRED_ARCHIVE_PAGES = {
    "index.md",
    "v1-0-0.md",
    "v1-0-0-compatibility.md",
    "v1-0-0-upgrade.md",
    "v1-0-0-rollback.md",
    "v1-2-0.md",
    "v1-2-1.md",
    "v1-2-2.md",
    "v1-2-3.md",
    "v1-3-0.md",
    "v1-3-1.md",
    "v1-3-2.md",
    "v1-3-3.md",
    "v1-3-4.md",
}

REQUIRED_ADRS = {
    "2026-08-04-admin-module-boundary-and-coverage.md",
    "2026-08-04-component-scoped-ci.md",
    "2026-08-06-admin-secret-lifecycle.md",
    "2026-08-06-remove-runtime-developer-tools-and-sample-monitoring.md",
    "2026-08-07-layered-theme-settings-precedence.md",
    "2026-08-09-storage-runtime-v2.md",
    "2026-08-15-browser-session-and-websocket-ticket.md",
    "2026-08-15-independent-ant-design-v6-application.md",
    "2026-08-16-account-reauthentication-and-credential-self-service.md",
    "2026-08-17-ant-design-v6-default-cutover.md",
    "2026-08-19-complete-admin-distribution-and-thin-business-host.md",
    "2026-08-22-admin-distribution-contract-hardening.md",
    "2026-08-24-admin-presentation-publication-workflow.md",
    "2026-08-24-governed-admin-presentation-configuration.md",
}

CONTRIBUTOR_PAGE = Path("docs/docs/coding/first-contribution.md")

ARCHIVE_PREFIX = Path("docs/docs/releases/archive")

MARKDOWN_LINK = re.compile(r"(?<!!)\[[^\]]*\]\(([^)]+)\)")

NAV_LINK = re.compile(r"\blink:\s*['\"](/[^'\"]*)['\"]")

FRONTMATTER_TITLE = re.compile(
    r"\A---\s*\n(?P<body>.*?)\n---", re.DOTALL
)

VERSION_TOKEN = re.compile(r"(?<![A-Za-z0-9])v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?")

ADMIN_WEB_TOKEN = re.compile(r"@mss-boot-sys/admin-web@(\d+\.\d+\.\d+)")

FENCED_CODE_BLOCK = re.compile(r"```[^\n]*\n.*?```", re.DOTALL)

OPERATIONAL_VERSION_LINE = re.compile(
    r"^\s*(?:[$>]\s*)?(?:mss\b|go\s+(?:get|install|mod)\b|corepack\b|"
    r"npm\b|pnpm\b|yarn\b|curl\b|bash\b|Invoke-WebRequest\b|"
    r"&\s+\.\\install-mss|docker\b)",
    re.IGNORECASE,
)

FORBIDDEN_SOURCE_COMMANDS = {
    "Foundation clone command": re.compile(r"\bgit\s+clone\b"),
    "source-only mss invocation": re.compile(
        r"\bgo\s+run(?:\s+-[^\s]+)*\s+\./cmd/mss(?:-mcp)?\b"
    ),
    "checkout-dependent upgrade": re.compile(r"(?<![A-Za-z0-9_])--foundation\b"),
    "POSIX sh invocation for Bash installer": re.compile(
        r"\bsh\s+(?:\./)?install-mss\.sh\b"
    ),
    "manual shell bootstrap password prompt": re.compile(
        r"\bread\s+-[^\n]*\bMSS_ADMIN_INITIAL_PASSWORD\b"
    ),
    "manual PowerShell bootstrap password conversion": re.compile(
        r"\[System\.Net\.NetworkCredential\]"
    ),
    "retired monolithic application config": re.compile(
        r"(?<![A-Za-z0-9_.-])config/application\.ya?ml\b"
    ),
    "obsolete HotGo comparison context": re.compile(r"\bHotGo\b", re.IGNORECASE),
    "direct SQL mutation example": re.compile(
        r"^\s*(?:INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM)\b",
        re.IGNORECASE | re.MULTILINE,
    ),
    "literal credential example": re.compile(
        r"^\s*(?:password|token|secret|smtpPassword|webhookToken)\s*:\s*"
        r"(?!$|#|(?:password|token|secret)?Ref\b|env://|\$\{|\[REDACTED\]|<redacted>)"
        r"\S+",
        re.IGNORECASE | re.MULTILINE,
    ),
}

def bootstrap_password_errors(
    root: Path, paths: Iterable[Path] = BOOTSTRAP_PASSWORD_FILES
) -> list[str]:
    errors: list[str] = []
    for path in paths:
        absolute = root / path
        if not absolute.is_file():
            errors.append(f"missing bootstrap password documentation: {path}")
            continue
        text = absolute.read_text(encoding="utf-8")
        if "MSS_ADMIN_INITIAL_PASSWORD" not in text:
            errors.append(
                f"{path}: must document the one-use MSS_ADMIN_INITIAL_PASSWORD contract"
            )
        if re.search(r"(?s)\bmigrate\b.{0,240}?--password\b", text):
            errors.append(
                f"{path}: initial administrator passwords must not be passed in command arguments"
            )
    return errors

def first_login_errors(
    root: Path, paths: Iterable[Path] = FIRST_LOGIN_FILES
) -> list[str]:
    errors: list[str] = []
    for path in paths:
        absolute = root / path
        if not absolute.is_file():
            errors.append(f"missing first-login documentation: {path}")
            continue
        text = absolute.read_text(encoding="utf-8")
        if not re.search(r"(?<![A-Za-z0-9_-])`?admin`?(?![A-Za-z0-9_-])", text):
            errors.append(f"{path}: must document the initial admin username")
        if "127.0.0.1:8001" not in text:
            errors.append(f"{path}: must document the local Admin Web address")
    return errors

def upgrade_contract_errors(
    root: Path,
    paths: Iterable[Path] = UPGRADE_CONTRACT_FILES,
    *,
    version: str = EXPECTED_DISTRIBUTION_VERSION,
) -> list[str]:
    errors: list[str] = []
    required_markers = (
        "mss --version",
        "mss-mcp --version",
        ".mss/blueprint-manifest.json",
        "mss doctor --strict",
        "mss verify --all",
    )
    for path in paths:
        absolute = root / path
        if not absolute.is_file():
            errors.append(f"missing upgrade documentation: {path}")
            continue
        text = absolute.read_text(encoding="utf-8")
        for marker in required_markers:
            if marker not in text:
                errors.append(f"{path}: upgrade contract is missing {marker}")
        upgrade_commands = re.findall(
            rf"mss upgrade admin (?:{re.escape(version)}|__MSS_DISTRIBUTION_VERSION__)",
            text,
        )
        if len(upgrade_commands) < 3:
            errors.append(
                f"{path}: must show plan, apply, and final no-op upgrade commands"
            )
        if not re.search(r"(?:back\s*up|backup|备份)", text, re.IGNORECASE):
            errors.append(f"{path}: upgrade contract must require a backup")
        if not re.search(
            r"(?:hand-assembled|missing (?:its )?manifest|手工拼装|丢失 manifest|缺失)",
            text,
            re.IGNORECASE,
        ):
            errors.append(
                f"{path}: must explain the manifest-less adoption path"
            )
    return errors

def mcp_contract_errors(
    root: Path,
    paths: Iterable[Path] = MCP_CONTRACT_FILES,
    *,
    require_client_example: bool = True,
) -> list[str]:
    errors: list[str] = []
    for path in paths:
        absolute = root / path
        if not absolute.is_file():
            errors.append(f"missing MCP documentation: {path}")
            continue
        text = absolute.read_text(encoding="utf-8")
        for marker in ("stdio", "tools/list", "mss_plan_application", ".mss/project.yaml"):
            if marker not in text:
                errors.append(f"{path}: MCP contract is missing {marker}")
    tooling = root / "docs/docs/getting-started/tooling.md"
    if require_client_example and tooling.is_file():
        text = tooling.read_text(encoding="utf-8")
        for marker in ('"mcpServers"', '"command"', '"args"'):
            if marker not in text:
                errors.append(f"{tooling.relative_to(root)}: MCP client example is missing {marker}")
    return errors

def public_skill_documentation_errors(root: Path) -> list[str]:
    path = Path("docs/docs/agent/skills-and-mcp.md")
    absolute = root / path
    if not absolute.is_file():
        return [f"missing public Skill documentation: {path}"]
    text = absolute.read_text(encoding="utf-8")
    errors: list[str] = []
    foundation_heading = "## Foundation 维护者 Skills"
    thin_host_heading = "## Thin Host 分发 Skills"
    if foundation_heading not in text or thin_host_heading not in text:
        return [f"{path}: Skill documentation must separate Foundation and Thin Host sections"]
    foundation = text.split(foundation_heading, 1)[1].split(thin_host_heading, 1)[0]
    thin_host = text.split(thin_host_heading, 1)[1]
    errors.extend(
        f"{path}: Foundation maintainer Skill list is missing {name}"
        for name in FOUNDATION_MAINTAINER_SKILLS
        if f"`{name}`" not in foundation
    )
    errors.extend(
        f"{path}: Thin Host Skill list is missing {name}"
        for name in PUBLIC_THIN_HOST_SKILLS
        if f"`{name}`" not in thin_host
    )
    for forbidden in (
        "mss-project-onboarding",
        "mss-new-application",
        "mss-add-workflow",
        "mss-release",
        "mss-update-release-docs",
    ):
        if f"`{forbidden}`" in thin_host:
            errors.append(
                f"{path}: Foundation-only or unsupported Skill is listed in the Thin Host section: {forbidden}"
            )
    return errors

def documentation_audience_errors(root: Path) -> list[str]:
    errors: list[str] = []
    for relative, markers in AUDIENCE_BOUNDARY_MARKERS.items():
        path = root / relative
        if not path.is_file():
            errors.append(f"missing documentation audience boundary: {relative}")
            continue
        text = path.read_text(encoding="utf-8")
        for marker in markers:
            if marker not in text:
                errors.append(f"{relative}: audience boundary is missing {marker}")
    if (root / "docs/docs/agent/architecture.md").exists():
        errors.append(
            "docs/docs/agent/architecture.md: duplicate Agent architecture summary must remain absent"
        )
    return errors

def package_and_container_contract_errors(
    root: Path,
    *,
    require_adopter_packages: bool = True,
    version: str = EXPECTED_DISTRIBUTION_VERSION,
) -> list[str]:
    errors: list[str] = []
    packages = root / "docs/docs/getting-started/packages.md"
    if require_adopter_packages and packages.is_file():
        text = packages.read_text(encoding="utf-8")
        for marker in (
            f"go get github.com/mss-boot-sys/mss-boot-admin/admin@{version}",
            f"go get github.com/mss-boot-sys/mss-boot-admin/mss-boot@{version}",
            "set -eu",
            "mktemp -d",
            "trap - EXIT INT TERM",
            "go mod init mss-boot-sys.local/v139-public-consumer",
            "$previousGowork",
            "[guid]::NewGuid()",
            "New-Item -ItemType Directory -Path $consumerDir -ErrorAction Stop",
            "Push-Location -LiteralPath $consumerDir -ErrorAction Stop",
            "$LASTEXITCODE -ne 0",
            "Remove-Item Env:GOWORK",
            "Remove-Item -LiteralPath $consumerDir -Recurse -Force",
        ):
            if marker not in text:
                errors.append(f"{packages.relative_to(root)}: package contract is missing {marker}")
        if text.count("go mod init mss-boot-sys.local/v139-public-consumer") < 2:
            errors.append(
                f"{packages.relative_to(root)}: POSIX and PowerShell consumers must each initialize an external Go module"
            )
        if text.count("$LASTEXITCODE -ne 0") < 4:
            errors.append(
                f"{packages.relative_to(root)}: every PowerShell Go command must fail fast"
            )
    if require_adopter_packages:
        consumer_contexts = (
            (
                Path("README.md"),
                ("existing external consumer module", "existing frontend package root"),
            ),
            (
                Path("README.zh-CN.md"),
                ("已有外部 consumer module 的根目录", "已有 frontend package 的根目录"),
            ),
        )
        for relative, context_markers in consumer_contexts:
            path = root / relative
            if not path.is_file():
                errors.append(f"missing adopter package context: {relative}")
                continue
            text = path.read_text(encoding="utf-8")
            normalized_text = re.sub(r"\s+", " ", text)
            for marker in (*context_markers, "docs/docs/getting-started/packages.md"):
                if marker not in normalized_text:
                    errors.append(
                        f"{relative}: Go and npm commands must name their separate existing package roots and link the external procedure"
                    )
        for relative in (
            Path("README.md"),
            Path("README.zh-CN.md"),
            Path("docs/docs/getting-started/index.md"),
        ):
            path = root / relative
            if not path.is_file():
                errors.append(f"missing adopter quick start: {relative}")
                continue
            text = path.read_text(encoding="utf-8")
            if re.search(r"(?m)^mss new app [^\n]*\\\s*$", text) or not re.search(
                r"(?m)^mss new app [^\\\n]+--write --git-init\s*$", text
            ):
                errors.append(
                    f"{relative}: mss new app must use a PowerShell/POSIX-safe single-line command"
                )
    docker = root / "docs/docs/admin/docker.md"
    if docker.is_file():
        text = docker.read_text(encoding="utf-8")
        for marker in ("不能直接部署", "docker buildx build", "OCI index digest", "业务镜像"):
            if marker not in text:
                errors.append(f"{docker.relative_to(root)}: Thin Host image contract is missing {marker}")
    dockerfile = root / "templates/application/Dockerfile"
    if dockerfile.is_file():
        text = dockerfile.read_text(encoding="utf-8")
        required_bases = (
            r"^FROM --platform=\$BUILDPLATFORM golang:1\.27\.2-alpine@sha256:[a-f0-9]{64} AS backend$",
            r"^FROM --platform=\$BUILDPLATFORM node:24\.19\.0-bookworm-slim@sha256:[a-f0-9]{64} AS frontend$",
            r"^FROM alpine:3\.24\.1@sha256:[a-f0-9]{64}$",
        )
        for pattern in required_bases:
            if not re.search(pattern, text, re.MULTILINE):
                errors.append(
                    "templates/application/Dockerfile: every base image must use the "
                    f"{version}-qualified tag and immutable digest ({pattern})"
                )
    else:
        errors.append("missing Thin Host templates/application/Dockerfile")
    dockerignore = root / "templates/application/.dockerignore"
    if dockerignore.is_file():
        ignored = set(dockerignore.read_text(encoding="utf-8").splitlines())
        for required in (".git", ".env", ".mss/logs", ".mss/reports", "*.db", "web/node_modules"):
            if required not in ignored:
                errors.append(
                    f"templates/application/.dockerignore: missing sensitive build-context exclusion {required}"
                )
    else:
        errors.append("missing Thin Host templates/application/.dockerignore")
    return errors

def route_exists(root: Path, route: str) -> bool:
    clean = unquote(route.split("#", 1)[0].split("?", 1)[0]).strip("/")
    if not clean:
        return (root / DOCS_ROOT / "index.md").is_file()
    base = root / DOCS_ROOT / clean
    localized = base.parent / f"{base.name}.zh-CN.md"
    return (
        base.with_suffix(".md").is_file()
        or localized.is_file()
        or (base / "index.md").is_file()
    )

def internal_link_errors(root: Path) -> list[str]:
    errors: list[str] = []
    docs_root = root / DOCS_ROOT
    if not docs_root.is_dir():
        return [f"missing {DOCS_ROOT}"]
    checked = set(docs_root.rglob("*.md"))
    checked.update(
        root / relative for relative in CORE_LINK_FILES if (root / relative).is_file()
    )
    for absolute in sorted(checked):
        relative = absolute.relative_to(root)
        text = absolute.read_text(encoding="utf-8")
        for match in MARKDOWN_LINK.finditer(text):
            raw = match.group(1).strip()
            if not raw or raw.startswith(("#", "http://", "https://", "mailto:")):
                continue
            target = raw.split()[0].strip("<>")
            target_no_fragment = unquote(
                target.split("#", 1)[0].split("?", 1)[0]
            )
            if not target_no_fragment:
                continue
            if target_no_fragment.startswith("/"):
                suffix = Path(target_no_fragment).suffix
                if suffix and suffix != ".md":
                    continue
                route = target_no_fragment.removesuffix(".md")
                if not route_exists(root, route):
                    line = text.count("\n", 0, match.start()) + 1
                    errors.append(
                        f"{relative}:{line}: broken site route {target_no_fragment}"
                    )
                continue
            if target_no_fragment.endswith(".md"):
                resolved = (absolute.parent / target_no_fragment).resolve()
                try:
                    resolved.relative_to(root.resolve())
                except ValueError:
                    line = text.count("\n", 0, match.start()) + 1
                    errors.append(f"{relative}:{line}: link escapes repository: {target}")
                    continue
                if not resolved.is_file():
                    line = text.count("\n", 0, match.start()) + 1
                    errors.append(f"{relative}:{line}: broken Markdown link {target}")
    return errors


def distribution_version(root: Path) -> str:
    text = (root / ".mss/release-policy.yaml").read_text(encoding="utf-8")
    versions = {}
    for name in ("distributionVersion", "nextPublicVersion"):
        matches = re.findall(rf"^  {name}: ['\"]?(v[0-9]+\.[0-9]+\.[0-9]+)['\"]?\s*$", text, re.MULTILINE)
        if len(matches) != 1:
            raise ValueError(f"release policy must declare exactly one spec.{name}")
        versions[name] = matches[0]
    if versions["distributionVersion"] != versions["nextPublicVersion"]:
        raise ValueError("distributionVersion and nextPublicVersion must agree")
    return versions["distributionVersion"]


def active_markdown_paths(root: Path) -> list[Path]:
    paths = set(CORE_CURRENT_FILES)
    for path in (root / DOCS_ROOT).rglob("*.md"):
        relative = path.relative_to(root)
        if relative in HISTORICAL_RELEASE_PAGES or ARCHIVE_PREFIX in relative.parents:
            continue
        paths.add(relative)
    return sorted(paths)


def current_identity_errors(root: Path, version: str, paths: Iterable[Path]) -> list[str]:
    errors = []
    for relative in paths:
        path = root / relative
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        # History and explicit namespace-migration prose are allowed. Executable
        # commands and package/download URLs must use the new release identity.
        for block in FENCED_CODE_BLOCK.finditer(text):
            for token in VERSION_TOKEN.findall(block.group()):
                if token != version:
                    errors.append(f"{relative}: stale operational version {token}; expected {version}")
            for retired in ("github.com/mss-boot-io/mss-boot-admin", "@mss-boot-io/admin-web", "ghcr.io/mss-boot-io/"):
                if retired in block.group():
                    errors.append(f"{relative}: retired identity in executable example: {retired}")
        for match in re.finditer(r"(?:releases/download/|ghcr\.io/mss-boot-sys/[^\s:@`]+:)(v[0-9]+\.[0-9]+\.[0-9]+)", text):
            if match.group(1) != version:
                errors.append(f"{relative}: stale artifact URL version {match.group(1)}")
        for match in ADMIN_WEB_TOKEN.finditer(text):
            if match.group(1) != version.removeprefix("v"):
                errors.append(f"{relative}: stale Admin Web version {match.group(1)}")
        for pattern in (
            r"(?:current(?: coordinated)? stable(?: version)?|当前(?:协调)?稳定(?:版本|版)?)\s*(?:is|是|为|：|:)\s*[*`]*(v[0-9]+\.[0-9]+\.[0-9]+)",
            r"(v[0-9]+\.[0-9]+\.[0-9]+)\s*(?:is the current stable|是当前稳定|已是当前稳定)",
        ):
            for match in re.finditer(pattern, text, re.IGNORECASE):
                if match.group(1) != version:
                    errors.append(f"{relative}: stale current-stable claim {match.group(1)}")
        for pattern in (
            r"official npmjs package (?:installs|is published)",
            r"匿名 npmjs 安装",
            r"(?:官方 npmjs|npmjs 包).{0,30}(?:无需|不需要).{0,20}(?:Token|token|认证)",
            r"The existing candidate preview builds",
            r"单独(?:的)?(?:已评审|受审).{0,30}(?:stable promotion|策略 PR)",
        ):
            if re.search(pattern, text, re.IGNORECASE):
                errors.append(f"{relative}: retired publication instruction: {pattern}")
        # Keep secret and retired runtime protections, while contributor guides
        # may legitimately show source-checkout commands.
        for label in ("literal credential example", "direct SQL mutation example", "retired monolithic application config"):
            if FORBIDDEN_SOURCE_COMMANDS[label].search(text):
                errors.append(f"{relative}: {label} is not allowed in current docs")
    return errors


def registry_documentation_errors(root: Path) -> list[str]:
    errors = []
    for relative in (Path("README.md"), Path("README.zh-CN.md"), Path("docs/docs/getting-started/packages.md")):
        path = root / relative
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        for marker in ("npm.pkg.github.com", "NODE_AUTH_TOKEN", "read:packages", "@mss-boot-sys/admin-web"):
            if marker not in text:
                errors.append(f"{relative}: GitHub Packages guidance is missing {marker}")
    package_guide = root / "docs/docs/getting-started/packages.md"
    if package_guide.is_file():
        text = package_guide.read_text(encoding="utf-8")
        for marker in ("@mss-boot-sys:registry=https://npm.pkg.github.com", "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}"):
            if marker not in text:
                errors.append(f"{package_guide.relative_to(root)}: missing scoped registry configuration {marker}")
    return errors


def collect_errors(root: Path = ROOT) -> list[str]:
    errors = []
    try:
        version = distribution_version(root)
    except (OSError, ValueError) as exc:
        return [str(exc)]
    if version != EXPECTED_DISTRIBUTION_VERSION:
        errors.append(f"documentation contract is for {EXPECTED_DISTRIBUTION_VERSION}, policy declares {version}")
    for relative in CORE_CURRENT_FILES:
        path = root / relative
        if not path.is_file():
            errors.append(f"missing current documentation file: {relative}")
        elif version not in path.read_text(encoding="utf-8"):
            errors.append(f"{relative}: must name current distribution {version}")
    for relative in (*REMOVED_TREES, *REMOVED_PATHS):
        path = root / relative
        if path.is_file() or (path.is_dir() and any(item.is_file() for item in path.rglob("*"))):
            errors.append(f"obsolete context path must remain absent: {relative}")
    for name in REMOVED_ADMIN_PAGES:
        if (root / "docs/docs/admin" / name).exists():
            errors.append(f"obsolete Admin page must remain absent: {name}")
    for section, expected in EXACT_SECTION_CONTENT.items():
        actual = {path.name for path in (root / section).glob("*.md")}
        if actual != expected:
            errors.append(f"{section}: expected {sorted(expected)}, found {sorted(actual)}")
    required_releases = {"index.md", CURRENT_RELEASE_PAGE.name, *(path.name for path in HISTORICAL_RELEASE_PAGES)}
    actual_releases = {path.name for path in (root / "docs/docs/releases").glob("*.md")}
    if actual_releases != required_releases:
        errors.append(f"release pages mismatch: {sorted(actual_releases)}")
    errors.extend(current_identity_errors(root, version, active_markdown_paths(root)))
    errors.extend(registry_documentation_errors(root))
    errors.extend(bootstrap_password_errors(root))
    errors.extend(first_login_errors(root))
    errors.extend(upgrade_contract_errors(root, version=version))
    errors.extend(mcp_contract_errors(root))
    errors.extend(public_skill_documentation_errors(root))
    errors.extend(documentation_audience_errors(root))
    errors.extend(package_and_container_contract_errors(root, version=version))
    nav = root / "docs/.dumirc.ts"
    if nav.is_file():
        nav_text = nav.read_text(encoding="utf-8")
        routes = NAV_LINK.findall(nav_text)
        if routes.count("/getting-started") != 1:
            errors.append("navigation must expose exactly one /getting-started entry")
        for route in routes:
            if not route_exists(root, route):
                errors.append(f"docs/.dumirc.ts: navigation target does not exist: {route}")
        if "https://github.com/mss-boot-sys/mss-boot-admin" not in nav_text:
            errors.append("docs/.dumirc.ts: current repository link missing")
        if "https://docs.mss-boot-io.top" not in nav_text:
            errors.append("docs/.dumirc.ts: existing Docs domain must be retained")
    archive = root / ARCHIVE_PREFIX
    if {page.name for page in archive.glob("*.md")} != REQUIRED_ARCHIVE_PAGES:
        errors.append("historical release archive is incomplete")
    for relative in HISTORICAL_RELEASE_PAGES:
        path = root / relative
        if path.is_file() and "历史记录：本页保留原" not in path.read_text(encoding="utf-8"):
            errors.append(f"{relative}: missing historical organization banner")
    adr_pages = sorted((root / "docs/adr").glob("*.md"))
    if REQUIRED_ADRS - {page.name for page in adr_pages}:
        errors.append("retained architecture decisions are missing")
    for page in adr_pages:
        head = "\n".join(page.read_text(encoding="utf-8").splitlines()[:24])
        if not re.search(r"(?im)^\s*-?\s*Status:\s*\S", head):
            errors.append(f"{page.relative_to(root)}: ADR must declare Status")
    readmes = [(root / name).read_text(encoding="utf-8") for name in ("README.md", "README.zh-CN.md") if (root / name).is_file()]
    for marker in ("install-mss.sh", "install-mss.ps1", "$env:Path", "mss new app", f"mss upgrade admin {version}", "mss-mcp", "MSS_ADMIN_INITIAL_PASSWORD"):
        if len(readmes) != 2 or any(marker not in text for text in readmes):
            errors.append(f"root README language pair is missing shared marker: {marker}")
    changelog = root / "CHANGELOG.md"
    if changelog.is_file() and f"## [{version}]" not in changelog.read_text(encoding="utf-8"):
        errors.append(f"CHANGELOG.md: missing {version} release entry")
    errors.extend(internal_link_errors(root))
    return sorted(set(errors))


def main() -> int:
    errors = collect_errors()
    if errors:
        print("current documentation contract failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"current documentation contract OK: {EXPECTED_DISTRIBUTION_VERSION}, new repository, GitHub Packages, links and history")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
