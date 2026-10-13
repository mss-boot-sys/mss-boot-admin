#!/usr/bin/env python3
"""Restricted SSH entry point for the existing, isolated Admin demo.

Install a reviewed copy as a root-owned, non-writable forced command. Input is
one bounded JSON object, never a shell command. All kubectl requests are pinned
to mss-admin-demo. No operation creates a database or an initial administrator.
Backups and transaction state contain private data and stay on the server.
"""

from __future__ import annotations

import copy
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

import yaml

NAMESPACE = "mss-admin-demo"
DEPLOYMENT = "admin-demo"
PVC = "admin-demo-data"
CONFIGS = ("admin-demo-config", "admin-demo-cache-config")
STATE_ROOT = Path("/var/lib/mss-admin-demo-maintenance")
IMAGE_RE = re.compile(r"ghcr\.io/mss-boot-sys/mss-boot-admin@sha256:[a-f0-9]{64}\Z")
VERSION_RE = re.compile(r"v(?:0|[1-9][0-9]{0,4})\.(?:0|[1-9][0-9]{0,4})\.(?:0|[1-9][0-9]{0,4})\Z")
COMMIT_RE = re.compile(r"[a-f0-9]{40}\Z")
TRANSACTION_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,63}\Z")
TERMINAL = {"committed", "rolled_back"}


class Refused(Exception):
    """A fixed, safe error suitable for the public receipt."""


def require(condition, reason):
    if not condition:
        raise Refused(reason)


