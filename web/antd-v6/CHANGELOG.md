# Changelog

All notable changes to the independently released Ant Design 6 application are
recorded here. Retired frontend history remains available through Git history
and the root changelog, not as a current release surface.

## Unreleased

- Refresh exact source dependencies to Ant Design 6.6.6, React Query 5.104.2,
  Vitest 5.0.4 and Happy DOM 21.0.1; align runtime overrides and the Thin Host
  manifest contract. Preserve Node 24, pnpm 10.34.5 and immutable v1.6.1 artifacts.
- Keep Happy DOM 21's external stylesheet and iframe loading disabled by default.
  The upgrade changes the test environment, with no business API or data migration.

## [web/antd-v6/v1.6.1] - 2026-10-15

- Restore semantic theme colors for login primary-button states and the mobile auth background; preserve authentication behavior.

Coordinated patch version with the v1.6.1 Admin Distribution; publication is
verified from actual Release and GitHub Packages assets.

- Keep the SSO application menu subject to its existing permissions when the
  OIDC Provider is disabled. Interpret the protected client-list response
  `503 / SSO_PROVIDER_DISABLED` as “SSO is not configured”, with administrator
  guidance and no retry action or automatic retry for this deterministic state.
- Preserve ordinary retryable errors, including network failures and generic
  404 responses from older backends. Enabled-Provider behavior and all v1.6.0
  frontend features remain unchanged. Update the backend and frontend together.

## [web/antd-v6/v1.6.0] - 2026-10-15

Coordinated version with the v1.6.0 Admin Distribution.

- Restore `subTitle` on `PageShell`/`PageContainer` as a deprecated alias of
  `content`. v1.4.0 replaced the ProComponents-based `PageContainer` with
  `PageShell`, which silently dropped `subTitle` (and other ProComponents
  props); hosts upgrading from v1.3.x broke at type check. `content` wins when
  both are set.
- `mss-admin-web build` no longer fails downstream hosts on the reference
  application's default gzip ceilings (32 KiB entry / 240 KiB chunk / 940 KiB
  total). In a host build they are printed as a warning. Setting any
  `MSS_V6_*_GZIP_BUDGET_KB` or `MSS_V6_BUNDLE_BUDGET=enforce` enforces ceilings;
  `MSS_V6_BUNDLE_BUDGET=warn` makes any build advisory. The repository's own
  `build:release` still enforces the defaults.

### Known issue in v1.4.0 and v1.5.0

- Breaking change not recorded at the time: `PageContainer` from the runtime
  package no longer accepts ProComponents props such as `subTitle`. Use
  `content` for the page description (or upgrade to the release containing the
  compatibility alias above).

## [web/antd-v6/v1.5.0] - 2026-10-14

- Coordinated version with the v1.5.0 Admin Distribution; no Admin Web
  source changes.

## [web/antd-v6/v1.4.0] - 2026-10-14

