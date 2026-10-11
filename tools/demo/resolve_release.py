#!/usr/bin/env python3
"""Resolve a complete official release to verified, immutable demo inputs.

Read-only by default. ``--write`` materializes the verified frontend and receipt
below .mss/run only; it never builds, publishes, deploys, or reads demo secrets.
GitHub metadata uses the normal gh authentication context. GHCR uses an anonymous
public pull token, kept in memory and never written into the deployment receipt.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


REPOSITORY = "mss-boot-sys/mss-boot-admin"
IMAGE = f"ghcr.io/{REPOSITORY}"
ROOT = Path(__file__).resolve().parents[2]
VERSION = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")
COMMIT = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
MAX_DOWNLOAD = 128 * 1024 * 1024
MAX_EXTRACTED = 512 * 1024 * 1024
COMPONENTS = {
    "root": ("", "release.yml"),
    "framework": ("mss-boot/", "framework-release.yml"),
    "admin": ("admin/", "admin-release.yml"),
    "frontend": ("web/antd-v6/", "frontend-v6-release.yml"),
}
FRONTEND_FILES = ("dist-v6.tar.gz", "FRONTEND-V6-BUILD-INFO", "SHA256SUMS.frontend-v6")


class InvalidRelease(RuntimeError):
    """A mismatch or policy violation that cannot be solved by waiting."""


class NotReady(RuntimeError):
    """Publication is incomplete; retry only within the caller's bounded wait."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise InvalidRelease(message)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_json(data: bytes | str, context: str) -> dict:
    try:
        result = json.loads(data)
    except (ValueError, UnicodeDecodeError) as error:
        raise InvalidRelease(f"Invalid JSON in {context}") from error
    require(isinstance(result, dict), f"Expected an object in {context}")
    return result


