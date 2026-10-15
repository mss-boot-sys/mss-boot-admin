# Monorepo guide

## Layout

| Path | Purpose |
| --- | --- |
| `/` | Agent/Foundation Go tooling and shared repository contracts |
| `admin/` | `github.com/mss-boot-sys/mss-boot-admin/admin`, the complete importable Admin application |
| `mss-boot/` | `github.com/mss-boot-sys/mss-boot-admin/mss-boot`, the reusable Go framework |
| `web/antd-v6/` | Sole React 19 + Ant Design 6 source and `@mss-boot-sys/admin-web` package |
| `docs/` | Dumi documentation site |

`go.work` activates the backend and framework modules together. Do not add a local `replace` directive to either published `go.mod`; workspace mode is the source of truth for repository-local development.

`go.work` is only a repository-development convenience. Every publishable Go
module and the generated Thin Host are also qualified with `GOWORK=off`; normal
module files never contain a local checkout replacement.

## Common commands

```shell
make deps-all
make test-all
make web-install web-lint web-test web-build
make docs-install docs-build
```

## Release tags

- Root Admin Distribution: `vX.Y.Z`
- Framework module: `mss-boot/vX.Y.Z`
- Complete Admin Go module: `admin/vX.Y.Z`
- Admin Web package and image: `web/antd-v6/vX.Y.Z`
- Documentation: `docs/vX.Y.Z`

Runtime components retain component-scoped tags but share one exact qualified
merged-main commit and the v1.6.1 Distribution version. v1.3.9 was the first
release under `mss-boot-sys/mss-boot-admin`; v1.3.8 and earlier belong to
`mss-boot-io` and are historical records, not prerequisites for the new release.

Release changes go through a PR to `main`. Freeze the exact merged commit with a
clean tracked worktree and complete local release validation once. Tag workflows
do not repeat expensive qualification: they validate release identity, build and
publish the corresponding archives, checksums, packages, images, and GitHub
Releases. Publish Framework, Admin, Admin Web, and Root tags in order; Admin must
resolve the exact public Framework dependency with `GOWORK=off`.

The npm package `@mss-boot-sys/admin-web` is published only to GitHub Packages at
`npm.pkg.github.com` by the frontend tag workflow using its scoped `GITHUB_TOKEN`.
Consumers configure the scoped registry and supply a `read:packages` token via
`NODE_AUTH_TOKEN`. No npmjs publication, Trusted Publisher setup, hosted candidate
preview, or separate stable-promotion round is required. Root publication marks
the new GitHub Release as Latest.

Publish `docs/v1.6.1` using the existing Docs deployment workflow and domain
`https://docs.mss-boot-io.top`. Verify `/release.json`, the homepage, a nested
release route, console errors, and failed requests after deployment. A Docs
failure requires a Docs repair; it does not invalidate already published
immutable packages. The coordinated task is complete only after the requested
website deployment is verified.

Core tags, package versions, and image identities are immutable. Source defects
require a follow-up PR merged to `main`; after any core identity is public,
repairs use an unused release version. Only website-only Docs tags may be deleted
with their Release and recreated from a qualified merged-main descendant.

## Workflow location

Only workflows under the repository-root `.github/workflows/` directory are
active. Imported, nested workflow snapshots are not retained because GitHub does
not execute them in this monorepo.

## Import provenance

`MONOREPO_IMPORTS.md` records the source repositories and exact imported commits
as historical provenance. It does not define a current checkout, build, adoption,
or release path.
