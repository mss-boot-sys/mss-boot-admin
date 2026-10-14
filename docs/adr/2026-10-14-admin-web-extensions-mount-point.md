# ADR: Frontend extension mount point via defineBusinessAdmin({ extensions })

- Status: Accepted for v1.6.0
- Date: 2026-10-14
- Scope: `web/antd-v6` business host API
- Exception to: AGENTS.md "Do not create a second SPA or split auth, layout, runtime, or contracts into independently versioned packages"

## Context

An optional module may ship UI for its own surface (for example customer pages)
as an independently versioned npm package. The repository rule forbids a second
SPA and forbids splitting auth, layout, runtime or contracts into separately
versioned packages.

## Decision

1. The host keeps one SPA. Extensions are registered at composition time with
   `defineBusinessAdmin({ extensions: [...] })`; there is no runtime plugin
   loading and no second entry point.
2. An extension contributes only: routes under its own surface prefix, an
   optional layout for those routes, a request client bound to `/<surface>/api`,
   and a locale namespace with matching `zh-CN`/`en-US` keys.
3. Bounded exception: an extension package may contain auth, layout and request
   code **for its own surface only**. It must not import, replace or wrap the
   Admin auth, Admin layout, Admin request runtime or Admin contracts, and Admin
   routes cannot be overridden.
4. With no extension registered, the Admin build output is byte-identical to the
   build without this feature; CI asserts this.

## v1.6.0 implementation boundary

- Option shape: `extensions: [{ surface, routes, layout? }]`; any other key is
  rejected, so an extension cannot pass its own request client, auth or Admin
  layout through the host API.
- Surface names follow the backend surface rules and additionally reserve
  Admin page prefixes (`user`, `users`, `workplace`).
- Every route path must stay below `/<surface>` and must not overlap
  `/<surface>/api`; overlaps with Admin or business routes fail the build.
- Pages mount at `/<surface>` with `layout: false` (or the extension's own
  layout module) before the Admin fail-closed fallbacks. In development the
  proxy forwards `/<surface>/api/` to the API target.
- Contract test: with no or empty `extensions`, the generated configuration is
  identical to the configuration without the option.
- Deferred to a follow-up: locale namespaces (`zh-CN`/`en-US`), example
  extension e2e, thin-host template and doctor updates, and a byte-level
  build-artifact comparison in CI.

## Consequences

- A module package version declares a host range (`admin >=1.6.0 <2.0.0`).
- thin-host template, doctor and compatibility scripts must learn the new
  option in the same PR that implements it.