class GitHub:
    def raw(self, path: str, *, binary: bool = False) -> bytes:
        command = ["gh", "api", f"repos/{REPOSITORY}/{path}"]
        command += ["-H", "Accept: application/octet-stream" if binary else "Accept: application/vnd.github+json"]
        try:
            result = subprocess.run(command, capture_output=True, timeout=120, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise NotReady("GitHub request unavailable") from error
        if result.returncode:
            # Do not expose gh stderr, authenticated URLs, or environment data.
            if b"HTTP 404" in result.stderr or b"HTTP 5" in result.stderr:
                raise NotReady("A required GitHub release resource is not available yet")
            raise InvalidRelease("GitHub request failed; check gh authentication and read permissions")
        require(len(result.stdout) <= MAX_DOWNLOAD, "GitHub asset exceeds download limit")
        return result.stdout

    def get(self, path: str) -> dict:
        return parse_json(self.raw(path), "GitHub response")

    def asset(self, asset: dict) -> bytes:
        require(isinstance(asset.get("id"), int), "Release asset has no numeric identity")
        expected = asset.get("digest", "")
        require(bool(DIGEST.fullmatch(expected)), f"Release asset {asset.get('name')} has no immutable SHA256 digest")
        data = self.raw(f"releases/assets/{asset['id']}", binary=True)
        require(len(data) == asset.get("size"), "Release asset size mismatch")
        require(f"sha256:{sha256(data)}" == expected, "Release asset GitHub SHA256 mismatch")
        return data


class Registry:
    """Verify OCI content by digest before trusting any metadata in it."""

    def __init__(self) -> None:
        self.token: str | None = None

    def fetch(self, path: str, *, media: bool = True) -> tuple[bytes, dict]:
        if self.token is None:
            query = urlencode({"service": "ghcr.io", "scope": f"repository:{REPOSITORY}:pull"})
            data, _ = self.request(f"https://ghcr.io/token?{query}", {})
            token = parse_json(data, "registry authentication").get("token")
            require(isinstance(token, str) and bool(token), "Registry did not grant public pull access")
            self.token = token
        headers = {"Authorization": f"Bearer {self.token}"}
        if media:
            headers["Accept"] = ", ".join((
                "application/vnd.oci.image.index.v1+json",
                "application/vnd.docker.distribution.manifest.list.v2+json",
                "application/vnd.oci.image.manifest.v1+json",
                "application/vnd.docker.distribution.manifest.v2+json",
            ))
        return self.request(f"https://ghcr.io/v2/{REPOSITORY}/{path}", headers)

    @staticmethod
    def request(url: str, headers: dict) -> tuple[bytes, dict]:
        try:
            with urlopen(Request(url, headers=headers), timeout=60) as response:
                data = response.read(MAX_DOWNLOAD + 1)
                require(len(data) <= MAX_DOWNLOAD, "Registry object exceeds download limit")
                return data, {key.lower(): value for key, value in response.headers.items()}
        except HTTPError as error:
            if error.code in (404, 429, 500, 502, 503, 504):
                raise NotReady("Official container publication is not available yet") from error
            raise InvalidRelease(f"Official registry request failed (HTTP {error.code})") from error
        except (URLError, TimeoutError) as error:
            raise NotReady("Official registry request unavailable") from error

    def object(self, kind: str, digest: str) -> dict:
        require(bool(DIGEST.fullmatch(digest)), "Malformed OCI object digest")
        data, headers = self.fetch(f"{kind}/{digest}", media=kind == "manifests")
        require(f"sha256:{sha256(data)}" == digest, "OCI content digest mismatch")
        advertised = headers.get("docker-content-digest")
        require(advertised is None or advertised == digest, "OCI response digest mismatch")
        return parse_json(data, "OCI object")

    def resolve(self, version: str, commit: str) -> dict:
        data, headers = self.fetch(f"manifests/{version}")
        digest = headers.get("docker-content-digest", "")
        require(bool(DIGEST.fullmatch(digest)), "Official image has no SHA256 index digest")
        require(f"sha256:{sha256(data)}" == digest, "Official image tag digest mismatch")
        # Re-read by immutable digest: subsequent deployment never uses the tag.
        index = self.object("manifests", digest)
        require(index.get("schemaVersion") == 2, "Unsupported OCI index schema")
        require(index.get("mediaType") in (
            "application/vnd.oci.image.index.v1+json",
            "application/vnd.docker.distribution.manifest.list.v2+json",
        ), "Official backend must be a multi-platform image index")
        platforms: dict[str, dict] = {}
        for descriptor in index.get("manifests", []):
            platform = descriptor.get("platform", {})
            if platform.get("os") != "linux":
                continue  # BuildKit provenance/SBOM descriptors use unknown/unknown.
            arch = platform.get("architecture")
            require(arch in ("amd64", "arm64") and arch not in platforms, "Unexpected or duplicate OCI Linux platform")
            manifest_digest = descriptor.get("digest", "")
            manifest = self.object("manifests", manifest_digest)
            require(manifest.get("schemaVersion") == 2, "Unsupported OCI manifest schema")
            config_digest = manifest.get("config", {}).get("digest", "")
            config = self.object("blobs", config_digest)
            require(config.get("architecture") == arch and config.get("os") == "linux", "OCI platform/config mismatch")
            labels = config.get("config", {}).get("Labels", {})
            require(labels.get("org.opencontainers.image.version") == version, "OCI version differs from release")
            require(labels.get("org.opencontainers.image.revision") == commit, "OCI commit differs from release")
            require(labels.get("org.opencontainers.image.source") == f"https://github.com/{REPOSITORY}", "OCI source repository mismatch")
            platforms[arch] = {"manifest_digest": manifest_digest, "config_digest": config_digest}
        require(set(platforms) == {"amd64", "arm64"}, "Official backend lacks a required Linux platform")
        return {"image": f"{IMAGE}@{digest}", "digest": digest, "platforms": platforms}


def tag_commit(github: GitHub, tag: str) -> str:
    ref = github.get(f"git/ref/tags/{quote(tag, safe='')}")
    require(ref.get("ref") == f"refs/tags/{tag}", "GitHub returned an unexpected tag")
    obj = ref.get("object", {})
    for _ in range(8):
        require(bool(COMMIT.fullmatch(obj.get("sha", ""))), "Invalid tag object identity")
        if obj.get("type") == "commit":
            return obj["sha"]
        require(obj.get("type") == "tag", "Tag does not resolve to a commit")
        obj = github.get(f"git/tags/{obj['sha']}").get("object", {})
    raise InvalidRelease("Excessively nested annotated tag")


def successful_run(github: GitHub, workflow: str, tag: str, commit: str) -> dict:
    query = urlencode({"head_sha": commit, "event": "push", "per_page": 100})
    result = github.get(f"actions/workflows/{workflow}/runs?{query}")
    matches = [run for run in result.get("workflow_runs", []) if
               run.get("head_sha") == commit and run.get("head_branch") == tag
               and run.get("event") == "push"
               and run.get("path") == f".github/workflows/{workflow}"]
    if not matches:
        raise NotReady(f"Waiting for official {workflow} publication run")
    run = max(matches, key=lambda item: (item.get("run_number", 0), item.get("run_attempt", 0), item.get("id", 0)))
    if run.get("status") != "completed":
        raise NotReady(f"Waiting for official {workflow} publication to complete")
    require(run.get("conclusion") == "success", f"Official {workflow} publication failed")
    for actor in ("actor", "triggering_actor"):
        require(run.get(actor, {}).get("login") == "mss-boot-sys", "Publication run was not authorized by the release operator")
    return {"id": run["id"], "attempt": run.get("run_attempt", 1), "url": run.get("html_url")}


def release_assets(release: dict) -> dict[str, dict]:
    assets = {}
    for asset in release.get("assets", []):
        name = asset.get("name")
        require(isinstance(name, str) and name not in assets, "Duplicate or invalid release asset name")
        if asset.get("state") != "uploaded":
            raise NotReady("Waiting for a release asset upload to complete")
        assets[name] = asset
    return assets


def metadata(github: GitHub, version: str, source_run: int | None = None) -> tuple[dict, dict]:
    require(bool(VERSION.fullmatch(version)), "Demo deployment requires an exact stable vX.Y.Z version")
    identities = {}
    workflows = {}
    releases = {}
    commit = None
    for component, (prefix, workflow) in COMPONENTS.items():
        tag = f"{prefix}{version}"
        resolved = tag_commit(github, tag)
        if commit is None:
            commit = resolved
        require(resolved == commit, "Coordinated release tags do not reference the same source commit")
        release = github.get(f"releases/tags/{quote(tag, safe='')}")
        require(release.get("tag_name") == tag, "Release tag identity mismatch")
        if release.get("draft"):
            raise NotReady(f"Waiting for public {component} release")
        require(release.get("prerelease") is False, "Demo deploys stable releases only")
        require(release.get("target_commitish") == commit, "Release target differs from immutable source commit")
        require(bool(release.get("published_at")), "Release has no publication timestamp")
        identities[component] = {"id": release["id"], "tag": tag, "url": release.get("html_url")}
        releases[component] = release_assets(release)
        workflows[component] = successful_run(github, workflow, tag, commit)
    workflows["container"] = successful_run(github, "container.yml", version, commit)
    if source_run is not None:
        require(source_run == workflows["root"]["id"], "Triggering run is not the successful official Root release run")
    main = github.get("git/ref/heads/main").get("object", {}).get("sha", "")
    require(bool(COMMIT.fullmatch(main)), "Remote main has an invalid commit")
    comparison = github.get(f"compare/{commit}...{main}")
    require(comparison.get("status") in ("ahead", "identical") and
            comparison.get("merge_base_commit", {}).get("sha") == commit,
            "Release source is not contained in the current remote main history")
    expected_root = {"SHA256SUMS", f"SHA256SUMS.tools-{version}", "install-mss.sh", "install-mss.ps1"}
    for platform in ("linux", "darwin", "windows"):
        for arch in ("amd64", "arm64"):
            expected_root.add(f"mss-boot-admin-{platform}-{arch}.zip")
            suffix = "zip" if platform == "windows" else "tar.gz"
            expected_root.add(f"mss-tools-{version}-{platform}-{arch}.{suffix}")
    if not expected_root.issubset(releases["root"]):
        raise NotReady("Waiting for the complete official Root artifact set")
    if not set(FRONTEND_FILES).issubset(releases["frontend"]):
        raise NotReady("Waiting for the complete official frontend artifact set")
    return ({"schema_version": 1, "repository": REPOSITORY, "version": version,
             "commit": commit, "remote_main": main, "releases": identities,
             "workflow_runs": workflows}, releases["frontend"])


def checksums(data: bytes) -> dict[str, str]:
    result = {}
    try:
        lines = data.decode("ascii").splitlines()
    except UnicodeDecodeError as error:
        raise InvalidRelease("Invalid frontend checksum encoding") from error
    for line in lines:
        match = re.fullmatch(r"([0-9a-f]{64}) [ *]([A-Za-z0-9._-]+)", line)
        require(match is not None, "Malformed frontend checksum entry")
        digest, name = match.groups()
        require(name not in result, "Duplicate frontend checksum entry")
        result[name] = digest
    require(set(result) == set(FRONTEND_FILES[:2]), "Unexpected frontend checksum coverage")
    return result


def verify_frontend(files: dict[str, bytes], version: str, commit: str) -> dict:
    sums = checksums(files["SHA256SUMS.frontend-v6"])
    for name, expected in sums.items():
        require(sha256(files[name]) == expected, "Official frontend checksum mismatch")
    try:
        lines = files["FRONTEND-V6-BUILD-INFO"].decode("utf-8").splitlines()
    except UnicodeDecodeError as error:
        raise InvalidRelease("Invalid frontend build information") from error
    require(len(lines) == 3 and set(lines) == {
        "application=mss-boot-admin-antd-v6", f"version={version}", f"commit={commit}",
    }, "Frontend build information differs from release identity")
    inventory = inspect_archive(files["dist-v6.tar.gz"])
    release = parse_json(inventory["release.json"], "frontend release.json")
    require(release.get("application") == "mss-boot-admin-antd-v6" and
            release.get("version") == version and release.get("commit") == commit,
            "Frontend release.json differs from release identity")
    require(bool(inventory.get("index.html")), "Frontend archive is missing index.html")
    return {"archive_sha256": sums["dist-v6.tar.gz"],
            "build_info_sha256": sums["FRONTEND-V6-BUILD-INFO"],
            "checksums_sha256": sha256(files["SHA256SUMS.frontend-v6"]),
            "file_count": len(inventory)}


def inspect_archive(data: bytes) -> dict[str, bytes]:
    """Never use extractall: reject links, traversal, devices and duplicate paths."""
    files: dict[str, bytes] = {}
    seen = set()
    size = 0
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            for item in archive:
                path = PurePosixPath(item.name)
                require(not path.is_absolute() and ".." not in path.parts and "\\" not in item.name,
                        "Unsafe path in frontend archive")
                require(bool(path.parts) and path.parts[0] == "dist", "Frontend archive contains files outside dist")
                require(str(path) not in seen, "Duplicate path in frontend archive")
                seen.add(str(path))
                require(len(seen) <= 10000, "Frontend archive contains too many entries")
                require(item.isdir() or item.isfile(), "Frontend archive contains a link or special file")
                if item.isdir():
                    continue
                require(len(path.parts) > 1, "Frontend archive has an invalid dist root")
                size += item.size
                require(size <= MAX_EXTRACTED, "Frontend archive exceeds extraction limit")
                content = archive.extractfile(item)
                require(content is not None, "Unreadable frontend archive entry")
                files[str(PurePosixPath(*path.parts[1:]))] = content.read()
    except (tarfile.TarError, OSError) as error:
        raise InvalidRelease("Malformed frontend archive") from error
    require("release.json" in files, "Frontend archive is missing release.json")
    for name in files:
        require(not any(str(parent) in files for parent in PurePosixPath(name).parents if str(parent) != "."),
                "Frontend archive has a file/directory collision")
    return files


def confined(path: str | Path, root: Path = ROOT) -> Path:
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = root / candidate
    # Reject symlinks, including within the path before resolve erases them.
    for part in (candidate, *candidate.parents):
        require(not part.is_symlink(), "Demo output paths must not contain symlinks")
    result = candidate.resolve()
    run_root = (root / ".mss/run").resolve()
    require(result.is_relative_to(run_root) and result != run_root,
            "Demo output must be confined below the repository .mss/run directory")
    return result


def receipt_identity(receipt: dict) -> tuple:
    return (receipt.get("repository"), receipt.get("version"), receipt.get("commit"),
            receipt.get("image"), receipt.get("digest"),
            receipt.get("frontend", {}).get("archive_sha256"),
            receipt.get("frontend", {}).get("build_info_sha256"))


def materialize(manifest: dict, files: dict[str, bytes], output: Path, assets: Path,
                root: Path = ROOT) -> None:
    output, assets = confined(output, root), confined(assets, root)
    require(output.suffix == ".json", "Deployment receipt must be a JSON file")
    require(not output.is_relative_to(assets), "Deployment receipt must be outside the assets directory")
    require(not assets.is_relative_to(output), "Assets directory conflicts with deployment receipt")
    previous = None
    if output.exists():
        previous = parse_json(output.read_bytes(), "existing deployment receipt")
        require(receipt_identity(previous) == receipt_identity(manifest),
                "Existing receipt locks a different release or artifact digest; use a new output path")
        require(previous.get("frontend", {}).get("assets_dir") == manifest["frontend"]["assets_dir"],
                "Existing receipt owns a different assets directory")
    if assets.exists():
        require(assets.is_dir() and (previous is not None or not any(assets.iterdir())),
                "Refusing to replace an unowned nonempty assets directory")
    for name in FRONTEND_FILES:
        destination = output.parent / name
        confined(destination, root)
        require(not assets.is_relative_to(destination) and not destination.is_relative_to(assets),
                "Assets directory conflicts with a verified download path")
        if destination.exists():
            require(destination.is_file() and destination.read_bytes() == files[name],
                    "Existing download locks different release bytes; use a new output directory")
    output.parent.mkdir(parents=True, exist_ok=True)
    assets.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="resolve-", dir=output.parent) as temporary:
        staging = Path(temporary) / "assets"
        staging.mkdir()
        for name, content in inspect_archive(files["dist-v6.tar.gz"]).items():
            destination = staging / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
            destination.chmod(0o644)
        for name, content in files.items():
            (Path(temporary) / name).write_bytes(content)
        receipt = Path(temporary) / "receipt.json"
        receipt.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        if assets.exists():
            shutil.rmtree(assets)
        os.replace(staging, assets)
        for name in files:
            os.replace(Path(temporary) / name, output.parent / name)
        # Receipt becomes visible last, after all verified inputs exist.
        os.replace(receipt, output)


