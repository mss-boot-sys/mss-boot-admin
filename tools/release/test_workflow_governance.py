import hashlib
import json
import os
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

import yaml

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_DIR = REPOSITORY_ROOT / ".github" / "workflows"
RETIRED_WORKFLOWS = (
    "docs-drift.yml",
    "pr-guard.yml",
    "mirror.yml",
    "issue-triage.yml",
    "weekly-digest.yml",
    "foundation-compatibility.yml",
    "frontend-cloudflare.yml",
    "release-draft.yml",
    "release-readiness.yml",
    "root-tag-promotion.yml",
    "web-editor-usage.yml",
    "web-lockfile-finalize.yml",
)
RETIRED_RELEASE_HELPERS = (
    "tools/release/verify_readiness_run.sh",
    "tools/release/release_readiness_attestation.py",
    "tools/release/release_phase_evidence.py",
    "tools/release/release_qualification_decision.py",
)
RETIRED_RELEASE_HELPER_TESTS = (
    "tools/release/test_release_readiness_attestation.py",
    "tools/release/test_release_phase_evidence.py",
    "tools/release/test_release_qualification_decision.py",
)


def load_workflow(name):
    path = WORKFLOW_DIR / name
    return yaml.load(path.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)


def write_file_module_proxy(proxy_root, module, version, source_root):
    """Expose one current source tree through a replace-free Go file proxy."""
    version_root = proxy_root.joinpath(*module.split("/"), "@v")
    version_root.mkdir(parents=True, exist_ok=True)
    (version_root / "list").write_text(f"{version}\n", encoding="utf-8")
    (version_root / f"{version}.info").write_text(
        json.dumps({"Version": version, "Time": "1980-01-01T00:00:00Z"}) + "\n",
        encoding="utf-8",
    )
    (version_root / f"{version}.mod").write_bytes((source_root / "go.mod").read_bytes())

    archive_prefix = f"{module}@{version}/"
    module_relative = source_root.relative_to(REPOSITORY_ROOT).as_posix()
    tracked = subprocess.run(
        ["git", "ls-files", "-z", "--", module_relative],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout.split("\0")
    sources = [REPOSITORY_ROOT / path for path in tracked if path]
    nested_modules = {
        source.parent.relative_to(source_root)
        for source in sources
        if source.name == "go.mod" and source.parent != source_root
    }
    with zipfile.ZipFile(
        version_root / f"{version}.zip", "w", compression=zipfile.ZIP_DEFLATED
    ) as archive:
        for source in sources:
            relative = source.relative_to(source_root)
            if (
                source.is_symlink()
                or not source.is_file()
                or "vendor" in relative.parts
                or any(
                    part in {".git", ".hg", ".svn", ".bzr"} for part in relative.parts
                )
                or any(
                    relative == nested or nested in relative.parents
                    for nested in nested_modules
                )
            ):
                continue
            archive.write(source, archive_prefix + relative.as_posix())
        module_license = source_root / "LICENSE"
        repository_license = REPOSITORY_ROOT / "LICENSE"
        if (
            source_root != REPOSITORY_ROOT
            and not module_license.is_file()
            and repository_license.is_file()
        ):
            archive.writestr(
                archive_prefix + "LICENSE", repository_license.read_bytes()
            )


class WorkflowGovernanceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflows = {
            path.name: load_workflow(path.name)
            for path in sorted(WORKFLOW_DIR.glob("*.yml"))
        }

    def test_exact_main_qualification_is_manual_read_only_and_complete(self):
        workflow = self.workflows["release-qualification.yml"]
        self.assertEqual(set(workflow["on"]), {"workflow_dispatch"})
        self.assertEqual(workflow["permissions"], {"contents": "read", "pull-requests": "read"})
        self.assertEqual(workflow["on"]["workflow_dispatch"]["inputs"]["expected_commit"]["required"], "true")
        job = workflow["jobs"]["qualify"]
        self.assertIn("github.ref == 'refs/heads/main'", job["if"])
        self.assertIn("github.actor == 'mss-boot-sys'", job["if"])
        self.assertIn("github.triggering_actor == 'mss-boot-sys'", job["if"])
        self.assertNotIn("environment", job)
        self.assertNotIn("GH_TOKEN", job["env"])
        self.assertNotIn("TMPDIR", job["env"])
        for name in ("Prepare exact package managers and dependencies", "Run the complete canonical qualification on this checkout"):
            step = next(item for item in job["steps"] if item.get("name") == name)
            self.assertEqual(step["env"]["TMPDIR"], "${{ runner.temp }}")
        checkout = job["steps"][0]["with"]
        self.assertEqual(checkout["ref"], "${{ inputs.expected_commit }}")
        self.assertEqual(checkout["persist-credentials"], "false")
        text = (WORKFLOW_DIR / "release-qualification.yml").read_text()
        self.assertIn('test "$GITHUB_SHA" = "$EXPECTED_COMMIT"', text)
        self.assertEqual(text.count("python3 tools/release/verify_release_source.py"), 2)
        self.assertIn('go run ./cmd/mss verify --all --release-evidence --expect-commit "$EXPECTED_COMMIT"', text)
        self.assertIn("make docs-build", text)
        self.assertIn("planned <= results.keys()", text)
        self.assertIn("hashlib.sha256(raw).hexdigest()", text)
        self.assertIn("path: ${{ runner.temp }}/release-evidence/qualification.json", text)
        for forbidden in ("secrets.", "continue-on-error", "git push", "gh release", "gh workflow run"):
            self.assertNotIn(forbidden, text)

    def test_qualification_sanitizer_rejects_incomplete_or_failed_evidence(self):
        job = self.workflows["release-qualification.yml"]["jobs"]["qualify"]
        step = next(item for item in job["steps"] if item.get("name") == "Reconfirm source and retain sanitized successful evidence")
        script = step["run"].split("python3 - <<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]
        commit = "a" * 40
        good = {
            "commit": commit, "evidenceMode": True, "success": True,
            "planOnly": False, "trackedCleanBefore": True, "trackedCleanAfter": True,
            "plan": {"checks": [{"id": "root-tests"}, {"id": "docker-smoke"}]},
            "results": [{"id": "root-tests", "exitCode": 0}, {"id": "docker-smoke", "exitCode": 0}],
            "privateLog": "must-not-be-uploaded",
        }
        cases = {"valid": good}
        for key, value in (("commit", "b" * 40), ("success", False), ("evidenceMode", False),
                           ("planOnly", True), ("trackedCleanBefore", False), ("trackedCleanAfter", False),
                           ("plan", {"checks": []}), ("results", [{"id": "root-tests", "exitCode": 0}])):
            cases[key] = {**good, key: value}
        cases["failed-check"] = {**good, "results": [{"id": "root-tests", "exitCode": 1}, {"id": "docker-smoke", "exitCode": 0}]}
        cases["missing-report"] = None
        for label, report in cases.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / ".mss/reports").mkdir(parents=True)
                if report is not None:
                    (root / ".mss/reports/verify.json").write_text(json.dumps(report))
                result = subprocess.run(["python3", "-c", script], cwd=root, capture_output=True, text=True,
                                        env={**os.environ, "EXPECTED_COMMIT": commit, "RUNNER_TEMP": str(root),
                                             "GITHUB_RUN_ID": "1234", "GITHUB_RUN_ATTEMPT": "2"})
                output = root / "release-evidence/qualification.json"
                if label == "valid":
                    self.assertEqual(result.returncode, 0, result.stderr)
                    summary = json.loads(output.read_text())
                    self.assertEqual(summary["commit"], commit)
                    self.assertEqual(summary["workflowRunAttempt"], "2")
                    self.assertEqual(summary["reportSHA256"], hashlib.sha256((root / ".mss/reports/verify.json").read_bytes()).hexdigest())
                    self.assertNotIn("must-not-be-uploaded", output.read_text())
                    self.assertEqual(set(summary), {"commit", "evidenceMode", "success", "trackedCleanBefore", "trackedCleanAfter", "reportSHA256", "checks", "docsBuild", "workflowRun", "workflowRunAttempt"})
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse(output.exists())

    def test_admin_ci_context_is_repository_unique(self):
        contexts = []
        for workflow_name, workflow in self.workflows.items():
            for job_name, job in workflow.get("jobs", {}).items():
                if job.get("name", job_name) == "admin-ci":
                    contexts.append((workflow_name, job_name))

        self.assertEqual(contexts, [("ci.yml", "build")])
        self.assertEqual(self.workflows["ci.yml"]["jobs"]["build"]["name"], "admin-ci")

    def test_release_tags_do_not_retrigger_component_ci(self):
        for workflow_name in ("ci.yml", "mss-boot-ci.yml"):
            workflow = self.workflows[workflow_name]
            self.assertEqual(set(workflow["on"]), {"workflow_dispatch"})
        self.assertEqual(
            self.workflows["release.yml"]["on"]["push"]["tags"],
            ["v*.*.*"],
        )
        self.assertEqual(
            self.workflows["framework-release.yml"]["on"]["push"]["tags"],
            ["mss-boot/v*.*.*"],
        )

    def test_macos_portable_tests_use_the_real_runner_temp_directory(self):
        job = self.workflows["agent-native-ci.yml"]["jobs"][
            "cross-platform-agent-tools"
        ]
        self.assertIn("macos-15", job["strategy"]["matrix"]["os"])
        test_step = next(
            step
            for step in job["steps"]
            if step.get("name") == "Test portable Agent packages"
        )
        self.assertEqual(test_step["env"]["TMPDIR"], "${{ runner.temp }}")

    def test_retired_workflows_stay_absent(self):
        present = [name for name in RETIRED_WORKFLOWS if (WORKFLOW_DIR / name).exists()]
        self.assertEqual(present, [])

    def test_pr_workflow_is_one_lightweight_read_only_job(self):
        entrypoints = [
            name
            for name, workflow in self.workflows.items()
            if "pull_request" in workflow["on"]
            or "pull_request_target" in workflow["on"]
        ]
        self.assertEqual(entrypoints, ["pr-checks.yml"])
        workflow = self.workflows["pr-checks.yml"]
        self.assertEqual(workflow["on"], {"pull_request": {"branches": ["main"]}})
        self.assertEqual(workflow["permissions"], {"contents": "read"})
        self.assertEqual(len(workflow["jobs"]), 1)
        job = next(iter(workflow["jobs"].values()))
        self.assertEqual(job["name"], "pr-ci")
        self.assertLessEqual(int(job["timeout-minutes"]), 5)
        self.assertNotIn("services", job)
        self.assertNotIn("strategy", job)
        self.assertNotIn("continue-on-error", job)
        scripts = "\n".join(step.get("run", "") for step in job["steps"])
        self.assertIn("tools/ci/pr_checks.py --base", scripts)
        self.assertIn("test_workflow_governance", scripts)
        for heavy in (
            "go test",
            "go build",
            "govulncheck",
            "pnpm install",
            "pnpm build",
            "docker ",
            "playwright",
        ):
            self.assertNotIn(heavy, scripts)
        for step in job["steps"]:
            self.assertNotIn("if", step)
            self.assertNotIn("continue-on-error", step)
            self.assertFalse(
                step.get("uses", "").startswith(
                    ("actions/setup-go@", "github/codeql-action/")
                )
            )

    def test_pr_code_cannot_run_before_owner_approval(self):
        workflow = self.workflows["pr-checks.yml"]
        job = next(iter(workflow["jobs"].values()))
        self.assertEqual(job["environment"], "pr-ci-approval")
        self.assertEqual(workflow["concurrency"]["cancel-in-progress"], "true")
        self.assertIn(
            "github.event.pull_request.number", workflow["concurrency"]["group"]
        )
        self.assertNotIn("if", job)
        self.assertTrue(job["steps"][0]["uses"].startswith("actions/checkout@"))
        self.assertEqual(job["steps"][0]["with"]["persist-credentials"], "false")

    def test_main_and_schedules_never_start_workflows(self):
        for name, workflow in self.workflows.items():
            triggers = workflow["on"]
            self.assertNotIn("schedule", triggers, name)
            self.assertNotIn("branch_protection_rule", triggers, name)
            if "push" in triggers:
                self.assertEqual(set(triggers["push"]), {"tags"}, name)
                self.assertTrue(triggers["push"]["tags"], name)

    def test_demo_deploy_uses_only_the_successful_root_boundary_and_reviewed_main(self):
        workflow = self.workflows["demo-deploy.yml"]
        self.assertEqual(set(workflow["on"]), {"workflow_run", "workflow_dispatch"})
        self.assertEqual(workflow["on"]["workflow_run"],
                         {"workflows": ["Root Release"], "types": ["completed"]})
        self.assertEqual(workflow["permissions"], {"contents": "read", "actions": "read"})
        self.assertEqual(workflow["concurrency"],
                         {"group": "demo-deployment", "cancel-in-progress": "false"})
        job = workflow["jobs"]["deploy"]
        self.assertEqual(job["environment"], "demo")
        for guard in ("conclusion == 'success'", "event == 'push'", "refs/heads/main",
                      "head_repository.full_name == github.repository"):
            self.assertIn(guard, job["if"])
        checkout = next(step for step in job["steps"] if step.get("uses", "").startswith("actions/checkout@"))
        self.assertEqual(checkout["with"]["ref"], "main")
        self.assertEqual(checkout["with"]["persist-credentials"], "false")
        scripts = "\n".join(step.get("run", "") for step in job["steps"])
        self.assertIn("--source-run", scripts)
        self.assertIn("--wait-seconds", scripts)
        self.assertIn("--rollback --apply", scripts)
        self.assertNotIn("publish", scripts)
        recovery = next(step for step in job["steps"] if step.get("name") == "Recover an interrupted transaction")
        self.assertIn("always()", recovery["if"])

    def test_foundation_compatibility_is_a_single_local_gate(self):
        agent = self.workflows["agent-native-ci.yml"]
        root = self.workflows["release.yml"]
        self.assertNotIn("foundation-compatibility", agent["jobs"])
        self.assertNotIn("foundation-compatibility", root["jobs"])

        agent_source = (WORKFLOW_DIR / "agent-native-ci.yml").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("test-standalone-mss-consumer.sh --upgrade", agent_source)

        makefile = (REPOSITORY_ROOT / "Makefile").read_text(encoding="utf-8")
        self.assertIn(
            "compatibility-foundation-next:\n"
            "\tbash tools/compatibility/test-standalone-mss-consumer.sh "
            "--upgrade --next-foundation",
            makefile,
        )

    def test_scorecard_does_not_run_on_every_main_push(self):
        triggers = self.workflows["scorecard.yml"]["on"]
        self.assertEqual(
            set(triggers),
            {"workflow_dispatch"},
        )
        self.assertNotIn("push", triggers)

    def test_agent_ci_is_manual_and_runs_this_governance_suite(self):
        agent_workflow = self.workflows["agent-native-ci.yml"]
        self.assertEqual(set(agent_workflow["on"]), {"workflow_dispatch"})

        steps = agent_workflow["jobs"]["contracts-and-go"]["steps"]
        governance = next(
            step
            for step in steps
            if step.get("name") == "Verify release and workflow governance"
        )
        self.assertIn("test_detect_component_scope.py", governance["run"])
        self.assertIn("test_check_release_policy.py", governance["run"])
        for retired_test in RETIRED_RELEASE_HELPER_TESTS:
            self.assertNotIn(Path(retired_test).name, governance["run"])
        self.assertNotIn("test_release_readiness_workflow.py", governance["run"])
        self.assertIn("test_root_release_workflow.py", governance["run"])
        self.assertIn("test_verify_framework_admin_checksum.py", governance["run"])
        self.assertIn("test_verify_release_source.py", governance["run"])
        self.assertIn("test_workflow_governance.py", governance["run"])

    def test_retired_release_evidence_chain_has_no_active_entrypoint(self):
        for relative_path in RETIRED_RELEASE_HELPERS + RETIRED_RELEASE_HELPER_TESTS:
            with self.subTest(path=relative_path):
                self.assertFalse((REPOSITORY_ROOT / relative_path).exists())

        active_surfaces = (
            ".mss/commands.yaml",
            ".agents/skills/mss-release/SKILL.md",
            ".github/workflows/agent-native-ci.yml",
            "tools/compatibility/test-thin-host-external-consumer.sh",
        )
        retired_names = tuple(
            Path(relative_path).name
            for relative_path in RETIRED_RELEASE_HELPERS + RETIRED_RELEASE_HELPER_TESTS
        )
        for active_surface in active_surfaces:
            content = (REPOSITORY_ROOT / active_surface).read_text(encoding="utf-8")
            for retired_name in retired_names:
                with self.subTest(surface=active_surface, retired=retired_name):
                    self.assertNotIn(retired_name, content)

    def test_reusable_scope_classifier_owns_component_routing(self):
        workflow = self.workflows["component-scope.yml"]
        outputs = workflow["on"]["workflow_call"]["outputs"]
        self.assertEqual(set(outputs), {"scope", "go_modules", "changed_count"})
        detect = workflow["jobs"]["detect"]
        self.assertEqual(detect["outputs"]["scope"], "${{ steps.scope.outputs.scope }}")
        self.assertEqual(
            detect["outputs"]["go_modules"],
            "${{ steps.scope.outputs.go_modules }}",
        )
        step = next(
            item
            for item in detect["steps"]
            if item.get("name") == "Classify changed component scope"
        )
        self.assertIn("tools/ci/detect_component_scope.py", step["run"])
        self.assertIn('--github-output "${GITHUB_OUTPUT}"', step["run"])

    def test_admin_required_context_routes_heavy_jobs_by_component(self):
        jobs = self.workflows["ci.yml"]["jobs"]
        for name in ("test", "race", "static-and-module", "compile"):
            condition = jobs[name]["if"]
            self.assertIn("scope == 'admin'", condition)
            self.assertIn("scope == 'shared'", condition)
            self.assertNotIn("scope == 'framework'", condition)

        compatibility = jobs["compatibility"]["if"]
        for scope in ("admin", "framework", "shared"):
            self.assertIn(f"scope == '{scope}'", compatibility)

        aggregate = next(
            step
            for step in jobs["build"]["steps"]
            if step.get("name") == "Require every Admin check to pass"
        )["run"]
        for route in ("admin|shared)", "framework)", "docs|web)"):
            self.assertIn(route, aggregate)

        for name in ("race", "static-and-module", "compatibility", "compile"):
            self.assertIn("github.event_name != 'pull_request'", jobs[name]["if"])
        test_steps = jobs["test"]["steps"]
        ordinary = next(
            step
            for step in test_steps
            if step.get("name") == "Test coordinated Admin module"
        )
        self.assertEqual(ordinary["if"], "github.event_name == 'pull_request'")
        self.assertEqual(ordinary["run"], "go test -shuffle=on -count=1 ./...")
        for step_name in (
            "Test coverage policy tooling",
            "Test coordinated Admin module with atomic coverage",
            "Enforce Admin coverage policy",
            "Upload Admin coverage profile",
        ):
            step = next(item for item in test_steps if item.get("name") == step_name)
            self.assertEqual(step["if"], "github.event_name != 'pull_request'")

    def test_extended_agent_and_frontend_matrices_are_manual_only(self):
        expected_jobs = {
            "agent-native-ci.yml": {
                "contracts-and-go",
                "cross-platform-agent-tools",
            },
            "frontend-v6-ci.yml": {
                "generated-contract",
                "dependency-contract",
                "quality",
                "package-contract",
                "compile",
                "browser",
                "build",
            },
        }
        for workflow_name, required_jobs in expected_jobs.items():
            with self.subTest(workflow=workflow_name):
                workflow = self.workflows[workflow_name]
                self.assertEqual(set(workflow["on"]), {"workflow_dispatch"})
                self.assertEqual(set(workflow["jobs"]), required_jobs)

    def test_extended_diagnostics_are_manual_only(self):
        for name in (
            "ci.yml",
            "mss-boot-ci.yml",
            "admin-distribution-compatibility.yml",
            "codeql.yml",
            "govulncheck.yml",
            "scorecard.yml",
            "swagger.yml",
            "pat-migration-integration.yml",
            "theme-settings-integration.yml",
            "v0.7-upgrade-integration.yml",
        ):
            with self.subTest(workflow=name):
                self.assertEqual(set(self.workflows[name]["on"]), {"workflow_dispatch"})
        self.assertEqual(
            self.workflows["container.yml"]["on"]["push"], {"tags": ["v*.*.*"]}
        )
        self.assertEqual(
            self.workflows["docs.yml"]["on"]["push"], {"tags": ["docs/v*.*.*"]}
        )

    def test_admin_module_metadata_gate_uses_a_confined_prepublication_replace(self):
        job = self.workflows["ci.yml"]["jobs"]["static-and-module"]
        step = next(
            item
            for item in job["steps"]
            if item.get("name") == "Verify Admin module metadata"
        )
        self.assertEqual(step["run"], "bash tools/ci/verify-admin-module-metadata.sh")

        script = (
            REPOSITORY_ROOT / "tools" / "ci" / "verify-admin-module-metadata.sh"
        ).read_text(encoding="utf-8")
        self.assertIn(
            'GOWORK=off GOFLAGS= go mod tidy -modfile="${temporary_mod}"', script
        )
        self.assertIn(
            '-replace="${framework_module}@${framework_version}=${framework_dir}"',
            script,
        )
        self.assertIn('-dropreplace="${framework_module}@${framework_version}"', script)
        self.assertIn('diff -u -- "${admin_dir}/go.mod" "${temporary_mod}"', script)
        self.assertIn(
            '!($1 == module && ($2 == version || $2 == version "/go.mod"))',
            script,
        )
        self.assertIn(
            'diff -u -- "${tracked_sum_without_framework}" "${temporary_sum}"',
            script,
        )

    def test_v0_7_upgrade_candidate_uses_the_explicit_prepublication_workspace(self):
        workflow = self.workflows["v0.7-upgrade-integration.yml"]
        step = next(
            item
            for item in workflow["jobs"]["upgrade"]["steps"]
            if item.get("name") == "Upgrade real v0.7 schema to the candidate twice"
        )
        self.assertEqual(
            step["env"]["MSS_RELEASE_CANDIDATE_GOWORK"],
            "${{ github.workspace }}/go.work",
        )

        script = (
            REPOSITORY_ROOT / "tools" / "release" / "verify-v0.7-upgrade.sh"
        ).read_text(encoding="utf-8")
        self.assertIn('candidate_dependency_mode="repository-workspace"', script)
        self.assertIn('candidate_dependency_mode="public-module"', script)
        self.assertIn('GOWORK="${candidate_gowork}" go build -trimpath', script)
        self.assertIn(
            'GOWORK="${candidate_gowork}" go test ./cmd/migrate/migration/system',
            script,
        )
        self.assertIn('GOWORK="${candidate_gowork}" go list -m', script)
        self.assertIn("GOWORK=off go build -trimpath", script)
        self.assertIn('"candidateDependencyMode": sys.argv[16]', script)
        current_migrations = script.split('"${work_dir}/bin/admin-current" migrate', 1)[
            1
        ]
        self.assertNotIn('--password "${admin_password}"', current_migrations)
        self.assertIn(
            'MSS_ADMIN_INITIAL_PASSWORD="${admin_password}"',
            script,
        )
        self.assertIn("unset MSS_ADMIN_INITIAL_PASSWORD", current_migrations)

    def test_go_vulnerability_scans_follow_owned_modules(self):
        workflow = self.workflows["govulncheck.yml"]
        self.assertEqual(set(workflow["on"]), {"workflow_dispatch"})
        jobs = workflow["jobs"]
        self.assertEqual(jobs["root"]["if"], "needs.scope.outputs.scope == 'shared'")
        self.assertEqual(
            jobs["nested-modules"]["strategy"]["matrix"]["module"],
            "${{ fromJSON(needs.scope.outputs.go_modules) }}",
        )
        nested_steps = jobs["nested-modules"]["steps"]
        skip = next(
            step
            for step in nested_steps
            if step.get("name") == "Skip Go vulnerability scan for this component"
        )
        self.assertEqual(skip["if"], "matrix.module == 'none'")
        for step in nested_steps:
            if step.get("name") in {
                "Checkout",
                "Setup Go",
                "Install govulncheck",
                "Scan nested module",
            }:
                self.assertEqual(step["if"], "matrix.module != 'none'")
        scan = next(
            step for step in nested_steps if step.get("name") == "Scan nested module"
        )
        self.assertEqual(
            scan["env"]["GOWORK"],
            "${{ matrix.module == 'admin' && format('{0}/go.work', github.workspace) || 'off' }}",
        )

    def test_codeql_languages_follow_component_ownership(self):
        workflow = self.workflows["codeql.yml"]
        matrix = workflow["jobs"]["analyze"]["strategy"]["matrix"]["include"]
        scopes = {item["language"]: item["scopes"] for item in matrix}
        self.assertEqual(scopes["actions"], '["shared"]')
        self.assertEqual(scopes["go"], '["shared","admin","framework"]')
        self.assertEqual(scopes["javascript-typescript"], '["shared","web"]')

        steps = workflow["jobs"]["analyze"]["steps"]
        for step in steps:
            condition = step.get("if", "")
            if step.get("name") == "Skip analysis outside the changed component":
                self.assertIn("!contains(fromJSON(matrix.scopes)", condition)
            elif step.get("name") in {
                "Checkout",
                "Initialize CodeQL",
                "Perform CodeQL Analysis",
            }:
                self.assertIn("contains(fromJSON(matrix.scopes)", condition)
                self.assertNotIn("!contains", condition)

    def test_distribution_compatibility_routes_heavy_external_consumption(self):
        workflow = self.workflows["admin-distribution-compatibility.yml"]
        self.assertEqual(set(workflow["on"]), {"workflow_dispatch"})

        jobs = workflow["jobs"]
        condition = jobs["external-consumer"]["if"]
        for scope in ("admin", "framework", "web", "shared"):
            self.assertIn(f"scope == '{scope}'", condition)
        self.assertNotIn("scope == 'docs'", condition)
        external_script = next(
            step
            for step in jobs["external-consumer"]["steps"]
            if step.get("name") == "Qualify a real external Thin Host"
        )["run"]
        self.assertIn("test-thin-host-external-consumer.sh", external_script)
        process_supervision = next(
            step
            for step in jobs["external-consumer"]["steps"]
            if step.get("name") == "Test external-host process supervision"
        )["run"]
        self.assertEqual(
            process_supervision,
            "bash tools/compatibility/test-process-groups.sh",
        )
        browser_install = next(
            step
            for step in jobs["external-consumer"]["steps"]
            if step.get("name") == "Install Chromium for external-host qualification"
        )
        self.assertEqual(browser_install["working-directory"], "web/antd-v6")
        self.assertIn("playwright install --with-deps chromium", browser_install["run"])
        setup_pnpm = next(
            step
            for step in jobs["external-consumer"]["steps"]
            if step.get("name") == "Setup pnpm"
        )
        self.assertEqual(setup_pnpm["with"]["version"], "10.34.5")

        thin_host_script = (
            REPOSITORY_ROOT
            / "tools"
            / "compatibility"
            / "test-thin-host-external-consumer.sh"
        ).read_text(encoding="utf-8")
        for required in (
            "STAGE=e2e",
            "CONFIG_PROVIDER=local",
            "MSS_V6_EXTERNAL_BACKEND=1",
            "MSS_V6_EXTERNAL_SERVER=1",
            "e2e/generated/supplier.spec.ts",
            "e2e/permission.spec.ts",
            "e2e/parity.spec.ts",
            "--project=chromium-desktop",
            "--reporter=json",
            "external-e2e.json",
            "required_titles = {",
            "external E2E reporter titles",
            '"@mss-boot-sys/admin-web@file:../.mss/qualification/admin-web.tgz"',
            "entry.get('specifier') != expected",
            "resolved.startswith(expected + '(')",
            "fetch --frozen-lockfile",
            "install --offline --frozen-lockfile",
            "expected_pnpm_version='10.34.5'",
            'pnpm_command=(corepack "pnpm@${expected_pnpm_version}")',
            'actual_pnpm_version="$("${pnpm_command[@]}" --version)"',
            "run_pnpm pack --pack-destination",
            "current.bind(('127.0.0.1', 0))",
            'backend_origin="http://127.0.0.1:${backend_port}"',
            'web_origin="http://127.0.0.1:${web_port}"',
            "run_pnpm exec playwright install chromium",
            "mss.io/thin-host-local-evidence/v1",
            "MSS_PERSIST_EVIDENCE",
            "evidence-manifest.json",
            "flock -w 600",
            '"${runtime_dir}/config/application.yml"',
            '"${runtime_dir}/config/application-e2e.yml"',
            "mss_start_process_group \\\n  backend_pid",
            "mss_start_process_group \\\n  web_pid",
            'mss_stop_process_group "${web_pid}"',
            'mss_stop_process_group "${backend_pid}"',
        ):
            with self.subTest(required=required):
                self.assertIn(required, thin_host_script)
        self.assertNotIn("PORT=18001", thin_host_script)
        self.assertNotIn(
            "MSS_ADMIN_API_TARGET=http://127.0.0.1:18080", thin_host_script
        )
        process_group_helper = (
            REPOSITORY_ROOT / "tools" / "compatibility" / "process-groups.sh"
        ).read_text(encoding="utf-8")
        self.assertIn("setsid --fork", process_group_helper)
        self.assertNotIn('wait "${pid}"', process_group_helper)
        self.assertLess(
            thin_host_script.index("fetch --frozen-lockfile"),
            thin_host_script.index("install --offline --frozen-lockfile"),
        )
        build = thin_host_script.index("run_pnpm run build")
        lock = thin_host_script.index("port_start_lock_path=", build)
        allocation = thin_host_script.index("read -r backend_port web_port", lock)
        backend_ready = thin_host_script.index(
            '"${backend_origin}/healthz"', allocation
        )
        frontend_stable = thin_host_script.index(
            '"external Thin Host frontend stability check"', backend_ready
        )
        unlock = thin_host_script.index("release_port_start_lock", frontend_stable)
        self.assertLess(build, lock)
        self.assertLess(lock, allocation)
        self.assertLess(allocation, backend_ready)
        self.assertLess(backend_ready, frontend_stable)
        self.assertLess(frontend_stable, unlock)
        aggregate = jobs["required"]
        self.assertEqual(aggregate["name"], "admin-distribution-compatibility")
        aggregate_script = aggregate["steps"][0]["run"]
        self.assertIn("admin|framework|web|shared)", aggregate_script)
        self.assertIn("docs)", aggregate_script)
        self.assertIn("'skipped'", aggregate_script)

    def test_frontend_ci_qualifies_the_publishable_tarball_contract(self):
        workflow = self.workflows["frontend-v6-ci.yml"]
        package_job = workflow["jobs"]["package-contract"]
        package_script = next(
            step
            for step in package_job["steps"]
            if step.get("name") == "Pack and inventory the complete Admin Web package"
        )["run"]
        for required in (
            "pnpm pack",
            "manifest.gitHead = process.env.GITHUB_SHA",
            "verify_admin_web_package.py",
            "generate_admin_web_sbom.py",
            "SHA256SUMS.admin-web",
            "check_portable_paths.py",
        ):
            self.assertIn(required, package_script)
        aggregate = workflow["jobs"]["build"]
        self.assertIn("package-contract", aggregate["needs"])
        self.assertIn("PACKAGE_RESULT", aggregate["steps"][0]["run"])

    def test_tag_workflows_use_direct_publication_without_broad_quality_repeats(self):
        for name in (
            "release.yml",
            "framework-release.yml",
            "admin-release.yml",
            "frontend-v6-release.yml",
            "container.yml",
        ):
            workflow = self.workflows[name]
            self.assertEqual(set(workflow["on"]), {"push"}, name)
            source = (WORKFLOW_DIR / name).read_text()
            for obsolete in (
                "resolve_successful_preview",
                "registry.npmjs.org",
                "stablePromotion",
                "id-token: write",
            ):
                self.assertNotIn(obsolete, source, name)
            for job in workflow["jobs"].values():
                for step in job.get("steps", []):
                    script = step.get("run", "")
                    for broad in (
                        "verify --all",
                        "pnpm audit",
                        "playwright",
                        "govulncheck",
                    ):
                        self.assertNotIn(broad, script, name)
        self.assertFalse((WORKFLOW_DIR / "npm-release.yml").exists())
        self.assertFalse(
            (REPOSITORY_ROOT / "tools/release/resolve_successful_preview.sh").exists()
        )

    def test_publishing_jobs_require_operator_before_checkout_and_scoped_environment(
        self,
    ):
        expected = {
            "framework-release.yml": "release-auto",
            "admin-release.yml": "release-auto",
            "frontend-v6-release.yml": "release-v6-auto",
            "container.yml": "release-auto",
            "release.yml": "release-auto",
            "docs.yml": "prod",
        }
        for name, environment in expected.items():
            for job in self.workflows[name]["jobs"].values():
                permissions = job.get("permissions", {})
                if not any(value == "write" for value in permissions.values()):
                    continue
                self.assertEqual(job["environment"], environment, name)
                guard = job["steps"][0]
                self.assertEqual(
                    guard.get("env", {}).get("RELEASE_ACTOR_LOGIN"),
                    "mss-boot-sys",
                    name,
                )
                self.assertIn("GITHUB_ACTOR", guard["run"])
                self.assertIn("GITHUB_TRIGGERING_ACTOR", guard["run"])
                scripts = "\n".join(step.get("run", "") for step in job["steps"])
                self.assertTrue(
                    "verify_release_source.py" in scripts
                    or "verify_publication.py" in scripts
                    or "origin/main" in scripts,
                    name,
                )

    def test_admin_keeps_exact_public_framework_boundary(self):
        job = self.workflows["admin-release.yml"]["jobs"]["release"]
        step = next(
            s
            for s in job["steps"]
            if s.get("name") == "Resolve and test the exact public Framework"
        )
        self.assertEqual(step["env"]["GOWORK"], "off")
        self.assertEqual(step["env"]["GOFLAGS"], "-mod=readonly")
        self.assertEqual(step["env"]["GOPROXY"], "https://proxy.golang.org")
        self.assertIn("go mod download -json", step["run"])
        self.assertIn("go test ./app ./business", step["run"])
        self.assertNotIn("replace", step["run"])

    def test_frontend_builds_verified_package_sbom_and_github_only_publication(self):
        job = self.workflows["frontend-v6-release.yml"]["jobs"]["release"]
        scripts = "\n".join(s.get("run", "") for s in job["steps"])
        for needed in (
            "pnpm pack",
            "verify_admin_web_package.py",
            "generate_admin_web_sbom.py",
            "SHA256SUMS.admin-web",
            "publish_github_package.py",
            "publish_image.sh frontend",
        ):
            self.assertIn(needed, scripts)
        self.assertEqual(job["permissions"]["packages"], "write")
        self.assertNotIn("id-token", job["permissions"])

    def test_docs_deploys_and_verifies_existing_domain_from_tag(self):
        workflow = self.workflows["docs.yml"]
        self.assertEqual(workflow["on"]["push"]["tags"], ["docs/v*.*.*"])
        deployment = workflow["jobs"]["deployment"]
        self.assertEqual(deployment["concurrency"]["cancel-in-progress"], "false")
        scripts = "\n".join(s.get("run", "") for s in deployment["steps"])
        self.assertIn("CF_API_TOKEN", scripts)
        self.assertIn("repository or prod environment", scripts)
        self.assertIn("https://docs.mss-boot-io.top/release.json", scripts)
        self.assertIn("merge-base --is-ancestor", scripts)
        deploy = next(
            s
            for s in deployment["steps"]
            if s.get("name") == "Deploy production documentation"
        )
        self.assertEqual(deploy["with"]["command"], "deploy --env prod")

    def test_all_release_bash_blocks_parse(self):
        import re

        for name in (
            "release.yml",
            "framework-release.yml",
            "admin-release.yml",
            "frontend-v6-release.yml",
            "container.yml",
            "docs.yml",
        ):
            for job in self.workflows[name]["jobs"].values():
                for step in job.get("steps", []):
                    if "run" in step:
                        script = re.sub(r"\$\{\{.*?\}\}", "placeholder", step["run"])
                        result = subprocess.run(
                            ["bash", "-n"], input=script, text=True, capture_output=True
                        )
                        self.assertEqual(
                            result.returncode, 0, name + ": " + result.stderr
                        )


if __name__ == "__main__":
    unittest.main()
