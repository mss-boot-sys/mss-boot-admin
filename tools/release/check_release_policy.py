#!/usr/bin/env python3
"""Small, dependency-free policy guard for tag-driven publication."""

from __future__ import annotations
import argparse
from pathlib import Path
import re
import sys

VERSION_RE = re.compile(r"^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$")
COORDINATED_COMPONENTS = ("root", "framework", "admin", "frontend")
COMPONENT_TEMPLATE_KEYS = {
    name: name + ("PackageTemplate" if name == "npm" else "TagTemplate")
    for name in (*COORDINATED_COMPONENTS, "docs", "npm")
}
REQUIRED_KEYS = {
    "mode",
    "publicationMode",
    "releaseBranch",
    "requireMergedPullRequestSource",
    "currentStableVersion",
    "currentStableCommit",
    "nextPublicVersion",
    "distributionVersion",
    "distributionComponents",
    "releaseTargetState",
    "publicationWorkflowsReady",
    "docsTagMutable",
    "publicPrereleases",
    "legacyRepository",
    "legacyStableVersion",
    *COMPONENT_TEMPLATE_KEYS.values(),
}
EXPECTED_TEMPLATES = {
    "root": "{version}",
    "framework": "mss-boot/{version}",
    "admin": "admin/{version}",
    "frontend": "web/antd-v6/{version}",
    "docs": "docs/{version}",
    "npm": "@mss-boot-sys/admin-web@{npmVersion}",
}


class PolicyError(ValueError):
    pass


def parse_scalar(value):
    if value in ("true", "false"):
        return value == "true"
    return value.strip("\"'")


def load_policy(path: Path) -> dict[str, object]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise PolicyError(f"cannot read release policy: {exc}") from exc
    policy = {}
    in_spec = False
    for line in lines:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line == "spec:":
            if in_spec:
                raise PolicyError("duplicate spec block")
            in_spec = True
            continue
        if not in_spec:
            continue
        match = re.fullmatch(r"  ([A-Za-z][A-Za-z0-9]*):\s*(.+)", line)
        if not match:
            raise PolicyError("unsupported release policy syntax")
        key, value = match.groups()
        if key in policy:
            raise PolicyError(f"duplicate release policy key: {key}")
        policy[key] = parse_scalar(value)
    missing = REQUIRED_KEYS - policy.keys()
    extra = policy.keys() - REQUIRED_KEYS
    if missing or extra:
        raise PolicyError(
            f"release policy keys invalid: missing={sorted(missing)}, unknown={sorted(extra)}"
        )
    if policy["mode"] != "development-first" or policy["publicationMode"] != "direct":
        raise PolicyError(
            "release policy must use direct development-first publication"
        )
    if (
        policy["releaseBranch"] != "main"
        or policy["requireMergedPullRequestSource"] is not True
    ):
        raise PolicyError(
            "release policy must require merged pull-request source on main"
        )
    for key in (
        "currentStableVersion",
        "nextPublicVersion",
        "distributionVersion",
        "legacyStableVersion",
    ):
        if not isinstance(policy[key], str) or not VERSION_RE.fullmatch(policy[key]):
            raise PolicyError(f"{key} must be a stable semantic version")
    if policy["nextPublicVersion"] != policy["distributionVersion"]:
        raise PolicyError("distributionVersion must equal nextPublicVersion")
    if policy["distributionComponents"] != ",".join(COORDINATED_COMPONENTS):
        raise PolicyError("distributionComponents do not match coordinated components")
    if policy["releaseTargetState"] != "active":
        raise PolicyError("release target is not active")
    for key in ("publicationWorkflowsReady", "docsTagMutable", "publicPrereleases"):
        if not isinstance(policy[key], bool):
            raise PolicyError(f"{key} must be a boolean")
    if policy["publicPrereleases"] is not False:
        raise PolicyError("public prereleases are disabled")
    if policy["docsTagMutable"] is not True:
        raise PolicyError("Docs must support governed website redeployment")
    commit = policy["currentStableCommit"]
    if commit == "pending":
        if policy["currentStableVersion"] != policy["nextPublicVersion"]:
            raise PolicyError("pending first release must equal nextPublicVersion")
    elif not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise PolicyError(
            "currentStableCommit must be a full commit or pending first release"
        )
    if (
        policy["legacyRepository"] != "mss-boot-io/mss-boot-admin"
        or policy["legacyStableVersion"] != "v1.3.8"
    ):
        raise PolicyError(
            "legacy releases must retain their original repository and last version"
        )
    for component, template in EXPECTED_TEMPLATES.items():
        if policy[COMPONENT_TEMPLATE_KEYS[component]] != template:
            raise PolicyError(f"{component} release template is not canonical")
    return policy


def release_ref(policy, component, version):
    if component not in COMPONENT_TEMPLATE_KEYS:
        raise PolicyError(f"unsupported release component: {component}")
    return str(policy[COMPONENT_TEMPLATE_KEYS[component]]).format(
        version=version, npmVersion=version.removeprefix("v")
    )


def check_public_ref(policy, component, version, tag, intent="publish", commit=None):
    if intent not in ("qualify", "publish"):
        raise PolicyError("only direct qualify or publish intent is supported")
    if not VERSION_RE.fullmatch(version):
        raise PolicyError("invalid stable release version")
    if tag != release_ref(policy, component, version):
        raise PolicyError(
            "tag or package ref does not match canonical component identity"
        )
    if version != policy["nextPublicVersion"]:
        raise PolicyError(
            f'public version {version} is forbidden; reviewed target is {policy["nextPublicVersion"]}'
        )
    if intent == "publish" and policy["publicationWorkflowsReady"] is not True:
        raise PolicyError("public tags and artifacts remain disabled")


def coordinated_tags(policy, version):
    result = {c: release_ref(policy, c, version) for c in COORDINATED_COMPONENTS}
    for c, tag in result.items():
        check_public_ref(policy, c, version, tag, intent="qualify")
    return result


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--policy", type=Path, default=Path(".mss/release-policy.yaml"))
    p.add_argument(
        "--component", choices=sorted(COMPONENT_TEMPLATE_KEYS), required=True
    )
    p.add_argument("--version", required=True)
    p.add_argument("--tag", required=True)
    p.add_argument("--intent", choices=("qualify", "publish"), default="publish")
    p.add_argument("--commit")
    a = p.parse_args(argv)
    try:
        check_public_ref(
            load_policy(a.policy), a.component, a.version, a.tag, a.intent, a.commit
        )
    except PolicyError as exc:
        print(f"release policy rejected: {exc}", file=sys.stderr)
        return 1
    print(f"release policy accepted {a.intent}: {a.component} {a.version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
