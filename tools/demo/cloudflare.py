"""Stage and switch the existing demo Worker, without modifying routes or DNS.

API contracts: https://developers.cloudflare.com/workers/versions-and-deployments/
and https://developers.cloudflare.com/api/resources/workers/subresources/scripts/.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

from verify_live import NoRedirect, Session
from resolve_release import confined, inspect_archive, sha256

ACCOUNT = "126f4a0c75180e9493cb3716f5178574"
WORKER = "mss-boot-admin"
ZONE = "mss-boot-io.top"
HOST = "demo.mss-boot-io.top"
SCRIPT = f"/accounts/{ACCOUNT}/workers/scripts/{WORKER}"
EXCEPTIONS = ("/admin/*", "/admin", "/public/*", "/healthz", "/readyz", "/.well-known/acme-challenge/*")
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"


class CloudflareError(RuntimeError):
    pass


def headers_file(release):
    return ("/*\n  X-Content-Type-Options: nosniff\n"
            f"  X-MSS-Demo-Version: {release['version']}\n  Cache-Control: no-cache\n").encode()


def verify_assets(assets, release):
    """Refuse local asset drift even when release.json still has the right tag."""
    archive = confined(release["frontend"]["archive"]).read_bytes()
    if sha256(archive) != release["frontend"]["archive_sha256"]:
        raise CloudflareError("frontend archive digest changed after resolution")
    inventory = inspect_archive(archive)
    identity = json.loads(inventory["release.json"])
    if (identity.get("application") != "mss-boot-admin-antd-v6" or identity.get("version") != release["version"]
            or identity.get("commit") != release["commit"] or not inventory.get("index.html")):
        raise CloudflareError("frontend archive release identity mismatch")
    actual = {}
    for path in assets.rglob("*"):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise CloudflareError("frontend asset directory contains a link or special file")
        if path.is_file():
            actual[path.relative_to(assets).as_posix()] = path.read_bytes()
    for ignored in ("stats.json", "_headers"):
        if ignored == "_headers" and ignored in actual and actual[ignored] != headers_file(release):
            raise CloudflareError("demo asset headers were modified")
        actual.pop(ignored, None)
        inventory.pop(ignored, None)
    if actual != inventory:
        raise CloudflareError("frontend assets differ from the immutable official archive")


def validate_routes(routes):
    by_pattern = {route["pattern"]: route for route in routes}
    expected = {HOST + "/*": WORKER, **{HOST + value: None for value in EXCEPTIONS}}
    for pattern, script in expected.items():
        if pattern not in by_pattern or by_pattern[pattern].get("script") != script:
            raise CloudflareError("demo Worker route or API/ACME bypass has drifted")
    # Extra exact-host paths could silently divert login/API requests.
    if {route["pattern"] for route in routes if route["pattern"].startswith(HOST + "/")} != set(expected):
        raise CloudflareError("unexpected route on the demo hostname")
    return sorted(({"id": value["id"], "pattern": key, "script": value.get("script")}
                   for key, value in by_pattern.items() if key in expected), key=lambda value: value["pattern"])


class Cloudflare:
    def __init__(self):
        self.token = os.environ.get("CF_API_TOKEN", "")
        if not self.token:
            raise CloudflareError("CF_API_TOKEN is required")
        self.opener = build_opener(NoRedirect())

    def api(self, path, method="GET", body=None):
        data = None if body is None else json.dumps(body).encode()
        request = Request("https://api.cloudflare.com/client/v4" + path, data,
                          {"Authorization": "Bearer " + self.token, "Content-Type": "application/json"}, method=method)
        try:
            with self.opener.open(request, timeout=60) as response:
                value = json.load(response)
        except HTTPError as error:
            raise CloudflareError(f"Cloudflare {method} request failed with HTTP {error.code}") from None
        except (URLError, OSError, ValueError):
            raise CloudflareError("Cloudflare API request unavailable") from None
        if not value.get("success"):
            raise CloudflareError("Cloudflare API rejected the request")
        return value["result"]

    def snapshot(self):
        zones = self.api("/zones?name=" + ZONE + "&status=active")
        if len(zones) != 1 or zones[0].get("account", {}).get("id") != ACCOUNT:
            raise CloudflareError("Cloudflare demo zone/account mismatch")
        zone = zones[0]["id"]
        routes = validate_routes(self.api(f"/zones/{zone}/workers/routes"))
        subdomain = self.api(SCRIPT + "/subdomain")
        if subdomain.get("enabled") is not False or subdomain.get("previews_enabled") is not False:
            raise CloudflareError("demo workers.dev and preview URLs must both be disabled")
        deployments = self.api(SCRIPT + "/deployments")["deployments"]
        if not deployments:
            raise CloudflareError("existing Worker deployment is required for rollback")
        versions = deployments[0]["versions"]
        if len(versions) != 1 or versions[0]["percentage"] != 100:
            raise CloudflareError("demo must have one active Worker version")
        if not re.fullmatch(UUID, versions[0]["version_id"]):
            raise CloudflareError("invalid active Worker version")
        return {"zone_id": zone, "routes": routes, "subdomain": subdomain,
                "version_id": versions[0]["version_id"], "deployment_id": deployments[0]["id"]}

    def assert_boundaries(self, previous):
        current = self.snapshot()
        if current["routes"] != previous["routes"] or current["subdomain"] != previous["subdomain"]:
            raise CloudflareError("demo routing or preview settings changed during deployment")
        return current

    def assert_public_identity(self, release):
        _, _, body = Session().request("/release.json")
        identity = json.loads(body)
        if any(identity.get(key) != release[key] for key in ("version", "commit")):
            raise CloudflareError("existing frontend and backend release identities differ")

    def activate(self, version, message):
        if not re.fullmatch(UUID, version):
            raise CloudflareError("invalid Worker version for deployment")
        result = self.api(SCRIPT + "/deployments", "POST", {
            "strategy": "percentage", "versions": [{"version_id": version, "percentage": 100}],
            "annotations": {"workers/message": message},
        })
        return {"deployment_id": result["id"], "version_id": version}

    def stage(self, assets, release, directory, transaction):
        assets, directory = Path(assets).resolve(), Path(directory).resolve()
        root = Path(__file__).resolve().parents[2]
        if not assets.is_relative_to(root) or not directory.is_relative_to(root):
            raise CloudflareError("demo asset/config paths must remain in the repository")
        verify_assets(assets, release)
        # Remove only the release's optional build statistics. No application bytes change.
        (assets / "stats.json").unlink(missing_ok=True)
        (assets / "_headers").write_bytes(headers_file(release))
        config = {"name": WORKER, "account_id": ACCOUNT, "compatibility_date": "2026-10-11",
                  "workers_dev": False, "preview_urls": False,
                  "assets": {"directory": str(assets), "html_handling": "none",
                             "not_found_handling": "single-page-application"},
                  "observability": {"enabled": False}}
        path = directory / "worker.json"
        path.write_text(json.dumps(config, indent=2) + "\n")
        command = ["node", str(Path(__file__).parent / "node_modules/wrangler/bin/wrangler.js"),
                   "versions", "upload", "--config", str(path), "--message",
                   f"Demo {release['version']} {release['commit']} {transaction}"]
        # Give the CLI only the token it needs, never SSH or administrator credentials.
        env = {key: value for key, value in os.environ.items() if key in
               {"PATH", "HOME", "TMPDIR", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS"}}
        env.update({"CLOUDFLARE_API_TOKEN": self.token, "CLOUDFLARE_ACCOUNT_ID": ACCOUNT,
                    "CI": "true", "WRANGLER_SEND_METRICS": "false"})
        try:
            result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=600)
        except (OSError, subprocess.TimeoutExpired):
            raise CloudflareError("Worker version upload unavailable") from None
        if result.returncode:
            # Wrangler errors may include request diagnostics; never persist them.
            raise CloudflareError("Worker version upload failed; check Cloudflare permissions and asset compatibility")
        matches = re.findall(r"Worker Version ID:\s*(" + UUID + r")", result.stdout)
        if len(matches) != 1:
            raise CloudflareError("Worker version upload did not return one immutable version ID")
        return matches[0]