- Default theme changed from dark to light; saved personal themes are kept.
- Side-layout desktop header renders by breakpoint (no CSS-hidden duplicate of
  host header contributions) and stays on route-level 403 pages, which now use
  `PageForbidden` (#24).

- Consistency pass ("所有页面风格要统一"):
  - `tokens.ts` is now the single token source.
  - The CSS is split into `shared/design-system/styles/*.css`. It has no raw
    hex colors, no duplicate rules and no dark-mode status overrides.
  - New primitives: `PageShell`/`PageHeaderActions`,
    `ListSurface`/`ListToolbar`/`FilterSlot`/`SearchField`/`BulkBar`,
    `StatCard`, `StatusBadge`, `FormModal` (sm/md/lg), `DetailDrawer` (md/lg)
    and `useTablePreferences`. `PageContainer` stays as a deprecated alias.
    All of them are exported from `/runtime`.
- Every list page shares the card surface, the inline toolbar filters, the
  header primary action and `RowActions`. This covers Language, Option,
  Online sessions, Logs, Notices, Tasks, System config and generated modules.
  Login, register and recovery share `AuthSplitLayout`.
- Guardrails: `scripts/check-style-guardrails.mjs` runs in `lint` and vitest.
  It rejects inline styles unless they carry a reason, raw hex colors and
  arbitrary `--mss-*` classes. The conventions are documented in `AGENTS.md`.

- Route tabs under the side-layout header: one closable tab per visited authorized menu page (workplace pinned, cap 12, sessionStorage), right-click menu (close / others / right / all), middle-click close.
- Users list: `导出` downloads the current filtered list as CSV (UTF-8 BOM, formula-injection safe, max 10,000 rows) via the existing list API.
- Admin lists: status filter becomes a `+ 状态` chip; users add `+ 角色` / `+ 部门` chips (new backend `roleID`/`departmentID` filters).
- Admin lists: `密度 · 列设置` popover (density + visible columns, persisted per browser; actions column always kept, at least one business column stays visible).
- Users list: `最近登录` column and `本周新增` / `在线会话` stat cards from the new root-only `/user/overview` endpoint; non-root operators fall back to disabled/locked counts and no column.
- Compact single-line footer (keeps ICP record and footer contributions); tighter sidebar rows and group titles.

- Admin lists: action column is now a primary `编辑` link plus a `⋯` overflow menu (`RowActions`); permission hide/disable rules preserved, danger actions confirm via modal.
- Login: mockup-style left-aligned title (no duplicate logo), labelled 40px inputs, gradient submit, `记住我` (persists only the username in localStorage; passwords/session never stored).
- Side layout: top-level menu directories render as group titles (`menu.type = 'group'`), still backend-driven.
- Users page: stat cards (total / enabled / disabled / locked) read from the existing paged list `total`; no fabricated trends.

### Changed

- Visual refresh (P0): indigo `#3b5bfd` brand color, three-layer light and dark
  surfaces, CJK-aware font stack, and component tokens for Layout, Menu,
  Button, Table, Input, Select, Modal and Result. The code-layer default theme
  is now `light`; existing application and personal overrides keep precedence.
- Administration list toolbars keep a single primary action: search is a
  default button, reset is a text button, refresh is an icon button with a
  tooltip, and business toolbar actions are right-aligned.
- Loading states show an automatic-retry notice after a failed attempt, and
  query retries back off at 600 ms / 1.2 s so a 5xx reaches the error state in
  about two seconds.
- 403 and 404 pages render inside the application layout with friendly copy and
  "Go back" / "Back to workplace" actions.
- Page descriptions and login security notes use plain product language in
  zh-CN and en-US. Two-character buttons no longer get an inserted space.
- Design-system pass matching the concept mockups: split login (brand panel +
  form), side layout by default with a sticky header (breadcrumb, ⌘K search
  field, actions, avatar), custom page header with a portal slot for the page's
  primary action, card-surfaced list with inline search, status filter chips,
  total count, icon refresh, row selection with a floating batch bar (users:
  batch delete), avatar/email user cell, pill role tags and dot status tags,
  icon quick-link cards on the workplace, and CSS motion tokens (page enter
  240 ms, row stagger, batch bar rise, card hover lift) that honour
  `prefers-reduced-motion`. The default layout watermark is removed.

## [web/antd-v6/v1.3.9] - 2026-10-11

Release scope: first coordinated release under `mss-boot-sys/mss-boot-admin`.
Publication results are recorded by the corresponding tags, Releases, registry
assets and checksums; this source entry does not itself certify publication.
Versions v1.3.8 and earlier belong to `mss-boot-io`; historical entries below
retain the facts and terminology recorded at that time.

### Repository migration

- Move Go modules, generated hosts and package identities to `mss-boot-sys`.
- Publish `@mss-boot-sys/admin-web@1.3.9` only to GitHub Packages; consumers
  supply `read:packages` authentication through `NODE_AUTH_TOKEN`.
- Qualify locally on an exact merged-main commit. Tag workflows build and
  publish artifacts without a hosted preview or separate stable-promotion round.
- Align and deploy Docs to the existing `https://docs.mss-boot-io.top` domain.


- Refresh the development dependency graph to React 19.3.0, Ant Design 6.6.5,
  ProComponents 3.1.15-7 beta, React Query 5.104.1, Umi Max 4.7.23, Vite 8.3.4
  and Playwright 1.64.0. Align Vitest 5.0.3 and all package/Thin Host dependency
  contracts with the actual manifest and lockfile; retain Node 24 and pnpm 10.34.5.
- Recalibrate the complete JavaScript gzip budget from 905 to 940 KiB after
  measuring the updated reference application, external business host and cold
  production routes. Keep the entry and individual chunk limits unchanged;
  record the measurements in the dependency bundle ADR.
- Add typed, compile-time Thin Host contributions for the shared avatar panel,
  header, and footer, preserving official account actions and layout controls.
- Isolate loading and render failures per contribution, filter visibility before
  mounting, and reset custom state across identity and session changes. Avatar
  content unmounts when its panel closes.
- Keep portaled business controls interactive inside the avatar panel while
  preserving outside dismissal and keyboard focus behavior.
- Navigate immediately after verified account/email login or registration, and
  after successful password recovery, without waiting for the success message
  to close. Preserve existing same-origin redirects and identity checks.
- Preserve business-owned registration modules across coordinated upgrades.
  These additions ship in the v1.3.9 package.

## [web/antd-v6/v1.3.7] - 2026-08-31

Status at original publication: **published / historical coordinated stable**. The Admin Web Release,
frontend image, official npm package `@mss-boot-io/admin-web@1.3.7`, npm
`latest`, Root image, GitHub Latest, and current-stable policy reconcile to exact
release commit `77b53d41092741eac62fa6418c0bdbf87413c7cd`. npm was published
through Trusted Publishing/OIDC with provenance and without a stored token.
Docs website publication is independent and does not gate this package.

### Changed

- Requalify the same React 19 and Ant Design 6 package-first application under
  the new v1.3.7 identity from one reviewed merged-main commit.
- Preserve public `web/antd-v6/v1.3.6` assets as immutable component history;
  do not use a local tarball, GitHub Packages, or the GitHub Release asset to
  substitute for its absent official npmjs package.

### Release

- Publish `@mss-boot-io/admin-web@1.3.7` through the exact npm Trusted
  Publisher binding for `npm-release.yml` and `npm-auto`, with OIDC provenance
  and no `NPM_TOKEN` or `NODE_AUTH_TOKEN` fallback.
- Reconcile the Admin Web Release, official npm package, Root image, complete
  Root ledger, and external Thin Host acceptance from the same commit before
  opening v1.3.7 adoption; that reconciliation is complete.

## [web/antd-v6/v1.3.6] - 2026-08-27

Status: **published Admin Web component / immutable partial distribution**.
`web/antd-v6/v1.3.6`, its GitHub Release, and GitHub Packages assets were
published from exact commit `b1fe47a3a83209574e09d53526b122dd2cbc5277`
by run `33078525148`. The official npmjs package
`@mss-boot-io/admin-web@1.3.6` was not published because run `33079323187`
failed with `ENEEDAUTH`; the Root image also failed and Docs was absent. The
public component remains immutable and is not a complete installation path.

### Added

- Add the statically compiled presentation-configuration console with distinct
  permission-denied, empty, draft, validation-error, publish, conflict,
  history, rollback, recovery-mode, and failed-request states in synchronized
  zh-CN and en-US catalogs.
- Add strict data-only presentation contracts, capability-hash validation,
  server-paginated aggregate/history views, safe previews, strong ETag
  transitions, and immutable rollback-as-republication behavior.

### Changed

- Export the complete Admin Web lifecycle and handwritten business route/locale
  seams through the single `@mss-boot-io/admin-web` package so generated Thin
  Hosts keep one React 19, Ant Design 6, Umi, and React Query runtime graph.
- Preserve exact package tarball metadata in frozen Thin Host locks and retain
  business-owned routes, locale files, and pages across Blueprint three-way
  upgrades.
- Requalify the exact React 19.2.8, Ant Design 6.6.1, ProComponents 3.1.14-6,
  React Query 5.101.4, Umi Max 4.7.7, Vite 8.2.2, and Vitest 4.1.11 graph.

### Security

- Treat presentation profiles as untrusted scalar data. They cannot carry
  scripts, HTML, SQL, URLs, methods, headers, permissions, dynamic imports, or
  executable components, and frontend permission controls do not replace
  backend authorization.
- Retain six machine-governed non-runtime Umi toolchain acceptances: two Vite,
  one node-fetch, two Immer, and one path-to-regexp advisory. Each is bound to
  an exact resolution and 2026-11-08 expiry; the release fails if any accepted
  package appears in browser runtime output.

### Compatibility and rollback

- Production business capability registration remains empty in this candidate,
  so existing pages continue to use compiled defaults after upgrade.
- Emergency rollback first enables backend startup-only
  `presentation.recoveryMode`, then restores the matching v1.3.2 frontend,
  Admin, configuration, lock, and database backup. Do not pair this candidate
  frontend with another Admin patch version.

## [web/antd-v6/v1.3.5] - 2026-08-26

Status: **coordinated v1.3.5 patch candidate**. This source-compatible release
uses a new identity so the package-first distribution can complete without
moving the published v1.3.4 component tag or GitHub Release.

### Fixed

- Preserve the exact packed Admin Web tarball URL in generated Thin Host lock
  metadata so frozen installs do not infer an invalid registry path.

### Changed

- Qualify `@mss-boot-io/admin-web@1.3.5` as the exact frontend dependency for
  a v1.3.5 Thin Host while retaining one React 19 and Ant Design 6 runtime graph.
- Publish the official npmjs package only after Framework, Admin, Admin Web,
  protected Root, and Docs evidence from the same commit is complete.

## [web/antd-v6/v1.3.4] - 2026-08-25

Status: **published component / immutable partial train**. The Admin Web tag and
GitHub Release resolve to
`d9b210d6672800f84f6403496a3ae871fb2aea9f`. GitHub Packages and the component
image were published, but Root, Docs, and
`@mss-boot-io/admin-web@1.3.4` on npmjs did not publish after the Thin Host
frozen-install gate exposed missing exact tarball metadata. Use v1.3.5 for a
coordinated distribution.

This source-compatible release reissued the single Admin Web package from the
repaired merged-main distribution commit without moving the published v1.3.3
component tag or GitHub Release.

### Changed

- Qualify `@mss-boot-io/admin-web@1.3.4` as the exact frontend dependency for
  a v1.3.4 Thin Host and keep the package-first development, lint, test, build,
  route-composition, authorization, localization, and bundle contracts.
- Retain one React 19 and Ant Design 6 runtime graph and the source-compatible
  v1.3.3 frontend behavior while the complete distribution restarts under the
  new patch identity.
- Publish the official npmjs package only after Framework, Admin, Admin Web,
  protected Root, and Docs evidence from the same commit is complete.

## [web/antd-v6/v1.3.3] - 2026-08-25

Status: **published component / immutable partial train**. The Admin Web tag
and GitHub Release resolve to
`c00591f2a3edd0bec29bb1023bca8a230648107a`; the coordinated train stopped
before Root and Docs, and `@mss-boot-io/admin-web@1.3.3` was never published to
npmjs. The tag and Release remain unchanged. Complete package-first adoption
uses v1.3.5 because the intervening v1.3.4 train was also component-partial.

This source-compatible patch aligns the only supported Admin frontend package
with the package-first v1.3.3 Distribution.

### Changed

- Qualify `@mss-boot-io/admin-web@1.3.3` as the exact frontend dependency emitted
  by a generated Thin Host, resolved from public npm without a local tarball.
- Document package-owned development, lint, test, and build commands as the sole
  downstream frontend lifecycle; downstream applications retain only config,
  generated routes/locales, and business-owned pages.
- Preserve the single React 19 and Ant Design 6 runtime graph and all v1.3.2 API,
  route-composition, authorization, accessibility, and delivery contracts.
- Validate the complete Admin-core plus business route registry before building
  lookup maps, failing closed on duplicate UI or server paths with both owners
  identified instead of allowing a business registration to overwrite core.
- Point the package-owned downstream Vitest configuration at the managed route
  facade when present, so custom registrations receive the same core-collision
  checks in tests as they do in the production application while older hosts
  retain the generated-only fallback.
- Refresh the exact Admin Web and Thin Host dependency graph to Ant Design 6.6.1,
  Umi Max 4.7.7, Vite 8.2.2, and Vitest 4.1.11 while retaining one resolved
  version of every governed runtime package.
- Recalibrate the complete compressed JavaScript corpus ceiling from 900 KiB to
  905 KiB after the exact dependency refresh moved the measured release build
  from 899.96 KiB to 900.47 KiB; entry and largest-chunk ceilings stay unchanged.

## [web/antd-v6/v1.3.2] - 2026-08-23

Status: **published / historical previous-stable component**. At the v1.3.2
publication checkpoint, the Admin Web package, Admin Go
module, Framework module, root distribution, and independently released Docs were
published from exact merged-main commit
`635fbb03a82976941e527d8ac1000fec0624abac`. The npm package tarball SHA-256 is
`8f24e441e09416b2536eedaf692cdff7292c226d81d82da3468917f65bb8b9a7`, its
integrity is
`sha512-24K4Js0wk5J44AK8/3EyRksfn1pR7NViv0zG17myMwzKFmXNTOv9BOZJdk4SpWVLUop3DJKkBXYwsEFixZ+6lA==`,
and the frontend image digest is
`sha256:f52ef4664cfd419356805c74567f7317b4a2086467d729366ee2097efbf9ac1e`.
At that checkpoint the public npm `latest` tag resolved to `1.3.2`; current
`latest` resolves to `1.3.7`. The v1.3.2 publisher used environment
`release-v6`; current npm Trusted Publishing is bound to repository
`mss-boot-io/mss-boot-admin`, workflow `npm-release.yml`, and environment
`npm-auto`; the one-time bootstrap token
and GitHub secret are absent.

The v1.3.1 Admin Web tag, package, image, and Release were never published after
the coordinated train stopped at the Admin checksum gate, so v1.3.2 used the next
stable identity and v1.3.1 remains component-partial history.
The complete RC6 preview published successfully from
`0ef09fb3caa1b2d424c540da23d01219135ebcfa` and remains immutable prerelease
history.

### Added

- Publish the sole complete Admin frontend as `@mss-boot-io/admin-web`, with a
  controlled file allowlist, stable exports, package-owned Umi integration, and
  `mss-admin-web dev|lint|test|build` commands for Thin Hosts.
- Publish the exact same verified tarball to npmjs as the credential-free
  primary registry and to GitHub Packages as a compatibility mirror, with
  version, gitHead, integrity, dist-tag, checksum, and provenance reconciliation.
- Compose deterministic business routes and menu registrations before the
  fail-closed 403/404 routes without copying core pages, layout, session,
  request, theme, locale, or design-system source into downstream repositories.
- Qualify a real repository-external Thin Host from the packed tarball,
  including one runtime graph, one `dist`, release bundle gates, and Playwright
  coverage against the external backend and frontend.

### Changed

- Promote the RC6-qualified Admin Web contract to the stable v1.3.2 target while
  retaining one source identity across its package, image, portable assets, and
  coordinated Go modules. Stable packages use the `latest` distribution tag;
  prereleases use `next`.
- Reject malformed external route contributions and resolve package-owned CLI
  commands independently of the caller's working directory before a packed Thin
  Host can reach the browser qualification phase.
- Label the frontend image with an explicit Admin Web OCI description instead of
  inheriting the root repository's Go-backend description.
- Enforce one installed React 19.2.8, React DOM 19.2.8, Ant Design 6.6.0,
  ProComponents 3.1.14-6, React Query 5.101.4, and Umi Max 4.7.5 runtime graph.
- Remove the downstream-invisible pnpm patch dependency and keep the canonical
  frontend source usable by both the official application and package consumers.
- Make generated Supplier browser qualification verify the authorized menu API,
  expand the configured parent menu, and navigate through the visible sidebar
  instead of allowing a direct URL to conceal a missing menu projection.
- Preserve configured generated parent-menu icons, mark decorative navigation
  icons as hidden from assistive technology, and retain accessible menu names.
- Reset generated create and update form values from the current operation every
  time an editor opens, so cancelled or stale values do not survive a reopen.
- Scope generated enum-selection assertions to the exact listbox referenced by
  the active combobox's `aria-controls`, keeping duplicate labels in separate
  fields semantic and strict-mode safe.

## [web/antd-v6/v1.2.2] - 2026-08-19

Status: **published / historical component release**. The V6 release, portable
assets, and multi-architecture image were published from
`29a99f2bdb9a2c516459529918795404c153df2e`. The synchronized root train remained
partial after its root image publish timed out; v1.2.3 later repaired that train.

### Changed

- Remove only Umi literal dynamic-route HTML placeholders from release output and
  fail closed if a placeholder contains anything except its generated index.html.
- Normalize release directory/file modes to 755/644, validate the output tree and
  TAR members, and test a concrete dynamic deep link through production Nginx.
- Keep both frontend and root workflows on the same checksummed portable archive;
  no artifact action traverses raw V6 output.

## [web/antd-v6/v1.2.1] - 2026-08-19

Status: **published / historical**. This was the first completed public release
of the sole Admin frontend. Its tag, GitHub Release, portable assets, image, and
multi-architecture manifests point to
`80d2d20f1b44105e18706cfa0deb7f8512966f92` and remain immutable.

- Use the dark appearance as the code-layer default while preserving application
  and personal theme overrides above it.
- Become the repository's sole Admin frontend without changing the independent
  `web/antd-v6` directory, tag, image, lockfile, or release identity. Canonical
  setup, local development, compose delivery, active documentation, generation,
  and root distribution now select V6; rollback selects a preceding V6 pair.
- Establish the React 19 and Ant Design 6.6.0 application foundation.
- Add exact dependency, bundle, same-origin delivery, CI, and release contracts.
- Use the deeper Terser release profile while retaining fast esbuild local builds,
  reducing the complete compressed JavaScript corpus from 958.47 KiB to 860.02 KiB
  and lowering the enforced release ceiling to 900 KiB.
- Render the application brand once in the default mixed desktop layout while
  preserving the dedicated accessible mobile header and side-layout identity.
- Use mandatory credential-free browser login, refresh, and OAuth callback endpoints;
  the backend has no stateless or retired-client browser compatibility mode.
- Add signed-CSRF request integration and a single-use WebSocket subprotocol ticket client.
- Add the typed backend identity contract, fail-closed compiled menu intersection,
  single React Query cache, and layered Ant Design 6 token theme runtime.
- Add canonical theme media type, ETag/If-Match, and authoritative 412 handling.
- Add one application/personal theme editor with field inheritance, whole-scope
  reset, RBAC read-only state, explicit conflict decisions, and responsive locale parity.
- Add monotonic cross-tab theme events, verified-subject personal session binding,
  Web-Locks-protected 24-hour snapshots, and public-only first-paint hints.
- Alias transitional Moment consumers to Day.js and reject Moment in the release bundle.
- Compile for the explicit Chromium/Edge 120+, Firefox 121+, and Safari 17.4+
  baseline, reject legacy `core-js`, and use public per-icon package subpaths so
  Utoopack does not retain unsupported compatibility or icon-barrel code.
- Add responsive account center and settings views with exact self-profile fields,
  synchronized locale catalogs, notification preferences, and provider-gated OAuth.
- Keep identity email read-only and make profile empty-value persistence explicit on
  the backend instead of copying the legacy ambiguous update behavior.
- Add PAT list/create/rotate/revoke flows whose one-time raw secret never enters the
  shared React Query cache or browser persistence.
- Add personal password rotation and OAuth disconnect with durable recent
  reauthentication, proof-failure limits, atomic session/PAT revocation, and
  protection against removing the final verified login method.
- Add authoritative authorization freshness on explicit/cross-tab events, 403,
  network recovery, and throttled focus/visibility changes, with exact domain-query
  eviction and a retryable fail-closed state when identity or menu cannot be verified.
- Push a non-sensitive global authorization revision after successful policy reload,
  with non-blocking server fan-out, secure ticketed WebSocket reconnect, heartbeat,
  cross-tab revision deduplication, and authoritative HTTP revalidation.
- Replace the workplace foundation placeholder with a responsive, localized operations
  view and protected monitor query. Validate bounded server history, follow server refresh
  cadence, honor `Retry-After`, stop polling on 401/403, retain last-good data, and show
  distinct warm-up, stale, error, permission, and empty-history states.
- Render CPU and memory trends with accessible token-aware native SVG rather than adding
  a chart runtime, and migrate remaining V6 Alerts and Statistics away from deprecated APIs.
- Add a fail-closed root-only online-session inventory with strict list/detail contracts,
  bounded foreground polling, explicit last-good/error/empty/permission states, responsive
  detail, and audited row-bound session and per-user revocation.
- Enforce a 100-row server page limit and omit the legacy arbitrary user-ID revoke control.
  Use Ant Design 6 Table after the bundle gate demonstrated that ProTable's unused schema
  features would exceed the application's total JavaScript budget.
- Add bounded language management with summary/detail projections, server-owned IDs,
  canonical BCP 47 names, definition limits, optimistic revision conflicts, and separate
  read/create/update/delete permissions. Use native Table/Form and Ant Design 6.6 Listy;
  load runtime translations as an optional enhancement limited to the complete shipped
  zh-CN and en-US catalogs.
- Add bounded Option management with summary/detail projections, server-owned record and
  item identity, complete prior-resource snapshots, tenant-namespaced cache invalidation,
  strong `If-Match` conflicts, built-in identity protection, usage-aware deletion, and
  separate read/create/update/delete permissions. Render opaque metadata as inert text
  through native Table/Form and Ant Design 6.6 Listy components.
- Keep Supplier as the deterministic V6 generator golden. The sole target emits
  the `web/antd-v6` route, locale, strict contract, typed transport, React Query,
  responsive CRUD, Vitest, and HttpOnly/CSRF-aware Playwright artifacts.
- Bind Max 4.7 development through its supported `PORT=8001` environment contract
  so local tools and Playwright cannot silently select another port.
- Mount model-consuming runtime bridges inside Umi's dataflow provider, namespace generated
  forms, expose stable localized action names, disable virtualization for bounded enum choices,
  and make generated browser fixtures safe for concurrent and repeated soft-delete runs. The
  Supplier HttpOnly/CSRF CRUD flow now passes Chromium desktop and mobile together.
- Reserve the independent `web/antd-v6/v{version}` tag and
  `mss-boot-admin-antd-v6` image namespaces.

Business parity is retained while this Unreleased change removes the retired
frontend and browser compatibility protocol. Publication still requires the
exact merged-main commit, the concentrated qualification suite, and immutable
artifact promotion. Rollback selects only the preceding qualified V6 pair.
