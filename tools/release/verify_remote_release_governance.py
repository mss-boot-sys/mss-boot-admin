#!/usr/bin/env python3
"""Read-only verification of the main/immutable-tag and environment boundaries."""

import argparse
import fnmatch
import json
import re
import subprocess

CORE_REFS = [
    "refs/tags/v1.3.9",
    "refs/tags/mss-boot/v1.3.9",
    "refs/tags/admin/v1.3.9",
    "refs/tags/web/antd-v6/v1.3.9",
]
ENVIRONMENTS = {
    "release-auto": ["v*", "mss-boot/v*", "admin/v*"],
    "release-v6-auto": ["web/antd-v6/v*"],
    "prod": ["docs/v*"],
}


def api(path):
    result = subprocess.run(["gh", "api", path], capture_output=True, text=True)
    if result.returncode:
        raise ValueError("cannot inspect " + path + ": " + result.stderr)
    return json.loads(result.stdout)


def matches(rule, ref):
    condition = rule.get("conditions", {}).get("ref_name", {})
    include = condition.get("include", [])
    exclude = condition.get("exclude", [])
    return any(
        p == "~ALL"
        or p == "~DEFAULT_BRANCH"
        and ref == "refs/heads/main"
        or fnmatch.fnmatchcase(ref, p)
        for p in include
    ) and not any(fnmatch.fnmatchcase(ref, p) for p in exclude)


def validate_rules(rules, scope):
    active = [
        r
        for r in rules
        if r.get("enforcement") == "active" and not r.get("bypass_actors")
    ]
    main = [
        r
        for r in active
        if r.get("target") == "branch" and matches(r, "refs/heads/main")
    ]
    types = {i["type"] for r in main for i in r.get("rules", [])}
    if not {"pull_request", "deletion", "non_fast_forward"} <= types:
        raise ValueError(
            "main must require pull requests and prevent deletion/force updates without bypass"
        )
    refs = ["refs/tags/docs/v1.3.9"] if scope == "docs" else CORE_REFS
    for ref in refs:
        tagtypes = {
            i["type"]
            for r in active
            if r.get("target") == "tag" and matches(r, ref)
            for i in r.get("rules", [])
        }
        expected = {"update"} if scope == "docs" else {"update", "deletion"}
        if not expected <= tagtypes:
            raise ValueError("immutable tag policy is missing for " + ref)


def validate_environment(environment, policies, expected):
    if environment.get("can_admins_bypass") is not False:
        raise ValueError("publishing environment must disable administrator bypass")
    if environment.get("deployment_branch_policy") != {
        "protected_branches": False,
        "custom_branch_policies": True,
    }:
        raise ValueError("publishing environment must select explicit tag policies")
    if any(
        r.get("type") == "required_reviewers"
        for r in environment.get("protection_rules", [])
    ):
        raise ValueError("publishing environment must not add an approval pause")
    actual = {
        (p.get("type"), p.get("name")) for p in policies.get("branch_policies", [])
    }
    if actual != {("tag", x) for x in expected}:
        raise ValueError("publishing environment tag scope differs from workflows")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--repository", required=True)
    p.add_argument("--release-actor-login", required=True)
    p.add_argument("--scope", choices=("core", "docs"), default="core")
    a = p.parse_args()
    if (
        not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", a.repository)
        or a.release_actor_login != "mss-boot-sys"
    ):
        raise ValueError("unexpected repository or release operator")
    repo = api(f"/repos/{a.repository}")
    if not repo.get("permissions", {}).get("admin"):
        raise ValueError(
            "repository administrator access is required to verify governance"
        )
    if repo.get("owner", {}).get("login") != a.release_actor_login:
        raise ValueError("release operator must own the migrated repository")
    summaries = api(
        f"/repos/{a.repository}/rulesets?includes_parents=true&per_page=100"
    )
    if len(summaries) >= 100:
        raise ValueError("ruleset results may be truncated")
    rules = [
        api(f'/repos/{a.repository}/rulesets/{r["id"]}?includes_parents=true')
        for r in summaries
    ]
    validate_rules(rules, a.scope)
    names = ["prod"] if a.scope == "docs" else ["release-auto", "release-v6-auto"]
    for name in names:
        environment = api(f"/repos/{a.repository}/environments/{name}")
        policies = api(
            f"/repos/{a.repository}/environments/{name}/deployment-branch-policies?per_page=100"
        )
        validate_environment(environment, policies, ENVIRONMENTS[name])
    if a.scope == "docs":
        repository_secrets = api(f"/repos/{a.repository}/actions/secrets?per_page=100")
        environment_secrets = api(
            f'/repositories/{repo["id"]}/environments/prod/secrets?per_page=100'
        )
        if not any(
            s.get("name") == "CF_API_TOKEN"
            for listing in (repository_secrets, environment_secrets)
            for s in listing.get("secrets", [])
        ):
            raise ValueError(
                "CF_API_TOKEN must be configured in repository or prod environment secrets"
            )
    print(
        json.dumps(
            {
                "repository": a.repository,
                "scope": a.scope,
                "operator": a.release_actor_login,
                "verified": True,
                "environments": names,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
