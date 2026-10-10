# Security Policy

## Reporting a vulnerability

Do not open a public issue for suspected vulnerabilities.

Use GitHub Security Advisories for this repository when private vulnerability
reporting is enabled. If that setting is not available yet, contact the
maintainer privately and include the affected commit/tag, impact, reproduction
steps, and any proof of concept.

The organization still needs a final public security contact. Until then,
private GitHub advisories are the preferred intake path.

## Supported versions

The active `main` branch and the v1.3.9 Distribution are the new repository's
support baseline. v1.3.9 is the first release under `mss-boot-sys`; v1.3.8 and
earlier belong to the former `mss-boot-io` organization and are handled case by
case. The release assets and `.mss/release-policy.yaml` identify the exact
supported version. This source document is not proof that publication completed.

Admin Web is published only to GitHub Packages. Workflows use a least-privilege
`GITHUB_TOKEN`; consumers supply `read:packages` authentication through an
environment variable. Credentials must never enter repository files, container
layers, generated output, logs, or release archives.

## v1.3.9 security boundary

- Presentation profiles are untrusted, strictly data-only overlays over exact
  compiled capabilities. They cannot define code, HTML, SQL, transport, routes,
  permissions, runtime models, or executable components.
- `presentation:read`, `presentation:draft-write`, `presentation:publish`, and
  `presentation:rollback` are independent backend permissions. Existing
  ordinary roles receive none of them automatically, and UI visibility is not
  an authorization decision.
- Strong ETags, capability-hash validation, hashed idempotency keys, immutable
  revisions, and redacted audit metadata protect publication and rollback.
  Startup-only `presentation.recoveryMode` bypasses stored layers without
  deleting their evidence.
- Six high/critical advisories inherited through the Umi build or inactive
  plugin graph have time-bounded non-runtime acceptances through 2026-11-08:
  two Vite, one node-fetch, two Immer, and one path-to-regexp finding. Exact
  resolutions are machine checked; no accepted package may enter the browser
  runtime bundle.
- Fresh initialization no longer accepts `migrate --password` or `migrate -p`.
  A hidden interactive prompt or one-use `MSS_ADMIN_INITIAL_PASSWORD` injection
  is confined to the initialization process and must not be persisted or logged.

## Response expectations

- Acknowledge valid private reports within 7 days when possible.
- Triage severity, affected versions, and exploitability before public
  disclosure.
- Prepare a fix, release note, image tag, and upgrade guidance before disclosing
  details.
