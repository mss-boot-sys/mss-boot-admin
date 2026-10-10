---
title: Pull request checks
---

# Pull request checks after the repository migration

Development uses `mss-boot-sys/mss-boot-admin`. Go import paths and the
`@mss-boot-io/admin-web` package identity remain compatible with existing consumers.

Every PR to `main` starts **PR Checks** (`.github/workflows/pr-checks.yml`).
`tools/ci/pr_checks.py` reads the merge-base diff once, including both sides of
renames. Mixed changes run the union of their component checks.
The local PR contract retains the former guard's maximum of 140 changed paths
and requires documentation for API, configuration, migration and workflow changes.

| Change | PR checks |
| --- | --- |
| Admin | Admin tests and govulncheck; Go CodeQL |
| Framework | Framework standalone tests and govulncheck; Admin integration tests and scan; Go CodeQL |
| Go examples | Tests and govulncheck for the affected example; Go CodeQL |
| Frontend | Frozen install, dependency policy, audit, lint/typecheck, unit tests, release build and bundle boundaries; JavaScript CodeQL |
| Docs | Frozen install, dependency audit and site build |
| Shared tooling, contracts, workflows or unknown paths | All affected families and Actions CodeQL |
| Contributor Markdown outside Docs | Documentation and workflow policy checks |

The `pr-ci` result requires the planner and every selected check to succeed.
Unexpected skips, cancellation and failures cannot produce a passing result.
The workflow has no trigger path filter. After the operator enables Actions and
validates the exact PR commit, configure `main` to require `pr-ci` from GitHub
Actions and a PR, with force pushes and deletion prohibited including for
administrators. Actions remains disabled during this repair; the new repository
has no branch protection configured yet. Publication still requires the exact
reviewed merged-main commit and enforced protection.

Admin and Framework coverage, race and metadata checks remain on `main` and
manual runs. Database migration, external Thin Host, browser, delivery,
container and release qualifications keep their existing dedicated workflows
and local commands. The PR workflow does not repeat those extended matrices.

The old PR Guard dependency is replaced with local documentation and routing
checks. Legacy mirror, issue triage and weekly digest workflows referenced
unavailable old-organization repositories and have been retired. Reintroducing
an integration requires an explicit destination and reviewed credentials; the
new repository does not inherit a mirror or reporting destination.

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
