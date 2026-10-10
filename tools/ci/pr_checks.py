#!/usr/bin/env python3
"""Plan local checks and validate lightweight PR policy, without GitHub API access."""

import argparse
import json
import os
import re
import subprocess
from pathlib import Path

GO_MODULES = [".", "admin", "mss-boot", "compose/consul", "compose/kafka"]
LANGUAGES = ["actions", "go", "javascript-typescript"]
MAX_CHANGED_FILES = 140
OLD_MODULE = b"github.com/mss-boot-io/mss-boot-admin"
NEW_MODULE = b"github.com/mss-boot-sys/mss-boot-admin"


def migration_only_change(path, before, after):
    """Recognize the exact approved namespace/version rewrite, not arbitrary edits."""
    if before is None or after is None or b"\0" in before or b"\0" in after:
        return False
    expected = before.replace(b"mss-boot-io/mss-boot-admin", b"mss-boot-sys/mss-boot-admin")
    expected = expected.replace(b"@mss-boot-io/admin-web", b"@mss-boot-sys/admin-web")
    if before != after and expected == after:
        # Independent template revisions and historical fixture versions need
        # not change just because imports move to the new repository.
        return True
    if path.endswith((".mod", ".sum", ".mod.tmpl")) or path == "go.work":
        # Third-party dependency updates remain substantive even if their
        # version happens to equal the former Distribution version.
        expected = b"".join(
            line.replace(b"v1.3.7", b"v1.3.9") if NEW_MODULE in line else line
            for line in expected.splitlines(keepends=True)
        )
    else:
        expected = expected.replace(b"1.3.7-development", b"1.3.9")
        expected = re.sub(rb"(?<![0-9])1\.3\.7(?![0-9])", b"1.3.9", expected)
    if path == "web/antd-v6/package.json":
        expected = expected.replace(
            b'"registry": "https://registry.npmjs.org"',
            b'"registry": "https://npm.pkg.github.com"',
        )
    return before != after and expected == after


def git_blob(ref, path):
    result = subprocess.run(["git", "show", f"{ref}:{path}"], capture_output=True)
    return result.stdout if result.returncode == 0 else None


def mechanical_migration_paths(base, head, paths):
    # Use the same merge base as changed_paths, not unrelated newer main edits.
    merge_base = subprocess.check_output(["git", "merge-base", base, head], text=True).strip()
    old_module = git_blob(merge_base, "go.mod") or b""
    new_module = git_blob(head, "go.mod") or b""
    if not old_module.startswith(b"module " + OLD_MODULE + b"\n") or not new_module.startswith(b"module " + NEW_MODULE + b"\n"):
        return set()
    return {
        path for path in paths
        if migration_only_change(path, git_blob(merge_base, path), git_blob(head, path))
    }


def changed_paths(base, head):
    for sha in (base, head):
        if not re.fullmatch(r"[0-9a-f]{40}", sha) or sha == "0" * 40:
            raise ValueError("PR comparison requires nonzero full commit SHAs")
    # Include both sides of a rename, including a move out of a component.
    result = subprocess.run(
        ["git", "diff", "--no-renames", "--name-only", "-z", f"{base}...{head}", "--"],
        check=True, capture_output=True,
    )
    return sorted(set(result.stdout.decode("utf-8").strip("\0").split("\0")) - {""})


def plan_checks(paths):
    modules, languages = set(), set()
    web = docs = False
    for path in paths:
        if path.startswith("docs/"):
            docs = True
        elif path in {"README.md", "README.zh-CN.md", "CONTRIBUTING.md", "AGENTS.md",
                      "CODE_OF_CONDUCT.md", "SECURITY.md"}:
            # Only known top-level contributor prose can skip component checks.
            # Template Markdown and Agent contracts are inputs to generation.
            continue
        elif path.startswith("web/antd-v6/"):
            web = True
            languages.add("javascript-typescript")
        elif path.startswith("admin/"):
            modules.add("admin")
            languages.add("go")
        elif path.startswith("mss-boot/"):
            modules.update(["mss-boot", "admin"])
            languages.add("go")
        elif path.startswith("compose/consul/"):
            modules.add("compose/consul")
            languages.add("go")
        elif path.startswith("compose/kafka/"):
            modules.add("compose/kafka")
            languages.add("go")
        else:
            # Shared tooling/contracts or unknown paths affect every consumer.
            modules.update(GO_MODULES)
            languages.update(LANGUAGES)
            web = docs = True
    return {
        "go_modules": [item for item in GO_MODULES if item in modules],
        "languages": [item for item in LANGUAGES if item in languages],
        "web": web,
        "docs": docs,
    }


def check_documentation(paths):
    documented = any(re.search(r"(^docs/|README|CHANGELOG|\.md$)", p, re.I) for p in paths)
    governed = any(re.search(
        r"(api|apis|router|routes|swagger|openapi|config|deploy|compose|k8s|\.env|migration|sql|^\.github/workflows/)",
        p, re.I,
    ) for p in paths)
    if governed and not documented:
        raise ValueError("API, configuration, migration, deployment and workflow changes require documentation")


def check_pr_contract(paths, *, base=None, head=None):
    mechanical = mechanical_migration_paths(base, head, paths) if base and head else set()
    substantive = len(paths) - len(mechanical)
    if substantive > MAX_CHANGED_FILES:
        raise ValueError(f"PR changes {substantive} substantive paths ({len(paths)} total, {len(mechanical)} verified migration-only); maximum is {MAX_CHANGED_FILES}")
    check_documentation(paths)
    return {"total": len(paths), "substantive": substantive, "migration_only": len(mechanical)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base")
    parser.add_argument("--head")
    args = parser.parse_args()
    paths = changed_paths(args.base or "", args.head or "")
    counts = check_pr_contract(paths, base=args.base, head=args.head)
    plan = plan_checks(paths)
    output = json.dumps(plan, separators=(",", ":"))
    print(output)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as stream:
            stream.write(f"Local verification scope for {counts['total']} changed paths ({counts['substantive']} substantive, {counts['migration_only']} byte-verified namespace/version replacements):\n```json\n{output}\n```\n")


if __name__ == "__main__":
    main()
