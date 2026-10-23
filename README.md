# mss-boot Complete Admin Distribution

[简体中文](./README.zh-CN.md)

mss-boot is an agent-native management-system foundation. **v1.6.2 is the current
Complete Admin Distribution for `mss-boot-sys/mss-boot-admin`** (v1.3.9 was the
first release here). Versions v1.3.8
and earlier belong to the former `mss-boot-io` organization. Historical records
are retained without recreating their tags or artifacts in this repository.

The commands below describe the v1.6.2 release contract and apply when the
corresponding [Release](https://github.com/mss-boot-sys/mss-boot-admin/releases/tag/v1.6.2)
and packages are available. All components must resolve to the same qualified
merged `main` commit; publication results are verified from their actual assets.

v1.6.2 makes sidebar navigation compact with collapsible directories, a top-level accordion and active-page positioning, including pathless parents and mobile dismissal. It also includes the reviewed dependency refresh and qualification progress improvements. Existing v1.6.1 behavior is retained; no database migration, API change or permission expansion is introduced.

## Distribution identities

| Surface | v1.6.2 identity |
| --- | --- |
| Root tools, backend image, and GitHub Release | `v1.6.2` |
| Reusable Go Framework | `mss-boot/v1.6.2` |
| Importable Admin Go module | `admin/v1.6.2` |
| Complete Admin Web | `web/antd-v6/v1.6.2` / `@mss-boot-sys/admin-web@1.6.2` |
| Documentation website | `docs/v1.6.2` at https://docs.mss-boot-io.top |

Admin Web is published only to GitHub Packages (`npm.pkg.github.com`); package
downloads require GitHub authentication. The website retains its existing
domain and records its deployed version and full source commit in `/release.json`.

## Install the v1.6.2 tools

The versioned installers verify release checksums, install both `mss` and
`mss-mcp`, do not use `sudo`, and do not modify a shell profile.

Linux or macOS:

```shell
curl -fL -o install-mss.sh \
  https://github.com/mss-boot-sys/mss-boot-admin/releases/download/v1.6.2/install-mss.sh
bash ./install-mss.sh --version v1.6.2
export PATH="$HOME/.local/bin:$PATH"
mss --version
mss-mcp --version
```

Windows PowerShell:

```powershell
Invoke-WebRequest `
  https://github.com/mss-boot-sys/mss-boot-admin/releases/download/v1.6.2/install-mss.ps1 `
  -OutFile install-mss.ps1
& .\install-mss.ps1 -Version v1.6.2
$env:Path = "$env:LOCALAPPDATA\Programs\mss\bin;$env:Path"
mss --version
mss-mcp --version
```

## Consume the release packages

Pin the exact coordinated Go and npm versions. The Admin module contains no
committed local `replace`. Configure GitHub Packages authentication as described
in the [package guide](./docs/docs/getting-started/packages.md). Run the Go commands from the root of an **existing external
consumer module** (a directory containing `go.mod`); for a clean public-resolution
check from an empty directory, use the [external consumer procedure](./docs/docs/getting-started/packages.md).
Run the npm command separately from an **existing frontend package root** (the
directory containing its `package.json`, normally `web/` in a Thin Host).

Go module root:

```shell
go get github.com/mss-boot-sys/mss-boot-admin/mss-boot@v1.6.2
go get github.com/mss-boot-sys/mss-boot-admin/admin@v1.6.2
```

Frontend package root:

```shell
corepack pnpm@10.34.5 add --save-exact @mss-boot-sys/admin-web@1.6.2
```

Thin Hosts pin the exact version. Set `NODE_AUTH_TOKEN` from a local secret store
with `read:packages`; never commit the token. The generated `.npmrc` contains
only the scoped registry and an environment-variable reference.

## Create and start a Thin Host

Run the released tool from an empty destination parent, not from a Foundation
source checkout:

```shell
mss new app orders-admin --module github.com/acme/orders-admin --repository acme/orders-admin --destination ./orders-admin --write --git-init

cd orders-admin
mss doctor --strict
mss setup
mss dev --detach
```

Interactive first setup asks for the initial administrator password with
hidden input. Non-interactive automation may inject
`MSS_ADMIN_INITIAL_PASSWORD` from a secret store for the `mss setup` process
only. It must not appear in arguments, reports, generated files, dependency
installation, or the long-running service environment. After initialization,
open `http://127.0.0.1:8001` and sign in as `admin`; there is no default
password.

## Upgrade a Thin Host

The namespace changes require migrating owned Go imports from
`github.com/mss-boot-io/mss-boot-admin` to
`github.com/mss-boot-sys/mss-boot-admin`, the npm scope to `@mss-boot-sys`, and
package registry authentication. Go 1.27.2 and Casbin v3 are required; callers
using exported Casbin types must adapt imports and compile their integrations.

Back up code, configuration, and the database; install the target v1.6.2 tools;
and verify both binaries before planning. A supported three-way upgrade requires
the generated `.mss/blueprint-manifest.json`:

```shell
mss --version
mss-mcp --version
mss upgrade admin v1.6.2 --format json
mss upgrade admin v1.6.2 --apply --yes --format json
mss doctor --strict
mss verify --all
mss upgrade admin v1.6.2 --format json
```

The first and final commands are read-only; the final plan must contain no
create, update, delete, or conflict operations. The upgrade engine changes only
Blueprint-managed files and preserves business-owned and unknown files. A
hand-assembled repository or one missing its manifest must generate a clean
v1.6.2 baseline in a new directory and migrate business-owned specifications
and files instead of fabricating a manifest.

## Architecture boundary

A generated application is a **Thin Host**. It imports the complete Admin Go
module and Admin Web package, owns only composition glue and business modules,
and does not copy Foundation core source. Backend modules register at compile
time, frontend business routes extend the packaged shell, and backend
authorization remains authoritative.

Runtime dynamic models, virtual CRUD, and browser-facing code generation remain
removed. Structured Feature and AdminModule specifications drive deterministic
development-time generation and reviewable migrations, permissions, menus,
frontend code, tests, and Agent evaluation contracts.

## Human and Agent documentation

The repository deliberately separates explanatory documentation from executable
Agent authority:

| Audience | Start here |
| --- | --- |
| Adopters, operators, and contributors | README files and `docs/docs/**` |
| Architecture maintainers | `docs/adr/**` |
| Foundation AI Agents | nearest `AGENTS.md` -> `.mss/**` -> applicable `.agents/skills/**` |
| Generated Thin Host AI Agents | the generated repository's `AGENTS.md`, `.mss/**`, and local Skills |

The public [Agent collaboration guide](./docs/docs/agent/index.md) explains the
model for humans; it is not an executable instruction source. Start with the
[quick start](./docs/docs/getting-started/index.md),
[package boundary](./docs/docs/getting-started/packages.md),
[tooling contract](./docs/docs/getting-started/tooling.md), and
[v1.6.2 release record](./docs/docs/releases/v1-6-2.md).

Foundation contributors should use
[`CONTRIBUTING.md`](./CONTRIBUTING.md) and the nearest `AGENTS.md` for
source-checkout commands and validation.

## License and security

Licensed under the [MIT License](./LICENSE). Report security issues through the
private process in [`SECURITY.md`](./SECURITY.md), not a public issue.
