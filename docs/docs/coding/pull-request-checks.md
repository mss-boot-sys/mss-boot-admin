---
title: Pull request checks
---

# Pull request checks after the repository migration

Development uses `mss-boot-sys/mss-boot-admin`. Go import paths and the
`@mss-boot-io/admin-web` package identity remain compatible with existing consumers.

Every PR to `main` starts **PR Checks** (`.github/workflows/pr-checks.yml`).
The single `pr-ci` job waits for the repository owner `mss-boot-sys` to approve the
`pr-ci-approval` environment before checking out or executing PR code. Each new
commit starts a new run requiring approval and cancels the previous run.
The owner can approve their own PR run. Rejection prevents checkout; cancellation
or a failed check does not produce a successful `pr-ci` result.

This gate uses [GitHub required reviewers](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
configured under **Settings → Environments → pr-ci-approval**: required reviewer
`mss-boot-sys`, **Prevent self-review** off, administrator bypass off, no secrets
and no branch restriction (PR merge refs must be allowed). GitHub displays this
CI approval through its environment review UI; the job performs no deployment.
Environment protections are repository settings and cannot be created by the
workflow YAML alone. Keep them configured when moving or recreating the repository.

Under **Settings → Actions → General**, require workflow approval for **all
external contributors** as well. This platform check prevents a fork from
removing the YAML environment gate and executing its modified workflow without
approval. The environment gate also covers PRs created inside this repository.
After enabling Actions, open the run, inspect its exact commit and choose
**Review deployments → pr-ci-approval → Approve and deploy** to start checks,
or reject it to stop execution. Never approve runs automatically through a bot.

`tools/ci/pr_checks.py` reads the merge-base diff, including both sides of
renames, and reports which checks to run locally. The PR contract retains the
maximum of 140 changed paths and requires documentation for API, configuration,
migration and workflow changes.

## Execution budget

| Event | Actions work |
| --- | --- |
| Pull request | One approved `pr-ci` job: change scope, documentation policy, routing/workflow regression checks and the small audit-parser test suite |
| Push to `main` | None |
| Schedule or branch-protection change | None |
| Release tag | Existing publication checks and necessary artifact handling; broad quality suites are not repeated |
| Explicit manual dispatch | Optional diagnostics, or the existing one-time release candidate build |

The PR job has a five-minute execution timeout, read-only repository access,
no service containers and no Go, frontend, Docs or CodeQL matrix. A green
`pr-ci` proves only these lightweight checks passed. It does not certify tests,
security scans, browser behavior or release readiness.

Run `mss verify --changed` locally for the affected components.
Before release, qualify the exact clean merged-main commit once with
`mss verify --all --release-evidence --expect-commit <full-sha>`.
The existing candidate preview builds the actual release artifacts once; tag
publication verifies and reuses those artifacts. Admin retains the focused
public Framework dependency check, and Docs builds its independently published
site. Version/source checks, checksums, immutable identities and registry
publication authority remain in place. No additional release runner, evidence
service or approval chain is introduced.

The heavy Admin, Framework, compatibility, migration, CodeQL, vulnerability,
Scorecard and Swagger workflows are manual diagnostics only. They do not run
after ordinary merges. The Agent and frontend diagnostic matrices remain manual.

Configure `main` to require `pr-ci` and a PR after the exact workflow has been
validated. Repository settings are a separate operator action; this source
change does not enable Actions, approve a run or change branch protection.

Legacy mirror, issue triage and weekly digest integrations remain retired.

## Dependency baseline

Active Go modules, builder images and generated hosts use Go **1.26.9**.
The Admin and Framework use `golang.org/x/net` **0.60.0**, with its required
compatible Go submodules. See the [Go security release history](https://go.dev/doc/devel/release#go1.26.9).
Builder image digests remain pinned. Axios stays on its compatible 0.x line at
**0.34.0**; patched build dependencies are recorded in the frozen lockfiles.

The npm audit validator retains each affected release-line record when a GHSA
is shared across multiple ranges. It still rejects malformed totals, identical
duplicates, conflicting metadata, unclassified dependency paths, runtime high
or critical findings, stale acceptances and expired acceptances.

`braces` **3.0.3** has an upstream stack-exhaustion advisory
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) with no
patched version at the time of this change. Its acceptance expires on
**2026-11-08** and applies only to repository-owned build/test glob patterns.
Admin Web declares the exact build-only resolution and rejects this package
from the runtime bundle; Docs dependencies are development-only. The audit
fails if a patch becomes available, the resolution changes, a runtime path is
observed or the acceptance expires. Existing other build-only acceptances keep
their deadlines; obsolete `image-size` acceptances were removed from the
current audit contract. No runtime high or critical exception was added.

To reproduce policy validation:

```sh
python3 -m unittest discover -s tools/ci -p 'test_*.py'
python3 -m unittest tools.release.test_workflow_governance
node --test tools/security/check-pnpm-audit.test.mjs
make test-all build
make web-v6-lint web-v6-test web-v6-build
make docs-build
```

The next operational check after each workflow change is a passing **PR Checks**
run on the exact pushed PR commit and a read-back of the `main` protection
settings. Release qualification and production PVE acceptance remain separate.
