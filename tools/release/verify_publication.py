#!/usr/bin/env python3
"""Validate an actor-bound, PR-produced tag before building or publishing."""

import argparse
import json
import os
from pathlib import Path
import subprocess
from check_release_policy import check_public_ref, load_policy
from verify_release_source import verify_release_source

PREFIXES = {
    "root": "",
    "framework": "mss-boot/",
    "admin": "admin/",
    "frontend": "web/antd-v6/",
    "docs": "docs/",
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--component", choices=PREFIXES, required=True)
    a = parser.parse_args()
    if (
        os.environ.get("GITHUB_ACTOR") != "mss-boot-sys"
        or os.environ.get("GITHUB_TRIGGERING_ACTOR") != "mss-boot-sys"
    ):
        raise ValueError("unauthorized release operator")
    repository = os.environ["GITHUB_REPOSITORY"]
    commit = os.environ["GITHUB_SHA"]
    tag = os.environ["GITHUB_REF_NAME"]
    if repository != "mss-boot-sys/mss-boot-admin":
        raise ValueError("unexpected publication repository")
    prefix = PREFIXES[a.component]
    if not tag.startswith(prefix):
        raise ValueError("unexpected component tag")
    version = tag[len(prefix) :]
    policy_path = Path(".mss/release-policy.yaml")
    policy = load_policy(policy_path)
    check_public_ref(policy, a.component, version, tag)
    verify_release_source(
        repository_root=Path("."),
        policy_path=policy_path,
        repository=repository,
        commit=commit,
        tag=tag,
        source_mode="docs" if a.component == "docs" else "release",
    )
    manifest = json.loads(Path("web/antd-v6/package.json").read_text())
    if (
        manifest["version"] != version[1:]
        or manifest["name"] != "@mss-boot-sys/admin-web"
    ):
        raise ValueError("frontend manifest is not aligned with release")
    required = {
        "root": ["mss-boot/", "admin/", "web/antd-v6/"],
        "frontend": ["admin/"],
    }.get(a.component, [])
    for component_prefix in required:
        component_tag = component_prefix + version
        resolved = subprocess.check_output(
            ["git", "rev-parse", component_tag + "^{commit}"], text=True
        ).strip()
        if resolved != commit:
            raise ValueError(f"{component_tag} source mismatch")
        release = json.loads(
            subprocess.check_output(
                [
                    "gh",
                    "release",
                    "view",
                    component_tag,
                    "--repo",
                    repository,
                    "--json",
                    "tagName,isDraft,isPrerelease,targetCommitish",
                ],
                text=True,
            )
        )
        if release != {
            "tagName": component_tag,
            "isDraft": False,
            "isPrerelease": False,
            "targetCommitish": commit,
        }:
            raise ValueError(f"{component_tag} is not the exact public release")
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"version={version}\n")
    print(f"accepted {a.component} {version} at {commit}")


if __name__ == "__main__":
    main()
