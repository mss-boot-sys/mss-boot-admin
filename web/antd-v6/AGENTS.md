# Ant Design 6 frontend agent instructions

## Scope

This file applies to `web/antd-v6/` and inherits the repository contract. This
directory is both the official Admin application and the sole complete
`@mss-boot-sys/admin-web` package. Both surfaces use this same source tree. It
must not read source, build output, dependencies, local storage, service
workers, or release identity from any retired frontend artifact.

## Frozen toolchain

- Node.js 24.
- pnpm 10.34.5 through Corepack. pnpm 11 is intentionally deferred until its
  SQLite store is reliable on the supported Node 24 and WSL/CI matrix.
- React 19, Ant Design 6.6.6, Umi Max 4.7.23, React Query 5, and a pinned
  ProComponents 3 beta.
- Biome, TypeScript, Vitest, and Playwright.

Do not add a floating dependency range. Update `package.json`, `pnpm-lock.yaml`,
the dependency contract test, and the upstream provenance in one reviewed
change.

## Canonical commands

```shell
corepack pnpm@10.34.5 install --frozen-lockfile
corepack pnpm@10.34.5 run deps:check
corepack pnpm@10.34.5 run lint
corepack pnpm@10.34.5 run test:ci
corepack pnpm@10.34.5 run build:release
corepack pnpm@10.34.5 run delivery:smoke
corepack pnpm@10.34.5 pack
```

From the repository root use `make web-v6-install web-v6-lint web-v6-test
web-v6-build` or `go run ./cmd/mss verify --changed`.

## Architecture boundaries

- `src/app/` owns startup and the application shell.
- `src/modules/<domain>/` owns one business capability vertically.
- `src/shared/api/` owns transport and generated-client adapters.
- `src/shared/auth/` owns browser session behavior, never authorization policy.
- `src/shared/design-system/` owns public tokens, semantic styles, page states,
  and responsive primitives.
- `src/generated/` is deterministic output and must not be hand edited.
- `package/` contains small public adapters only; it must not become a second
  application source tree. `bin/mss-admin-web.cjs` owns downstream commands.
- Public package imports use only declared `exports`. Do not expose `./src/*`,
  redirect a Thin Host's `@` alias, or require consumers to copy core pages,
  patches, configuration, or `src/shared`.
- Core source uses `@mss-admin-core`; `@mss-admin-business/routes` is the
  generated menu-registration bridge. `@mss-admin-business/workplace`,
  `@mss-admin-business/avatar`, and `@mss-admin-business/layout` are compile-time
  content bridges for the workplace, avatar panel, and header/footer. They add
  trusted host content without permitting core replacement. Reuse the shared
  registration validation and render isolation while retaining each region's
  public contract and lifecycle.
  Business routes and registrations must
  be injected together before the 403/404 fallbacks.

React Query owns server state. Umi initial state contains only verified identity
and startup-critical client state. Do not duplicate server resources in a Umi
model, component-local cache, and query cache.

Backend authorization remains authoritative. Client route access is a user
experience guard and must have backend positive and negative tests.

Every package change must pass a real `pnpm pack` allowlist check and an
external Thin Host install/lint/test/build. Runtime singleton claims require
the installed pnpm graph and production bundle evidence, not manifest review.

## Ant Design 6 rules

- Use ConfigProvider CSS variables and public semantic tokens.
- Customize components through tokens or documented `classNames` and `styles`.
- Do not select undocumented `.ant-*`, `.ant-pro-*`, CSS-in-JS hash, or DOM
  hierarchy classes.
- Use `App.useApp()` for message, modal, and notification context.
- Use current v6 API names and keep the browser console free of deprecation
  warnings.
- Import icons from public `@ant-design/icons/<IconName>` subpaths. The package
  barrel currently prevents complete Utoopack tree-shaking and is rejected by
  the dependency contract.
- Tailwind owns layout utilities, CSS Modules own local static rules, and
  antd-style owns complex token-aware rules.
- Prefer one responsive component over parallel desktop and mobile business
  implementations.

## Frontend conventions (UI consistency)

Every routed page looks and is built the same way. Reuse, do not re-create.

- **Tokens.** `src/shared/design-system/tokens.ts` is the only TypeScript
  source of colors, layout metrics, overlay widths and motion. Ant Design
  re-exports them as `--mss-*` CSS variables. `styles/base.css` mirrors the
  few brand constants CSS needs. Anywhere else, use the variables or the
  semantic Tailwind colors from `src/tailwind.css` (`text-fg`,
  `text-fg-secondary|tertiary|quaternary`, `bg-surface`, `bg-canvas`,
  `border-line`, `divide-split`, `text-brand`).
- **Styles.** Shared CSS lives in `src/shared/design-system/styles/`:
  - `base.css`
  - `motion.css`
  - `surfaces.css`
  - `list.css`
  - `layout.css`
  - `auth.css`

  `src/tailwind.css` only imports them. Class names use the `mss-` prefix and
  the form `mss-<block>[-<element>]`, with state carried in `data-*`
  attributes (`data-tone`, `data-active`).
- **Primitives.** These live in `src/shared/design-system/` and are exported
  from `@mss-boot-sys/admin-web/runtime`:
  - Page: every page renders one `PageShell` (title, description, `extra`).
    The page's primary action goes through `PageHeaderActions`.
  - List: a `ListSurface` holds a `ListToolbar` (or a
    `Form className="mss-list-filters" layout="inline"` with `FilterSlot` /
    `ListToolbarEnd`) and then the table. Also use `SearchField`,
    `FilterChipSelect`, `TableSettings` + `useTablePreferences`, `BulkBar`, and
    the `mss-table-pagination` class on table pagination.
  - Row actions: `RowActions`, one primary link (usually Edit) plus a "⋯"
    overflow menu. Danger actions confirm inside the overflow menu.
  - Overlays: use `FormModal` (`sm` 480 / `md` 720 / `lg` 880) for
    create/edit and `DetailDrawer` (`md` 560 / `lg` 720, full screen on phones)
    for details. Never pass raw widths.
  - Status and KPIs: `StatusBadge` (`success|error|warning|processing|default`),
    `StatCard` / `StatGrid`.
  - States: `PageLoading`, `PageEmpty`, `PageError`, `PageForbidden`.
  - Public auth pages render inside `AuthSplitLayout`.
- **Guardrails** (`pnpm run lint` runs `scripts/check-style-guardrails.mjs`;
  `tests/style-guardrails.test.ts` runs it in CI):
  - No inline `style={{…}}`. Data-driven values such as registry `order` need
    a `// style-guardrail-ignore: <reason>` comment within 3 lines.
  - No raw hex colors outside the token sources.
  - No `[var(--mss-…)]` arbitrary classes; add a semantic color instead.
- **Codegen.** `templates/module/frontend-v6/page.tsx.tmpl` uses the same
  primitives. Change it together with the primitives, bump
  `frontendV6TemplateRevision`, and regenerate with
  `go run ./cmd/mss module generate .mss/modules/<spec>.yaml --write`.
- **Selectors.** `.ant-*` selectors are limited to the existing scoped
  exceptions (sider rows, toolbar-form labels, auth form). Prefer
  `className` / `classNames` props.

## Completion rules

Every retained page considers loading, confirmed empty, retryable error, 403,
404, conflict, desktop/mobile, zh-CN/en-US, keyboard/focus, generated contract
drift, and backend authorization. PWA, analytics, AI demos, and removed runtime
developer tools are outside this application.
