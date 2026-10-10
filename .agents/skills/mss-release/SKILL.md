---
name: mss-release
description: Prepare, validate locally, publish, and reconcile MSS Framework, Admin, frontend, Root, images, and Docs releases from one exact merged-main commit. Uses direct tag-driven artifact publication and GitHub Packages only.
---

# Release an MSS version

Use `.mss/release-policy.yaml` for the target and component identities. Starting with 1.3.9, `mss-boot-sys/mss-boot-admin` is the release repository. Versions 1.3.8 and earlier belong to `mss-boot-io` and require no recovery or republication here.

## Prepare the release

Read `AGENTS.md`, `.mss/project.yaml`, `.mss/commands.yaml`, `.mss/release-policy.yaml`, `.mss/release-qualification.json`, changelogs, migrations, and publishing workflows. Prepare one coherent PR for module/package identities, version contracts, templates, installers, upgrade instructions, release notes and all current Docs content. Historical notes retain their original identity.

Submit every release change through a PR targeting `main`. Run focused checks and browser review before merge. Never push changes directly to main or release a PR head. The operator is `mss-boot-sys`.

## Freeze and validate locally

Fetch remote main and freeze its full commit. Require the tracked checkout to be clean and match the exact current `origin/main` tip. Run `tools/release/verify_release_source.py` with authenticated GitHub read access; it verifies a merged PR produced this exact commit. Verify source before any publication.

Run the complete local gate once on the frozen commit:

```shell
go run ./cmd/mss verify --all --release-evidence --expect-commit "$SHA"
```

Inspect the actual report, retain its digest, and complete applicable external-consumer, migration/upgrade, permission, Docker delivery and browser verification. Use gvm for Go, nvm for Node, and the in-app browser for UI evidence. Run Docs build and inspect home plus nested guide/release pages at desktop and narrow widths. A failed gate requires a follow-up PR, merge, a new freeze, and affected verification. Never forge evidence or treat branch validation as publication authority.

There is no hosted artifact-preview prerequisite and no stable-promotion PR. Workflows retain lightweight operator/source/version checks, artifact build and integrity checks, and publication. Admin also resolves/tests the exact public Framework with `GOWORK=off` after Framework publication. Broad quality suites run locally.

## Verify publication access

Run the read-only governance checker for `core` and then `docs`:

```shell
bash tools/release/verify_remote_release_governance.sh --repository mss-boot-sys/mss-boot-admin --release-actor-login mss-boot-sys --scope core
bash tools/release/verify_remote_release_governance.sh --repository mss-boot-sys/mss-boot-admin --release-actor-login mss-boot-sys --scope docs
```

Main must require pull requests and reject deletion/force updates. Core tag rules must reject update/deletion without bypass. Publishing environments must select only their tag namespaces. Docs requires `CF_API_TOKEN` in repository or `prod` environment secrets; do not require an organization that no longer exists. GitHub Packages uses `GITHUB_TOKEN` with package write permission. Never request npmjs credentials or configure an npmjs Trusted Publisher.

## Publish in order

Keep a compact ledger with repository, version, full source commit, merged PR, local verification digest, active actor, tag/workflow URLs, package checksum, image digests and Docs identity. Reconstruct existing remote state after interruption. Require every existing identity to match exactly; an API error is never proof of absence.

From the exact qualified clean commit, create annotated tags one at a time and wait for success:

1. `mss-boot/vX.Y.Z`: Framework Release.
2. `admin/vX.Y.Z`: Admin Release and exact public Framework boundary.
3. `web/antd-v6/vX.Y.Z`: GitHub Packages tarball, SBOM, static archive, amd64/arm64 image and frontend Release.
4. `vX.Y.Z`: Root Release with six portable archives, six Agent tool bundles, installers/checksums, and Root amd64/arm64 image. Root becomes GitHub Latest directly.
5. `docs/vX.Y.Z`: build, archive, deploy the Docs website and verify public `/release.json`.

No npmjs publication, preview-run lookup, old GitHub Latest prerequisite, or independent stable-promotion workflow is used. A release here is unfinished until Docs is deployed and verified.

If a workflow fails transiently without source changes, rerun the same stage. Published bytes and core refs must remain unchanged. If a source repair is needed after immutable core publication, preserve that identity and prepare the next version through a PR.

Docs alone can be redeployed at a qualified merged-main descendant of Root: inspect the exact old Docs Release/tag, delete that Release then tag, prove both absent, and recreate the same annotated Docs tag. Never force-update. Retain deployment history through PRs, commits, runs and `/release.json`.

## Reconcile

Verify all tags peel to the intended source, Releases and checksums match, public Go modules resolve at the intended versions, the GitHub Packages tarball matches the released bytes and repository, and both images expose amd64/arm64 with exact version/revision labels. Install the public tool bundle into a clean directory and check its identity. Verify live Docs home/nested pages and `/release.json` in the in-app browser. Reconcile `currentStableCommit` from `pending` to the published full SHA through a final PR; pending is never a substitute for the public Root tag.

Report exact commit, merged PR, actual checks, artifact/release URLs, package identity, image digests, Docs deployment, migration/compatibility/security impact and any remaining blocker. Never claim skipped checks passed.
