---
name: mss-update-release-docs
description: Align current MSS documentation, machine guidance and the public Docs site with a release version. Use for version, repository, package, install, migration or deployed-site updates. Publication itself uses mss-release.
---

# Update MSS release documentation

Read the applicable `AGENTS.md`, `.mss/project.yaml`, `.mss/lock.yaml`,
`.mss/release-policy.yaml`, the current release Feature, package manifests,
workflows and changelogs. Follow the user's authorized release scope.

## Release baseline

v1.3.9 is the first release from `mss-boot-sys/mss-boot-admin`. Versions v1.3.8
and earlier belong to the former `mss-boot-io` organization. Do not require old
repository access, historical workflow recovery, or recreating old tags before
publishing the new repository. Preserve old records, source commits, package
names, checksums and artifact URLs as history.

Record the target version, exact merged-main source commit when known, component
tags, release URLs, package identity, image digests and deployed Docs identity.
A version in source is not proof of publication. Use stage-neutral release
instructions while preparing and verify actual assets after publication.

## Current documentation

Inventory README files, component guides, `docs/docs/`, `.mss/`, templates and
applicable Skills. Classify every match as current guidance, historical evidence
or generated output before changing it.

- Current Go modules use `github.com/mss-boot-sys/mss-boot-admin` and its `/admin`
  and `/mss-boot` modules. Current images use `ghcr.io/mss-boot-sys/`.
- The sole Admin Web package is `@mss-boot-sys/admin-web`, published only to
  GitHub Packages at `npm.pkg.github.com`. Document scoped registry setup and
  `read:packages` authentication via an environment variable. Never save tokens
  in source, logs, images or generated files. Third-party npm dependencies keep
  their existing registries.
- Keep English and Chinese versions equivalent. Explain Go namespace, npm
  scope, dependency, database and compatibility changes with concrete migration
  and rollback steps. Do not assume an unavailable old registry can supply
  rollback artifacts.
- Change generated documentation at its specification or generator source and
  regenerate. Do not modify lockfiles or package metadata merely to satisfy a
  prose check.
- Separate release scope from capability maturity. Actual integration tests,
  not the release version, establish support claims.

## Validation and publication

Run `python3 tools/docs/check_current_docs.py`, its focused tests, and the
repository Docs build (`make docs-build`). Inspect the local homepage and changed
nested routes in the built-in browser, including refresh, narrow layout, console
errors and failed requests. Keep screenshots for material presentation changes.

All source changes go through a PR to `main`. The release operator freezes an
exact clean merged-main commit, completes full validation locally, then publishes
component tags through `mss-release`. Workflows validate source identity and build
and publish artifacts. Do not add hosted candidate previews, npmjs Trusted
Publisher setup or a separate stable-promotion/reconciliation round.

Docs retains `https://docs.mss-boot-io.top`. Source alignment alone does not deploy
it. When the user requests Docs publication, publish `docs/vX.Y.Z`, wait for the
existing deployment workflow, then check public `/release.json` for the expected
version and full commit. Refresh the production homepage and a nested release
route in the built-in browser and verify visible content, console and requests.
Docs deployment is a required completion item for a coordinated request that
includes it; a website failure does not authorize moving immutable core tags.

Root, Framework, Admin, frontend, package and image identities remain immutable.
Only the website-only Docs tag and its Release may be deleted together and then
recreated from a qualified merged-main descendant of the matching Root commit,
when the existing authorization covers that repair. Never force-update the tag.

Report current documents changed, historical evidence retained, validation
actually run, PR/merged source, and website deployment identity separately. If
publication is pending, name the concrete missing prerequisite or failed step;
do not call the source-only update complete.
