#!/usr/bin/env python3
"""Stage a draft once, verify all downloaded assets, then publish without overwrite."""

from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


def gh(args, check=True):
    result = subprocess.run(["gh", *args], capture_output=True, text=True)
    if check and result.returncode:
        raise ValueError("GitHub release operation failed: " + result.stderr)
    return result


def validate_release(release, tag, commit):
    if (
        release.get("tagName") != tag
        or release.get("targetCommitish") != commit
        or release.get("isPrerelease") is not False
    ):
        raise ValueError(
            "existing release identity differs from the exact release source"
        )


def verify_download(directory, expected):
    actual = {p.name: p for p in directory.iterdir() if p.is_file()}
    if set(actual) != set(expected):
        raise ValueError("published asset names do not match the build")
    for name, path in actual.items():
        if (
            hashlib.sha256(path.read_bytes()).digest()
            != hashlib.sha256(expected[name].read_bytes()).digest()
        ):
            raise ValueError("published bytes differ: " + name)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--directory", type=Path, required=True)
    p.add_argument("--latest", action="store_true")
    a = p.parse_args()
    tag = os.environ["GITHUB_REF_NAME"]
    commit = os.environ["GITHUB_SHA"]
    repo = os.environ["GITHUB_REPOSITORY"]
    env_repo = ["--repo", repo]
    expected = {p.name: p.resolve() for p in a.directory.iterdir() if p.is_file()}
    if not expected:
        raise ValueError("release assets are empty")
    response = gh(
        [
            "release",
            "view",
            tag,
            *env_repo,
            "--json",
            "tagName,targetCommitish,isDraft,isPrerelease,assets",
        ],
        check=False,
    )
    if response.returncode:
        if not any(
            marker in response.stderr
            for marker in ("release not found", "HTTP 404", "Not Found")
        ):
            raise ValueError("release absence is not authoritative")
        with tempfile.TemporaryDirectory() as directory:
            notes = Path(directory) / "notes.md"
            notes.write_text(
                f"# MSS {tag}\n\nSource commit: `{commit}`\n\nFirst release in `mss-boot-sys` is 1.3.9; earlier versions belong to `mss-boot-io`.\n\nSee the repository changelog and https://docs.mss-boot-io.top/ for upgrade instructions.\n"
            )
            gh(
                [
                    "release",
                    "create",
                    tag,
                    *env_repo,
                    "--verify-tag",
                    "--target",
                    commit,
                    "--title",
                    tag,
                    "--draft",
                    "--latest=false",
                    "--notes-file",
                    str(notes),
                ]
            )
        release = {
            "tagName": tag,
            "targetCommitish": commit,
            "isPrerelease": False,
            "isDraft": True,
            "assets": [],
        }
    else:
        release = json.loads(response.stdout)
    validate_release(release, tag, commit)
    names = {asset["name"] for asset in release["assets"]}
    if not names <= expected.keys():
        raise ValueError("unexpected existing release assets")
    if not release["isDraft"] and names != expected.keys():
        raise ValueError("cannot append to an immutable public release")
    missing = [str(path) for name, path in expected.items() if name not in names]
    if missing:
        gh(["release", "upload", tag, *env_repo, *missing])
    with tempfile.TemporaryDirectory() as directory:
        gh(["release", "download", tag, *env_repo, "--dir", directory])
        verify_download(Path(directory), expected)
    if release["isDraft"]:
        gh(
            [
                "release",
                "edit",
                tag,
                *env_repo,
                "--draft=false",
                "--latest=" + str(a.latest).lower(),
            ]
        )
    print(f"Published and verified {tag}: {len(expected)} immutable assets")


if __name__ == "__main__":
    main()
