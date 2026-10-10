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


def check_pr_contract(paths):
    # Retain the limit configured for the former reusable PR Guard.
    if len(paths) > MAX_CHANGED_FILES:
        raise ValueError(f"PR changes {len(paths)} paths; maximum is {MAX_CHANGED_FILES}")
    check_documentation(paths)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base")
    parser.add_argument("--head")
    args = parser.parse_args()
    paths = changed_paths(args.base or "", args.head or "")
    check_pr_contract(paths)
    plan = plan_checks(paths)
    output = json.dumps(plan, separators=(",", ":"))
    print(output)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as stream:
            stream.write(f"Local verification scope for {len(paths)} changed paths:\n```json\n{output}\n```\n")


if __name__ == "__main__":
    main()