def resolve(github: GitHub, registry: Registry, version: str, source_run: int | None = None) -> tuple[dict, dict]:
    manifest, asset_records = metadata(github, version, source_run)
    manifest.update(registry.resolve(version, manifest["commit"]))
    files = {name: github.asset(asset_records[name]) for name in FRONTEND_FILES}
    manifest["frontend"] = verify_frontend(files, version, manifest["commit"])
    return manifest, files


def wait_for_release(operation: Any, wait_seconds: int, *, sleep: Any = time.sleep,
                     monotonic: Any = time.monotonic) -> tuple[dict, dict]:
    deadline = monotonic() + wait_seconds
    while True:
        try:
            return operation()
        except NotReady as error:
            remaining = deadline - monotonic()
            if remaining <= 0:
                raise InvalidRelease(f"Release readiness deadline exceeded: {error}") from error
            print(f"{error}; waiting for complete release artifacts", file=sys.stderr, flush=True)
            sleep(min(30, remaining))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--assets-dir", required=True)
    parser.add_argument("--source-run", type=int)
    parser.add_argument("--wait-seconds", type=int, default=0)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    try:
        require(bool(VERSION.fullmatch(args.version)), "Demo deployment requires an exact stable vX.Y.Z version")
        require(0 <= args.wait_seconds <= 3600, "Release readiness wait must be between 0 and 3600 seconds")
        require(args.source_run is None or args.source_run > 0, "Source run must be a positive numeric ID")
        output, assets = confined(args.output), confined(args.assets_dir)
        manifest, files = wait_for_release(
            lambda: resolve(GitHub(), Registry(), args.version, args.source_run), args.wait_seconds)
        manifest["frontend"].update({
            "assets_dir": str(assets.relative_to(ROOT)),
            "archive": str((output.parent / "dist-v6.tar.gz").relative_to(ROOT)),
        })
        if args.write:
            materialize(manifest, files, output, assets)
        print(json.dumps({"write": args.write, "manifest": manifest,
                          "changed_files": [str(output.relative_to(ROOT)),
                                            *[str((output.parent / name).relative_to(ROOT)) for name in FRONTEND_FILES],
                                            str(assets.relative_to(ROOT))] if args.write else []}, indent=2, sort_keys=True))
        return 0
    except (InvalidRelease, NotReady, OSError) as error:
        print(f"Demo release resolution failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
