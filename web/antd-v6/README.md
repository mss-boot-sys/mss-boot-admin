# @mss-boot-io/admin-web

## v1.3.7 stable status

v1.3.7 is the current stable, adoptable Complete Admin Distribution. The exact
`web/antd-v6/v1.3.7` Release and official
`@mss-boot-io/admin-web@1.3.7` npmjs package were qualified with the matching
Framework, Admin, Root tools, and images from merged-main commit
`77b53d41092741eac62fa6418c0bdbf87413c7cd`. Thin Hosts pin this exact package;
the npm `latest` tag also resolves to `1.3.7`.

v1.3.5 and v1.3.6 remain immutable partial trains. `web/antd-v6/v1.3.6`, its
GitHub Release, and GitHub Packages assets are public and immutable, but the
official npmjs identity `@mss-boot-io/admin-web@1.3.6` was **not** published.
Neither partial train has a supported complete installation path.

Do not substitute a GitHub Packages artifact, Release tarball, local package,
or source checkout for an official npmjs identity. The Docs website publishes
independently and may lag; a `docs/v*` tag or site deployment does not change
this package's availability or stable identity.

## Package contract

The unreleased source dependency refresh was checked against the public npm
registry on 2026-10-10. It uses React 19.3.0, Ant Design 6.6.5,
ProComponents 3.1.15-7, React Query 5.104.1 and Umi Max 4.7.23.
ProComponents intentionally follows the upstream
[`beta` channel](https://registry.npmjs.org/@ant-design%2fpro-components/beta):
the `latest` channel still points to the incompatible v2 line.
Package manifests, lockfiles, dependency checks and the Thin Host Blueprint
record the same exact runtime versions. These source updates do not change
the published stable identity described above.

The release gzip budgets are 32 KiB for the entry, 240 KiB for any single chunk
and 940 KiB for the complete JavaScript corpus. The
[dependency bundle ADR](../../docs/adr/2026-10-10-dependency-bundle-baseline.md)
records the reference application, external host and cold-route measurements
behind this dependency refresh.

Admin Web is the Distribution's single complete browser application: React 19,
Ant Design 6, Umi Max, React Query, generated API contracts, authentication
shell, page states, locales, and the narrow business-route extension.

The v1.3.7 npm package provides these declared exports:

- `@mss-boot-io/admin-web` or `/runtime` for the packaged runtime;
- `/business` for generated business registration;
- `/preset` for the supported Umi preset;
- `/styles` for the public style entry;
- `/testing` for package-supported test helpers.

The package also defines the `mss-admin-web` command used by a generated Thin
Host. Consumers must not import `src/*`, copy core pages, redirect aliases to
Foundation source, or create a second SPA.

Release builds cap JavaScript and CSS compression at two workers each to avoid
allocating separate JavaScript heaps for every available CPU core. The production
compression settings, runtime checks, and bundle budgets continue to apply.

Tailwind scans explicit TS/TSX source roots instead of automatically scanning
the workspace. Generated Thin Hosts scan both the packaged Admin core and their
own business sources; the reference application scans its own source tree.

Business routes register together with their menu projection before the final
403/404 fallbacks. Client access checks improve user experience; backend
authorization remains authoritative. Retained pages represent loading, empty,
retryable error, denied, and responsive states with synchronized Chinese and
English locale keys.

The stable package also contains the statically compiled presentation-configuration
console. Its profiles remain strictly data-only, its frontend permission state
is advisory to backend RBAC, and production business capability registration is
empty so existing pages retain compiled defaults.

Install the official public package with
`corepack pnpm@10.34.5 add --save-exact @mss-boot-io/admin-web@1.3.7`.
Official npm publication remains credentialless through the exact
`npm-release.yml` plus `npm-auto` Trusted Publisher identity; no npm token is
stored. See
[package status](../../docs/docs/getting-started/packages.md) and
[mss-shop status](../../docs/docs/getting-started/mss-shop.md).
Repository-source build and publication commands remain contributor-only in
[`AGENTS.md`](./AGENTS.md) and [`CHANGELOG.md`](./CHANGELOG.md).

## Workplace business content

The proposed compile-time contribution interface is described in [the adopter guide](../../docs/docs/admin/workplace-business-content.md). It is unreleased and preserves the core workplace.