def validate_request(request):
    require(isinstance(request, dict), "invalid_request")
    action = request.get("action")
    require(action in {"prepare", "deploy", "commit", "rollback", "finalize-rollback", "status"}, "invalid_action")
    if action == "status":
        require(set(request) == {"action"}, "invalid_status_request")
        return request
    require(set(request) == {"action", "transaction", "release"}, "invalid_request_fields")
    transaction = request["transaction"]
    require(isinstance(transaction, str) and TRANSACTION_RE.fullmatch(transaction), "invalid_transaction")
    release = request["release"]
    require(isinstance(release, dict) and set(release) == {"version", "commit", "image"}, "invalid_release")
    for key, pattern in (("version", VERSION_RE), ("commit", COMMIT_RE), ("image", IMAGE_RE)):
        require(isinstance(release.get(key), str) and pattern.fullmatch(release[key]), f"invalid_{key}")
    return request


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def private_write(path, content):
    """Atomic, durable writes; the parent directory is private and root-owned."""
    temporary = path.with_name(path.name + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def binary_identity(output):
    clean = re.sub(rb"\x1b\[[0-9;]*m", b"", output).decode("utf-8", errors="replace")
    match = re.search(r"mss-boot-admin (?:version )?(v[0-9]+\.[0-9]+\.[0-9]+) \(commit ([a-f0-9]{40})\)", clean)
    require(match is not None, "unrecognized_binary_identity")
    return {"version": match[1], "commit": match[2]}


def validate_upgrade(previous, release):
    current = tuple(int(part) for part in previous["version"][1:].split("."))
    candidate = tuple(int(part) for part in release["version"][1:].split("."))
    require(candidate >= current, "release_downgrade_refused")
    require(candidate != current or previous == release, "existing_version_identity_mismatch")


def validate_configuration(secrets):
    """A mounted file must not silently redirect migrations to another database."""
    try:
        require(set(secrets[CONFIGS[0]]["data"]) == {"application.yml"}, "unexpected_application_config_files")
        require(set(secrets[CONFIGS[1]]["data"]) == {"password", "redis.conf"}, "unexpected_cache_config_files")
        config = yaml.safe_load(base64.b64decode(secrets[CONFIGS[0]]["data"]["application.yml"], validate=True))
        require(config["database"]["driver"] == "sqlite", "demo_database_must_be_sqlite")
        require(config["database"]["source"] == "/app/data/admin.db?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate", "unexpected_database_path")
        require(config["application"]["origin"] == "https://demo.mss-boot-io.top", "unexpected_application_origin")
        require(config["cache"]["redis"]["addr"] == "admin-demo-cache:6379", "unexpected_cache_address")
        provider = config["runtime"]["resources"]["main"]["provider"]
        require(provider["kind"] == "redis" and provider["redis"]["mode"] == "standalone" and provider["redis"]["standalone"]["endpoint"] == "admin-demo-cache:6379", "unexpected_runtime_address")
        require(provider["redis"]["credentials"]["kind"] == "password" and provider["redis"]["credentials"]["password"]["passwordRef"] == "env://MSS_RUNTIME_REDIS_PASSWORD", "unexpected_runtime_credentials")
        require(config["cache"]["redis"]["password"].encode() == base64.b64decode(secrets[CONFIGS[1]]["data"]["password"], validate=True), "cache_credentials_mismatch")
    except Refused:
        raise
    except Exception:
        raise Refused("invalid_private_configuration") from None


def validate_deployment(deployment):
    """Fail closed if this ceases to be the reviewed single-node SQLite demo."""
    require(deployment.get("metadata", {}).get("namespace") == NAMESPACE, "wrong_namespace")
    require(deployment.get("metadata", {}).get("name") == DEPLOYMENT, "wrong_deployment")
    spec = deployment["spec"]
    require(spec.get("replicas") == 1 and spec.get("strategy", {}).get("type") == "Recreate", "unexpected_replica_strategy")
    require(spec.get("selector", {}).get("matchLabels") == {"app": DEPLOYMENT, "component": "server"}, "unexpected_selector")
    pod = spec["template"]["spec"]
    require(not any(pod.get(k) for k in ("hostNetwork", "hostPID", "hostIPC")), "unsafe_pod_namespace")
    require(pod.get("serviceAccountName") == DEPLOYMENT and pod.get("automountServiceAccountToken") is False, "unsafe_service_account")
    security = pod.get("securityContext", {})
    require(all(security.get(k) == v for k, v in {"runAsNonRoot": True, "runAsUser": 100, "runAsGroup": 101, "fsGroup": 101}.items()), "unexpected_pod_security")
    containers = pod.get("containers", [])
    require(len(containers) == 1 and containers[0].get("name") == "admin", "unexpected_containers")
    app = containers[0]
    require(IMAGE_RE.fullmatch(app.get("image", "")), "untrusted_current_image")
    require(app.get("args") == ["server"] and not app.get("command"), "unexpected_server_command")
    require(app.get("env") == [{"name": "MSS_RUNTIME_REDIS_PASSWORD", "valueFrom": {"secretKeyRef": {"key": "password", "name": CONFIGS[1]}}}], "unexpected_server_environment")
    require(not app.get("envFrom"), "unexpected_server_environment")
    container_security = app.get("securityContext", {})
    require(container_security.get("allowPrivilegeEscalation") is False and container_security.get("readOnlyRootFilesystem") is True and container_security.get("capabilities", {}).get("drop") == ["ALL"] and not container_security.get("privileged"), "unsafe_container_security")
    volumes = {v["name"]: v for v in pod.get("volumes", [])}
    require(set(volumes) == {"config", "data", "tmp"}, "unexpected_volumes")
    require(volumes["config"].get("secret", {}).get("secretName") == CONFIGS[0] and volumes["data"].get("persistentVolumeClaim", {}).get("claimName") == PVC and "emptyDir" in volumes["tmp"], "unexpected_volume_source")
    require(pod.get("nodeSelector") and set(pod["nodeSelector"]) == {"kubernetes.io/hostname"}, "unexpected_node_selector")
    gates = pod.get("initContainers", [])
    require(len(gates) == 1 and gates[0].get("name") == "require-migration" and gates[0].get("image") == app["image"], "unexpected_startup_gate")
    return app["image"]


def maintenance_pod(deployment, image, name):
    """Use fixed security/mounts, not arbitrary fields from the live template."""
    return {
        "apiVersion": "v1", "kind": "Pod",
        "metadata": {"name": name, "namespace": NAMESPACE, "labels": {"app": DEPLOYMENT, "component": "maintenance"}},
        "spec": {
            "restartPolicy": "Never", "activeDeadlineSeconds": 3600,
            "serviceAccountName": DEPLOYMENT, "automountServiceAccountToken": False,
            "nodeSelector": copy.deepcopy(deployment["spec"]["template"]["spec"]["nodeSelector"]),
            "securityContext": {"runAsNonRoot": True, "runAsUser": 100, "runAsGroup": 101, "fsGroup": 101, "fsGroupChangePolicy": "OnRootMismatch", "seccompProfile": {"type": "RuntimeDefault"}},
            "containers": [{
                "name": "maintenance", "image": image, "imagePullPolicy": "IfNotPresent",
                "command": ["/bin/sh", "-ec", "sleep 3500"],
                "env": [{"name": "MSS_RUNTIME_REDIS_PASSWORD", "valueFrom": {"secretKeyRef": {"name": CONFIGS[1], "key": "password"}}}],
                "securityContext": {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True, "capabilities": {"drop": ["ALL"]}},
                "resources": {"requests": {"cpu": "100m", "memory": "128Mi"}, "limits": {"cpu": "1", "memory": "512Mi"}},
                "volumeMounts": [{"name": "config", "mountPath": "/app/config", "readOnly": True}, {"name": "data", "mountPath": "/app/data"}, {"name": "tmp", "mountPath": "/tmp"}],
            }],
            "volumes": [{"name": "config", "secret": {"secretName": CONFIGS[0], "defaultMode": 0o440}}, {"name": "data", "persistentVolumeClaim": {"claimName": PVC}}, {"name": "tmp", "emptyDir": {"sizeLimit": "64Mi"}}],
        },
    }


class Backend:
    def __init__(self, root=STATE_ROOT):
        self.root = root
        self.directory = None
        self.state = None

    def command(self, args, *, payload=None, output=None, input_file=None, timeout=660):
        """Never propagate command output, credentials, or request bodies in errors."""
        try:
            result = subprocess.run(
                ["kubectl", "--namespace", NAMESPACE, *args],
                input=payload, stdin=input_file, stdout=output or subprocess.PIPE,
                stderr=subprocess.PIPE, timeout=timeout, check=False,
                env={"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/root", "KUBECONFIG": "/root/.kube/config"},
            )
        except (OSError, subprocess.TimeoutExpired):
            self.diagnostic(args, "unavailable_or_timeout")
            raise Refused("cluster_command_unavailable_or_timed_out") from None
        if result.returncode != 0:
            self.diagnostic(args, f"exit_{result.returncode}")
            raise Refused("cluster_command_failed")
        return result.stdout

    def diagnostic(self, args, result):
        # Do not persist raw output: database libraries can include credentials
        # in their errors. The operator can inspect only the failed resource.
        if self.directory is not None:
            private_write(self.directory / "last-error.json", json_bytes({
                "state": self.state.get("state") if self.state else "inspection",
                "operation": args[0], "resource": args[1] if len(args) > 1 and args[0] != "exec" else "maintenance",
                "result": result,
            }))

    def get(self, resource, name=None):
        return json.loads(self.command(["get", resource, *([name] if name else []), "-o", "json"]))

    def save(self):
        private_write(self.directory / "state.json", json_bytes(self.state))

    def phase(self, state):
        self.state["state"] = state
        self.save()

    def receipt(self, action):
        keys = ("transaction", "state", "release", "previous", "backup_sha256", "backup_bytes")
        return {"ok": True, "action": action, **{k: self.state[k] for k in keys if k in self.state}}

    def scale_down(self):
        self.command(["scale", f"deployment/{DEPLOYMENT}", "--replicas=0"])
        deadline = time.monotonic() + 180
        while True:
            pods = self.get("pods")["items"]
            running = [p for p in pods if p.get("status", {}).get("phase") not in {"Succeeded", "Failed"} and any(v.get("persistentVolumeClaim", {}).get("claimName") == PVC for v in p["spec"].get("volumes", [])) and p["metadata"]["name"] != self.state["pod"]]
            if not running:
                return
            require(time.monotonic() < deadline, "pvc_still_in_use")
            time.sleep(2)

    def delete_helper(self):
        self.command(["delete", "pod", self.state["pod"], "--ignore-not-found=true", "--wait=true", "--timeout=120s"])

    def helper(self, image):
        self.delete_helper()
        pod = maintenance_pod(self.state["deployment"], image, self.state["pod"])
        self.command(["create", "-f", "-"], payload=json_bytes(pod))
        self.command(["wait", "--for=condition=Ready", f"pod/{self.state['pod']}", "--timeout=300s"])

    def execute(self, args, **kwargs):
        return self.command(["exec", "-i", self.state["pod"], "-c", "maintenance", "--", *args], **kwargs)

    def secrets_match(self):
        for name in CONFIGS:
            live = self.get("secret", name)
            saved = self.state["secrets"][name]
            require(live.get("data") == saved.get("data") and live.get("type") == saved.get("type"), "configuration_changed_during_transaction")

    def prepare(self, request):
        deployment = self.get("deployment", DEPLOYMENT)
        previous_image = validate_deployment(deployment)
        pvc = self.get("pvc", PVC)
        require(pvc.get("status", {}).get("phase") == "Bound", "pvc_not_bound")
        require(pvc["spec"].get("accessModes") == ["ReadWriteOnce"], "unexpected_pvc_mode")
        previous = binary_identity(self.command(["exec", f"deployment/{DEPLOYMENT}", "-c", "admin", "--", "/app/mss-boot-admin", "version"]))
        previous["image"] = previous_image
        validate_upgrade(previous, request["release"])
        secrets = {name: self.get("secret", name) for name in CONFIGS}
        validate_configuration(secrets)
        for value in secrets.values():
            value.pop("metadata", None)
        self.state = {
            "transaction": request["transaction"], "release": request["release"],
            "state": "preparing", "previous": previous, "deployment": deployment,
            "secrets": secrets, "pvc_uid": pvc["metadata"]["uid"],
            "pod": "admin-demo-maint-" + hashlib.sha256(request["transaction"].encode()).hexdigest()[:16],
            "backup_complete": False,
        }
        self.save()
        private_write(self.root / "active.json", json_bytes({"transaction": request["transaction"]}))
        self.scale_down()
        self.helper(previous_image)
        # Refuse an empty/new PVC before any migration command can run.
        self.execute(["/bin/sh", "-ec", "test -s /app/data/admin.db"])
        temporary = self.directory / "data.tar.gz.partial"
        with temporary.open("wb") as stream:
            os.chmod(temporary, 0o600)
            self.execute(["tar", "-czf", "-", "-C", "/app/data", "."], output=stream)
            stream.flush()
            os.fsync(stream.fileno())
        backup = self.directory / "data.tar.gz"
        os.replace(temporary, backup)
        self.state.update(backup_complete=True, backup_sha256=sha256_file(backup), backup_bytes=backup.stat().st_size)
        self.phase("prepared")
        self.delete_helper()

    def deploy(self):
        require(self.state["state"] == "prepared", "transaction_not_prepared")
        self.secrets_match()
        require(self.get("pvc", PVC)["metadata"]["uid"] == self.state["pvc_uid"], "pvc_identity_changed")
        self.phase("deploying")
        self.scale_down()
        release = self.state["release"]
        self.helper(release["image"])
        identity = binary_identity(self.execute(["/app/mss-boot-admin", "version"]))
        require(identity == {k: release[k] for k in ("version", "commit")}, "candidate_binary_identity_mismatch")
        # Existing database only, no bootstrap environment and no automatic retry.
        script = (
            "set -eu\numask 077\ntest -s /app/data/admin.db\n"
            "test -z \"${MSS_ADMIN_INITIAL_PASSWORD+x}\"\n"
            "/app/mss-boot-admin migrate --domain demo.mss-boot-io.top\n"
            "/app/mss-boot-admin server -a\n"
            f"printf '%s\\n' {release['commit']} > /app/data/.migrated-{release['version']}\n"
        )
        self.execute(["/bin/sh", "-ec", script])
        self.delete_helper()
        updated = copy.deepcopy(self.state["deployment"]["spec"])
        template = updated["template"]
        template.setdefault("metadata", {}).setdefault("annotations", {}).update({"mss.io/demo-version": release["version"], "mss.io/demo-commit": release["commit"], "mss.io/demo-transaction": self.state["transaction"]})
        template["spec"]["containers"][0]["image"] = release["image"]
        gate = template["spec"]["initContainers"][0]
        gate["image"] = release["image"]
        gate["command"] = ["/bin/sh", "-ec"]
        gate["args"] = [f'test "$(cat /app/data/.migrated-{release["version"]})" = {release["commit"]}']
        updated["replicas"] = 1
        self.replace_deployment_spec(updated)
        self.check_running(release)
        self.phase("deployed")

    def check_running(self, release):
        self.command(["rollout", "status", f"deployment/{DEPLOYMENT}", "--timeout=300s"])
        live = self.get("deployment", DEPLOYMENT)
        require(validate_deployment(live) == release["image"], "running_image_mismatch")
        identity = binary_identity(self.command(["exec", f"deployment/{DEPLOYMENT}", "-c", "admin", "--", "/app/mss-boot-admin", "version"]))
        require(identity == {k: release[k] for k in ("version", "commit")}, "running_binary_identity_mismatch")
        # Internal checks remain inside the pod; public API/login/WS checks are
        # performed by the orchestrator before it sends commit.
        self.command(["exec", f"deployment/{DEPLOYMENT}", "-c", "admin", "--", "/bin/sh", "-ec", "wget -q -O /dev/null http://127.0.0.1:8080/healthz; wget -q -O /dev/null http://127.0.0.1:8080/readyz"])

    def replace_deployment_spec(self, spec):
        # JSON replace removes candidate annotations on rollback as well.
        self.command(["patch", "deployment", DEPLOYMENT, "--type=json", "--patch-file=/dev/stdin"], payload=json_bytes([{"op": "replace", "path": "/spec", "value": spec}]))

    def rollback(self):
        require(self.state["state"] not in TERMINAL, "transaction_already_finished")
        self.phase("rolling_back")
        self.scale_down()
        self.delete_helper()
        require(self.get("pvc", PVC)["metadata"]["uid"] == self.state["pvc_uid"], "pvc_identity_changed")
        if self.state["backup_complete"]:
            backup = self.directory / "data.tar.gz"
            require(sha256_file(backup) == self.state["backup_sha256"], "backup_checksum_mismatch")
            # Restore the matching config before starting the old image. Secret
            # values only travel on stdin and are never part of command lines.
            for name in CONFIGS:
                self.command(["patch", "secret", name, "--type=merge", "--patch-file=/dev/stdin"], payload=json_bytes({"data": self.state["secrets"][name]["data"], "type": self.state["secrets"][name]["type"]}))
            self.helper(self.state["previous"]["image"])
            script = "set -eu\nfind /app/data -mindepth 1 -maxdepth 1 -exec rm -rf -- '{}' ';'\ntar -xzf - -C /app/data\ntest -s /app/data/admin.db\n"
            with backup.open("rb") as stream:
                self.execute(["/bin/sh", "-ec", script], input_file=stream)
            self.delete_helper()
            # Redis is dedicated to this demo and contains only transient state.
            # Drop candidate session/cache formats before restarting the old
            # binary; SQLite, uploads and saved credentials remain intact.
            self.command(["rollout", "restart", "deployment/admin-demo-cache"])
            self.command(["rollout", "status", "deployment/admin-demo-cache", "--timeout=180s"])
        self.replace_deployment_spec(self.state["deployment"]["spec"])
        self.check_running(self.state["previous"])
        # The frontend may still be broken. Retain exclusive ownership until
        # the orchestrator confirms restored public/login/WebSocket behavior.
        self.phase("rollback_ready")

    def clear_active(self):
        private_write(self.root / "last.json", json_bytes(self.receipt("status")))
        (self.root / "active.json").unlink(missing_ok=True)

    def handle(self, request):
        active_path = self.root / "active.json"
        active = json.loads(active_path.read_bytes()) if active_path.exists() else None
        action = request["action"]
        if action == "status":
            if not active:
                last = self.root / "last.json"
                return json.loads(last.read_bytes()) if last.exists() else {"ok": True, "action": action, "state": "idle"}
            self.directory = self.root / active["transaction"]
            self.state = json.loads((self.directory / "state.json").read_bytes())
            return self.receipt(action)
        self.directory = self.root / request["transaction"]
        require(not active or active["transaction"] == request["transaction"], "another_transaction_is_active")
        state_path = self.directory / "state.json"
        if state_path.exists():
            self.state = json.loads(state_path.read_bytes())
            require(self.state["release"] == request["release"], "transaction_release_mismatch")
            phase = self.state["state"]
            if (action == "prepare" and phase == "prepared") or (action == "deploy" and phase == "deployed") or (action == "commit" and phase == "committed") or (action == "rollback" and phase in {"rollback_ready", "rolled_back"}) or (action == "finalize-rollback" and phase == "rolled_back"):
                if phase in TERMINAL and active:
                    self.clear_active()
                return self.receipt(action)
            require(phase not in TERMINAL, "transaction_already_finished")
            if active is None:
                # An interruption can happen between durable state and active
                # lock creation. Only recovery may adopt an orphaned state.
                require(action == "rollback", "transaction_lock_missing")
                private_write(active_path, json_bytes({"transaction": request["transaction"]}))
            if action == "deploy":
                self.deploy()
            elif action == "commit":
                require(phase == "deployed", "transaction_not_deployed")
                self.secrets_match()
                self.check_running(self.state["release"])
                self.phase("committed")
                self.clear_active()
            elif action == "rollback":
                self.rollback()
            elif action == "finalize-rollback":
                require(phase == "rollback_ready", "rollback_not_ready")
                self.secrets_match()
                self.check_running(self.state["previous"])
                self.phase("rolled_back")
                self.clear_active()
            else:
                raise Refused("incomplete_prepare_requires_rollback")
        else:
            require(action == "prepare" and not active, "unknown_transaction")
            self.directory.mkdir(mode=0o700, exist_ok=True)
            self.prepare(request)
        return self.receipt(action)


def main():
    os.umask(0o077)
    backend = Backend()
    try:
        require(not sys.argv[1:], "arguments_not_allowed")
        raw = sys.stdin.buffer.read(8193)
        require(len(raw) <= 8192, "request_too_large")
        request = validate_request(json.loads(raw))
        backend.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        require(backend.root.stat().st_mode & 0o077 == 0, "unsafe_state_permissions")
        with (backend.root / "call.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise Refused("another_call_is_running") from None
            receipt = backend.handle(request)
        print(json.dumps(receipt, sort_keys=True))
        return 0
    except Exception as error:
        # JSON parsing, OS errors and unexpected exceptions may include private
        # paths or content; publish only controlled reason codes.
        receipt = {"ok": False, "error": str(error) if isinstance(error, Refused) else "internal_error"}
        if backend.state:
            receipt.update(transaction=backend.state["transaction"], state=backend.state["state"])
        print(json.dumps(receipt, sort_keys=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
