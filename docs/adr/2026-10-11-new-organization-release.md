# ADR: First release under mss-boot-sys

- Status: Accepted for v1.3.9
- Date: 2026-10-11
- Scope: Repository identity, release packaging and documentation delivery
- Supersedes: Release-registry and publication-sequence details in the 2026-08-04 component-scoped CI and 2026-08-19 complete Admin Distribution decisions

## Context

Versions v1.3.8 and earlier were published under `mss-boot-io`, whose organization
is no longer visible. The maintained source is `mss-boot-sys/mss-boot-admin`.
The owner selected v1.3.9 as the first release in the new repository and requested
local validation followed by artifact publication, including a Docs deployment.

## Decision

1. Move active Go modules, imports, templates and images to `mss-boot-sys`.
   Publish the sole frontend package as `@mss-boot-sys/admin-web` only to GitHub
   Packages at `npm.pkg.github.com`. npmjs is no longer a release destination.
2. Preserve old release evidence under its original owner. Unavailable old
   repositories, artifacts and workflow history do not become prerequisites for
   publishing the new repository. Do not recreate or move historical tags.
3. Every release change goes through a PR to `main`. Freeze one exact remote-main
   commit with a clean tracked worktree, complete full validation locally, and
   preserve the actual results against that commit.
4. Component tag workflows validate source identity, build and publish artifacts.
   Publish Framework before Admin so the Admin build can resolve the exact public
   Framework with `GOWORK=off`. Publish the frontend package and image from its
   tag, then Root tools and image. No hosted candidate preview, npmjs Trusted
   Publisher configuration, or separate stable-promotion round is required.
5. Keep `https://docs.mss-boot-io.top`. Publish `docs/v1.3.9` through the existing
   Docs deployment path. Verify `/release.json` and the production homepage and
   nested routes. The coordinated request is not complete at source alignment.
6. Core publication identities remain immutable. Website-only Docs replacement
   follows the existing delete-Release/delete-tag/recreate procedure from a
   qualified merged-main descendant, without force-updating tags.

## Consequences

- Existing consumers migrate owned Go imports, npm scope, registry configuration,
  CI access and image references; this is an explicit compatibility change.
- GitHub Packages npm downloads require authentication even for public packages.
  Local consumers use a classic token with `read:packages`, injected through
  `NODE_AUTH_TOKEN`; Actions use permitted repository tokens. Credential values
  must not be committed, logged or baked into container layers.
- Rollback requires retained known-good binaries, packages, images, configuration
  and data backups. The old organization's availability cannot be assumed.
- A source version string does not prove publication. Component asset checks and
  the deployed website identity remain explicit completion evidence.

## Completion evidence

Record the merged source, local validation results, successful component workflow
runs, versioned artifacts and their hashes, image digests, deployed Docs
`/release.json`, and browser checks. Follow-up source repairs use another PR and
rerun affected validation; already public core identities are not rewritten.
