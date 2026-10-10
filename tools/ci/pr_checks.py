#!/usr/bin/env python3
"""Plan scoped PR checks and validate their aggregate, without GitHub API access."""

import argparse
import json
import os
import re
import subprocess
from pathlib import Path

GO_MODULES = [".", "admin", "mss-boot", "compose/consul", "compose/kafka"]
LANGUAGES = ["actions", "go", "javascript-typescript"]
JOBS = ["go", "web", "docs", "codeql"]
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
        elif path.endswith(".md") or path.startswith((".agents/", ".codex/", ".cursor/")):
            # Contributor instructions and Markdown have no executable component.
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


def check_results(needs):
    if set(needs) != {"plan", *JOBS} or needs["plan"]["result"] != "success":
        raise ValueError("Missing checks or unsuccessful PR plan")
    plan = json.loads(needs["plan"]["outputs"]["plan"])
    if set(plan) != {"go_modules", "languages", "web", "docs"}:
        raise ValueError("Invalid PR plan")
    for key, allowed in (("go_modules", GO_MODULES), ("languages", LANGUAGES)):
        if not isinstance(plan[key], list) or any(item not in allowed for item in plan[key]):
            raise ValueError("Invalid PR matrix")
    if type(plan["web"]) is not bool or type(plan["docs"]) is not bool:
        raise ValueError("Invalid PR component selection")
    selected = {"go": bool(plan["go_modules"]), "codeql": bool(plan["languages"]),
                "web": plan["web"], "docs": plan["docs"]}
    for job in JOBS:
        expected = "success" if selected[job] else "skipped"
        if needs[job]["result"] != expected:
            raise ValueError(f"{job}: expected {expected}, got {needs[job]['result']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base")
    parser.add_argument("--head")
    parser.add_argument("--check-results", action="store_true")
    args = parser.parse_args()
    if args.check_results:
        check_results(json.loads(os.environ["PR_NEEDS"]))
        print("Every selected PR check passed.")
        return
    paths = changed_paths(args.base or "", args.head or "")
    check_pr_contract(paths)
    plan = plan_checks(paths)
    output = json.dumps(plan, separators=(",", ":"))
    print(output)
    if os.environ.get("GITHUB_OUTPUT"):
        with Path(os.environ["GITHUB_OUTPUT"]).open("a") as stream:
            stream.write(f"plan={output}\n")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as stream:
            stream.write(f"PR plan for {len(paths)} changed paths:\n```json\n{output}\n```\n")


if __name__ == "__main__":
    main()
