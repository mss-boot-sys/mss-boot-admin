#!/usr/bin/env python3
"""Verify the demo's public session contract without emitting any credentials."""
from __future__ import annotations

import argparse
import base64
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import secrets
import socket
import ssl
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, build_opener, HTTPCookieProcessor, HTTPRedirectHandler

ORIGIN = "https://demo.mss-boot-io.top"
BEACON_URL = "https://static.cloudflareinsights.com/beacon.min.js/v4bc70e2c01a94c73b74392e4234840661791215815920"
BEACON_INTEGRITY = "sha512-L0ha0OXavK/8okipN9F8BtP84dg9DUhPERbBXzwI6dgTA55d2+yweo3pn5CSFYs45/r8md2+xvUPtTdvTNRfjA=="


class VerificationError(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Session:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = build_opener(NoRedirect(), HTTPCookieProcessor(self.jar))

    def request(self, path, method="GET", body=None, headers=None, expected=(200,)):
        if not path.startswith("/") or path.startswith("//"):
            raise VerificationError("verification URL must stay on the demo origin")
        values = {"User-Agent": "MSS-Demo-Maintenance/1.0", "Cache-Control": "no-cache"}
        if headers:
            values.update(headers)
        if body is not None:
            body = json.dumps(body).encode()
            values["Content-Type"] = "application/json"
        req = Request(ORIGIN + path, body, values, method=method)
        try:
            response = self.opener.open(req, timeout=45)
        except HTTPError as error:
            response = error
        except (URLError, OSError):
            raise VerificationError(f"demo request unavailable: {method} {path}") from None
        with response:
            data = response.read(32 * 1024 * 1024 + 1)
            if response.status not in expected or len(data) > 32 * 1024 * 1024:
                raise VerificationError(f"unexpected demo response: {method} {path} HTTP {response.status}")
            return response.status, response.headers, data

    def csrf(self):
        values = [cookie.value for cookie in self.jar if cookie.name == "mss_csrf"]
        if len(values) != 1:
            raise VerificationError("signed CSRF cookie missing")
        return values[0]


class PageAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        attr = dict(attrs)
        if tag == "script" and attr.get("src"):
            self.paths.append(attr["src"])
        if tag == "link" and attr.get("rel") == "stylesheet" and attr.get("href"):
            self.paths.append(attr["href"])


def normalize_edge_html(content):
    """Ignore only the existing, SRI-pinned Cloudflare zone analytics injection.

    The application archive remains authoritative. No arbitrary external script,
    inline code, or other HTML difference is tolerated; zone settings are never
    changed by the demo deployment.
    """
    text = content.decode("utf-8")
    pattern = r'(<script\b[^>]*data-cf-beacon=[^>]*></script>\n)(?=</body>)'
    matches = list(re.finditer(pattern, text))
    if not matches:
        return content
    if len(matches) != 1:
        raise VerificationError("unexpected Cloudflare analytics markup")
    class Attributes(HTMLParser):
        attrs = None
        def handle_starttag(self, tag, attrs):
            if tag == "script":
                self.attrs = attrs
    parser = Attributes()
    parser.feed(matches[0].group(1))
    attrs = dict(parser.attrs or [])
    if (len(attrs) != len(parser.attrs or []) or set(attrs) !=
            {"type", "src", "integrity", "data-cf-beacon", "crossorigin"}
            or attrs.get("type") != "module" or attrs.get("src") != BEACON_URL
            or attrs.get("integrity") != BEACON_INTEGRITY or attrs.get("crossorigin") != "anonymous"):
        raise VerificationError("unexpected Cloudflare analytics script")
    try:
        settings = json.loads(attrs["data-cf-beacon"])
    except ValueError:
        raise VerificationError("unexpected Cloudflare analytics configuration") from None
    if (set(settings) != {"version", "token", "r", "spa"} or settings.get("version") != "2024.11.0"
            or settings.get("r") != 1 or settings.get("spa") != 2
            or not re.fullmatch(r"[0-9a-f]{32}", settings.get("token", ""))):
        raise VerificationError("unexpected Cloudflare analytics configuration")
    return (text[:matches[0].start()] + text[matches[0].end():]).encode("utf-8")


def websocket(ticket, protocol, expected_status=101):
    if protocol != "mss.v1" or not re.fullmatch(r"[A-Za-z0-9_-]{20,256}", ticket):
        raise VerificationError("invalid WebSocket ticket contract")
    key = base64.b64encode(secrets.token_bytes(16)).decode()
    request = (
        "GET /admin/api/ws/connect HTTP/1.1\r\n"
        "Host: demo.mss-boot-io.top\r\n"
        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Origin: {ORIGIN}\r\nSec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        f"Sec-WebSocket-Protocol: {protocol}, mss.ticket.{ticket}\r\n\r\n"
    )
    try:
        with socket.create_connection(("demo.mss-boot-io.top", 443), timeout=30) as plain:
            with ssl.create_default_context().wrap_socket(plain, server_hostname="demo.mss-boot-io.top") as sock:
                sock.sendall(request.encode())
                response = b""
                while b"\r\n\r\n" not in response and len(response) < 32768:
                    block = sock.recv(4096)
                    if not block:
                        break
                    response += block
                head = response.split(b"\r\n\r\n", 1)[0].decode("iso-8859-1")
                lines = head.split("\r\n")
                status = int(lines[0].split()[1])
                if status != expected_status:
                    raise VerificationError(f"WebSocket handshake returned HTTP {status}")
                if status == 101:
                    headers = {key.lower(): value.strip() for key, value in
                               (line.split(":", 1) for line in lines[1:] if ":" in line)}
                    accept = base64.b64encode(hashlib.sha1(
                        (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
                    if headers.get("sec-websocket-accept") != accept or headers.get("sec-websocket-protocol") != protocol:
                        raise VerificationError("invalid WebSocket upgrade response")
                    # A masked, empty close frame; do not retain the ticket or socket.
                    sock.sendall(b"\x88\x80" + secrets.token_bytes(4))
    except (OSError, ValueError, IndexError):
        raise VerificationError("WebSocket verification unavailable") from None


def verify(release, assets_dir=None):
    password = os.environ.get("DEMO_ADMIN_PASSWORD", "")
    if not password:
        raise VerificationError("DEMO_ADMIN_PASSWORD is required")
    session = Session()
    for path in ("/healthz", "/readyz"):
        session.request(path)
    _, _, identity = session.request("/release.json")
    public = json.loads(identity)
    if public.get("version") != release["version"] or public.get("commit") != release["commit"]:
        raise VerificationError("public frontend release identity mismatch")
    _, _, index = session.request("/")
    index = normalize_edge_html(index)
    if b"<html" not in index.lower():
        raise VerificationError("frontend root is not HTML")
    if assets_dir and hashlib.sha256(index).digest() != hashlib.sha256((Path(assets_dir) / "index.html").read_bytes()).digest():
        raise VerificationError("public index differs from official release bytes")
    for path in ("/user/login", "/user/oauth/callback/github", "/welcome"):
        _, _, deep = session.request(path)
        if normalize_edge_html(deep) != index:
            raise VerificationError("SPA deep link does not return the official index")
    parser = PageAssets()
    parser.feed(index.decode())
    if not parser.paths:
        raise VerificationError("frontend has no script or stylesheet assets")
    for value in parser.paths:
        target = urlparse(urljoin(ORIGIN + "/", value))
        if target.scheme + "://" + target.netloc != ORIGIN:
            raise VerificationError("frontend executable asset leaves the demo origin")
        _, _, data = session.request(target.path)
        if assets_dir:
            root = Path(assets_dir).resolve()
            asset = (root / target.path.lstrip("/")).resolve()
            if not asset.is_relative_to(root) or not asset.is_file() or data != asset.read_bytes():
                raise VerificationError("public executable asset differs from official release bytes")
    session.request("/admin/api/user/userInfo", expected=(401,))
    authenticated = False
    try:
        _, headers, body = session.request("/admin/api/user/session/login", "POST",
            {"username": "admin", "password": password}, {"Origin": ORIGIN})
        authenticated = True
        login = json.loads(body)
        if any(key in login for key in ("token", "accessToken", "refreshToken")) or not login.get("expire"):
            raise VerificationError("login exposed a credential or omitted session expiry")
        cookies = {cookie.name: cookie for cookie in session.jar}
        auth, csrf = cookies.get("mss_admin_session"), cookies.get("mss_csrf")
        if (not auth or not csrf or not auth.secure or not csrf.secure
                or not auth.has_nonstandard_attr("HttpOnly") or csrf.has_nonstandard_attr("HttpOnly")
                or auth.domain_specified or csrf.domain_specified
                or auth.path != "/admin/api" or csrf.path != "/"):
            raise VerificationError("session/CSRF cookie boundary mismatch")
        if "no-store" not in headers.get("Cache-Control", ""):
            raise VerificationError("login response permits caching")
        _, _, user = session.request("/admin/api/user/userInfo")
        if json.loads(user).get("username") != "admin":
            raise VerificationError("authenticated administrator identity mismatch")
        session.request("/admin/api/ws/tickets", "POST", {}, {"Origin": ORIGIN}, expected=(403,))
        session.request("/admin/api/ws/tickets", "POST", {},
            {"Origin": "https://untrusted.invalid", "X-CSRF-Token": session.csrf()}, expected=(403,))
        _, _, ticket_body = session.request("/admin/api/ws/tickets", "POST", {},
            {"Origin": ORIGIN, "X-CSRF-Token": session.csrf()}, expected=(201,))
        ticket = json.loads(ticket_body)
        websocket(ticket["ticket"], ticket["protocol"])
        websocket(ticket["ticket"], ticket["protocol"], expected_status=401)
        session.request("/admin/api/online-sessions/logout", "POST", {},
            {"Origin": ORIGIN, "X-CSRF-Token": session.csrf()}, expected=(200, 201, 204))
        authenticated = False
        session.request("/admin/api/user/userInfo", expected=(401,))
    finally:
        if authenticated:
            try:
                session.request("/admin/api/online-sessions/logout", "POST", {},
                    {"Origin": ORIGIN, "X-CSRF-Token": session.csrf()}, expected=(200, 201, 204))
            except Exception:
                pass
        session.jar.clear()
    return {"ok": True, "version": release["version"], "commit": release["commit"],
            "checks": ["health", "readiness", "official-static-bytes" if assets_dir else "public-static-assets", "spa-deep-links",
                       "login", "host-only-secure-cookies", "anonymous-denied", "csrf-denied",
                       "foreign-origin-denied", "websocket-upgrade", "ticket-replay-denied", "logout"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", required=True, type=Path)
    parser.add_argument("--assets-dir", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        result = verify(json.loads(args.release.read_text()), args.assets_dir)
        if args.output:
            args.output.write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result))
    except Exception as error:
        # HTTP bodies/cookies and password-bearing requests never enter diagnostics.
        print(json.dumps({"ok": False, "error": str(error) if isinstance(error, VerificationError)
                          else "live verification failed"}))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
