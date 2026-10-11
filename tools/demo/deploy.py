#!/usr/bin/env python3
"""Deploy one resolved official release to both halves of the persistent demo."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

from cloudflare import Cloudflare, CloudflareError
from verify_live import verify, VerificationError

ROOT = Path(__file__).resolve().parents[2]


class DeploymentError(RuntimeError):
    pass


class BackendBusy(DeploymentError):
    pass


def safe_path(value):
    candidate = Path(value).absolute()
    if any(part.is_symlink() for part in (candidate, *candidate.parents)):
        raise DeploymentError("demo state paths must not contain symlinks")
    path = candidate.resolve()
    if not path.is_relative_to(ROOT) or path == ROOT:
        raise DeploymentError("demo state paths must remain inside the repository")
    return path


def validate_release(value):
    if (value.get("schema_version") != 1 or value.get("repository") != "mss-boot-sys/mss-boot-admin"
            or not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", value.get("version", ""))
            or not re.fullmatch(r"[0-9a-f]{40}", value.get("commit", ""))
            or not re.fullmatch(r"ghcr\.io/mss-boot-sys/mss-boot-admin@sha256:[0-9a-f]{64}", value.get("image", ""))):
        raise DeploymentError("invalid resolved official release manifest")
    if value.get("digest") != value["image"].split("@", 1)[1]:
        raise DeploymentError("backend digest and image identity differ")
    return value


class Backend:
    def __init__(self, directory):
        host = os.environ.get("DEMO_SSH_HOST", "")
        user = os.environ.get("DEMO_SSH_USER", "root")
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]*", host) or not re.fullmatch(r"[a-z_][a-z0-9_-]*", user):
            raise DeploymentError("DEMO_SSH_HOST or DEMO_SSH_USER is missing or invalid")
        private = directory / "private"
        if private.is_symlink():
            raise DeploymentError("demo private directory must not be a symlink")
        private.mkdir(mode=0o700, exist_ok=True)
        private.chmod(0o700)
        self.key, self.hosts = private / "key", private / "known_hosts"
        for path, variable in ((self.key, "DEMO_SSH_KEY"), (self.hosts, "DEMO_SSH_KNOWN_HOSTS")):
            value = os.environ.get(variable, "")
            if not value:
                self.close()
                raise DeploymentError(variable + " is required")
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "w") as stream:
                stream.write(value.rstrip() + "\n")
            path.chmod(0o600)
        self.command = ["ssh", "-F", "/dev/null", "-T", "-i", str(self.key), "-o", "BatchMode=yes",
                        "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "-o",
                        "UserKnownHostsFile=" + str(self.hosts), "-o", "ConnectTimeout=20", "-o",
                        "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", user + "@" + host]

    def call(self, action, transaction=None, release=None):
        request = {"action": action}
        if action != "status":
            request.update({"transaction": transaction,
                            "release": {key: release[key] for key in ("version", "commit", "image")}})
        try:
            env = {key: value for key, value in os.environ.items() if key in {"PATH", "HOME", "LANG", "LC_ALL"}}
            result = subprocess.run(self.command, input=json.dumps(request) + "\n",
                                    text=True, capture_output=True, timeout=1500, env=env)
            response = json.loads(result.stdout)
        except (OSError, ValueError, subprocess.TimeoutExpired):
            raise DeploymentError("demo backend " + action + " did not return a confirmed receipt") from None
        if response.get("error") == "another_call_is_running":
            raise BackendBusy("demo backend operation is still running")
        if result.returncode or response.get("ok") is not True:
            raise DeploymentError("demo backend " + action + " failed; inspect its private server receipt")
        return response

    def close(self):
        for path in (getattr(self, "key", None), getattr(self, "hosts", None)):
            if path:
                path.unlink(missing_ok=True)


def save(path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    temp.replace(path)


def backend_status(backend):
    deadline = time.monotonic() + 900
    while True:
        try:
            return backend.call("status")
        except BackendBusy:
            if time.monotonic() >= deadline:
                raise DeploymentError("backend operation is still running; retain receipt for operator recovery") from None
            time.sleep(5)


def rollback(cf, backend, receipt, path, verify_fn=verify):
    if receipt["phase"] in ("committed", "rolled_back", "staged", "aborted"):
        return receipt
    # The remote commit may have succeeded while its SSH response was lost.
    status = backend_status(backend)
    if status.get("transaction") != receipt["transaction"]:
        if receipt["phase"] == "preparing":
            # The server rejected prepare before owning this transaction. Never
            # roll back another operator's active or recently committed release.
            receipt["phase"] = "aborted"
            save(path, receipt)
            return receipt
        raise DeploymentError("backend transaction changed; automatic rollback is unsafe")
    if status.get("transaction") == receipt["transaction"] and status.get("state") == "committed":
        receipt["phase"] = "committed"
        save(path, receipt)
        return receipt
    failures = []
    if receipt.get("frontend_mutation_started"):
        try:
            cf.activate(receipt["previous_frontend"]["version_id"], "Demo rollback " + receipt["transaction"])
            cf.assert_boundaries(receipt["previous_frontend"])
        except Exception:
            failures.append("frontend")
    try:
        receipt["backend_rollback"] = backend.call("rollback", receipt["transaction"], receipt["release"])
    except Exception:
        failures.append("backend")
    if not failures:
        previous = receipt["backend_rollback"].get("previous")
        if previous:
            try:
                receipt["rollback_verification"] = verify_fn(previous)
            except Exception:
                failures.append("restored-public-contract")
        else:
            failures.append("missing-restored-identity")
    if not failures:
        try:
            receipt["backend_rollback_finalized"] = backend.call("finalize-rollback", receipt["transaction"], receipt["release"])
        except Exception:
            failures.append("rollback-acknowledgement")
    receipt["phase"] = "rollback_failed" if failures else "rolled_back"
    receipt["rollback_failures"] = failures
    save(path, receipt)
    if failures:
        raise DeploymentError("demo rollback needs operator recovery: " + ", ".join(failures))
    return receipt


def deploy(cf, backend, release, directory, transaction, verify_fn=verify):
    path = directory / "receipt.json"
    if path.exists():
        existing = json.loads(path.read_text())
        if existing["transaction"] != transaction or existing["release"] != release:
            raise DeploymentError("state directory belongs to another deployment; retain it for recovery")
        if existing["phase"] == "committed":
            return existing
        raise DeploymentError("existing deployment receipt requires --rollback before a new transaction")
    status = backend_status(backend)
    if status.get("state") not in ("idle", "committed", "rolled_back"):
        raise DeploymentError("an unfinished backend transaction requires recovery first")
    previous = cf.snapshot()
    assets = safe_path(release["frontend"]["assets_dir"])
    # Staging does not change traffic. Resolve/validate every official artifact first.
    version = cf.stage(assets, release, directory, transaction)
    cf.assert_boundaries(previous)
    receipt = {"schema_version": 1, "transaction": transaction, "release": release,
               "previous_frontend": previous, "frontend_version": version,
               "frontend_mutation_started": False, "phase": "staged"}
    save(path, receipt)
    try:
        # Mark intent before sending: a lost SSH response still requires recovery.
        receipt["phase"] = "preparing"
        save(path, receipt)
        receipt["backend_backup"] = backend.call("prepare", transaction, release)
        # Capture the rollback pair while holding the backend transaction lock.
        # Another invocation may have committed while this invocation uploaded
        # assets; the pre-staging Worker snapshot is not authoritative here.
        receipt["previous_frontend"] = cf.assert_boundaries(previous)
        cf.assert_public_identity(receipt["backend_backup"]["previous"])
        receipt["phase"] = "prepared"
        save(path, receipt)
        receipt["backend_deploy"] = backend.call("deploy", transaction, release)
        receipt["phase"] = "backend_deployed"
        save(path, receipt)
        current = cf.assert_boundaries(receipt["previous_frontend"])
        if current["version_id"] != receipt["previous_frontend"]["version_id"]:
            raise DeploymentError("Worker changed outside the demo transaction; refusing activation")
        receipt["frontend_mutation_started"] = True
        save(path, receipt)
        receipt["frontend_deploy"] = cf.activate(version, "Demo " + release["version"] + " " + transaction)
        receipt["phase"] = "frontend_deployed"
        save(path, receipt)
        current = cf.assert_boundaries(receipt["previous_frontend"])
        if current["version_id"] != version:
            raise DeploymentError("Worker activation was not confirmed")
        # Edge propagation may briefly retain an old index. Retry only a bounded
        # acceptance gate; every attempt logs out its own ephemeral session.
        for attempt in range(6):
            try:
                receipt["verification"] = verify_fn(release, assets)
                break
            except VerificationError:
                if attempt == 5:
                    raise
                time.sleep(10)
        receipt["phase"] = "verified"
        save(path, receipt)
        receipt["backend_commit"] = backend.call("commit", transaction, release)
        receipt["phase"] = "committed"
        save(path, receipt)
        return receipt
    except BaseException:
        rollback(cf, backend, receipt, path, verify_fn)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", type=Path)
    parser.add_argument("--state-dir", required=True, type=Path)
    parser.add_argument("--transaction")
    parser.add_argument("--apply", action="store_true", help="perform deployment (default is a read-only plan)")
    parser.add_argument("--rollback", action="store_true", help="recover the saved transaction")
    args = parser.parse_args()
    backend = None
    try:
        directory = safe_path(args.state_dir)
        if args.rollback:
            if not args.apply:
                raise DeploymentError("rollback requires --apply")
            path = directory / "receipt.json"
            if not path.exists():
                print(json.dumps({"ok": True, "phase": "no-deployment-started"}))
                return
            receipt = json.loads(path.read_text())
            if receipt["phase"] in ("committed", "rolled_back", "staged", "aborted"):
                print(json.dumps({"ok": True, "phase": receipt["phase"]}))
                return
        else:
            if not args.release or not args.transaction or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", args.transaction):
                raise DeploymentError("--release and a valid --transaction are required")
            release = validate_release(json.loads(safe_path(args.release).read_text()))
            if not args.apply:
                print(json.dumps({"ok": True, "dry_run": True, "version": release["version"],
                                  "commit": release["commit"], "image": release["image"],
                                  "actions": ["stage-worker", "stop-and-backup-pvc", "migrate-and-deploy-backend",
                                              "activate-worker", "verify-public-contract", "commit-or-rollback"]}))
                return
        directory.mkdir(parents=True, exist_ok=True)
        if not os.environ.get("DEMO_ADMIN_PASSWORD"):
            raise DeploymentError("DEMO_ADMIN_PASSWORD is required before any deployment")
        cf, backend = Cloudflare(), Backend(directory)
        def interrupted(signum, frame):
            raise DeploymentError("demo deployment interrupted; recovering saved transaction")
        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGINT, interrupted)
        receipt = rollback(cf, backend, receipt, path) if args.rollback else deploy(
            cf, backend, release, directory, args.transaction)
        print(json.dumps({"ok": True, "phase": receipt["phase"], "version": receipt["release"]["version"],
                          "commit": receipt["release"]["commit"], "transaction": receipt["transaction"]}))
    except BaseException as error:
        message = str(error) if isinstance(error, (DeploymentError, CloudflareError, VerificationError)) else "demo deployment failed"
        print(json.dumps({"ok": False, "error": message}), file=sys.stderr)
        raise SystemExit(1) from None
    finally:
        if backend:
            backend.close()


if __name__ == "__main__":
    main()
