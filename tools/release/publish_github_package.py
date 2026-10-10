#!/usr/bin/env python3
"""Publish one immutable, checksummed Admin Web tarball to GitHub Packages."""

from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from verify_admin_web_package import inspect_package, PACKAGE_NAME

REGISTRY = "https://npm.pkg.github.com"


def same_identity(metadata, evidence):
    package = evidence["package"]
    artifact = evidence["artifact"]
    if (
        not isinstance(metadata, dict)
        or any(
            metadata.get(k) != package[k]
            for k in ("name", "version", "gitHead", "repository")
        )
        or metadata.get("dist", {}).get("integrity") != artifact["integrity"]
    ):
        raise ValueError(
            "existing GitHub Packages version has a different immutable identity"
        )


def npm(args, env, check=True):
    result = subprocess.run(
        ["npm", *args, "--registry=" + REGISTRY, "--json"],
        env=env,
        capture_output=True,
        text=True,
    )
    if check and result.returncode:
        raise ValueError("GitHub Packages operation failed: " + result.stderr)
    return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--directory", type=Path, required=True)
    p.add_argument("--version", required=True)
    a = p.parse_args()
    files = list(a.directory.glob("*.tgz"))
    if len(files) != 1:
        raise ValueError("exactly one release tarball is required")
    tarball = files[0].resolve()
    commit = os.environ["GITHUB_SHA"]
    repository = os.environ["GITHUB_REPOSITORY"]
    evidence = inspect_package(
        tarball,
        expected_name=PACKAGE_NAME,
        expected_version=a.version,
        source_repository=repository,
        source_commit=commit,
    )
    if not os.environ.get("NODE_AUTH_TOKEN"):
        raise ValueError("GitHub Packages authentication is required")
    with tempfile.TemporaryDirectory() as directory:
        config = Path(directory) / ".npmrc"
        config.write_text(
            "@mss-boot-sys:registry="
            + REGISTRY
            + "\n//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n"
        )
        config.chmod(0o600)
        env = os.environ.copy()
        env["NPM_CONFIG_USERCONFIG"] = str(config)
        spec = f"{PACKAGE_NAME}@{a.version}"
        result = npm(["view", spec], env, check=False)
        if result.returncode:
            try:
                code = json.loads(result.stdout).get("error", {}).get("code")
            except json.JSONDecodeError:
                code = None
            if code != "E404":
                raise ValueError("cannot verify package absence; refusing publication")
            npm(["publish", str(tarball), "--ignore-scripts", "--tag=latest"], env)
            result = npm(["view", spec], env)
        same_identity(json.loads(result.stdout), evidence)
        download = Path(directory) / "download"
        download.mkdir()
        packed = json.loads(
            npm(
                ["pack", spec, "--ignore-scripts", "--pack-destination", str(download)],
                env,
            ).stdout
        )
        name = packed[0]["filename"]
        if Path(name).name != name:
            raise ValueError("unsafe package download filename")
        fetched = download / name
        if (
            hashlib.sha256(fetched.read_bytes()).hexdigest()
            != evidence["artifact"]["sha256"]
        ):
            raise ValueError("registry tarball differs from the released artifact")
    print(f'GitHub Packages verified: {spec} {evidence["artifact"]["integrity"]}')


if __name__ == "__main__":
    main()
