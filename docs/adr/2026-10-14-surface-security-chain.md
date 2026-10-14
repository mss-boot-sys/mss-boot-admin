# ADR: Core-enforced security chain for optional API surfaces

- Status: Accepted for v1.6.0
- Date: 2026-10-14
- Scope: `admin/business` (Registration, Registry), Admin token audience, server composition
- Amends: the `business.Runtime` invariant "modules cannot replace authentication, authorization, Session, CORS, or CSRF"

## Context

Optional modules (for example a customer-facing portal) need their own API
surface with their own identities and tokens. Before v1.6.0 a module could only
add routes below the protected Admin `/api` group. Letting a module bring an
arbitrary middleware chain for a new surface would break the invariant that the
core owns authentication, CORS and CSRF.

## Decision

1. `business.Registration` gains optional `Surfaces []SurfaceRegistration`.
   A surface is **declared**, never handed a `*gin.RouterGroup`: routes are a
   list of `{Method, Path, Category, Handlers}` mounted by the core.
2. Every surface is served at `/<name>/api` behind a chain the module cannot
   replace or reorder:
   `per-surface CORS (default deny) -> SurfaceAuthenticator (module-implemented,
   core-invoked) -> core aud/iss check -> CSRF (exact Origin) -> module
   middleware -> handlers`.
3. Route categories are a closed set: `public` and `authenticated`. Only a route
   explicitly declared `public` skips the authenticator; CSRF and CORS still
   apply. Unknown or empty categories fail registration.
4. The surface name is the only accepted audience. The core accepts a principal
   only if `aud` is exactly `[name]` and `iss` equals the declared issuer
   (constant-time). The authenticator receives a read-only `SurfaceRequest`
   (method, URL, headers, cookies, remote IP, `context.Context`) with no
   response writer and no `Next`/`Abort`, so it cannot advance or abort the
   chain. Every principal must report a `Credential` of `bearer` or `cookie`.
5. Names match `^[a-z][a-z0-9-]{1,30}[a-z0-9]$`, must be unique across modules
   and within one registration, and may not be reserved (`admin`, `api`,
   `oidc`, `.well-known`, `swagger`, static/SPA paths and health endpoints).
   Conflicts fail startup.
6. Mounting at least one surface switches Admin APIs to strict audience mode
   inside `Registry.MountSurfaces` itself (same effect as
   `auth.requireAdminAudience: true`), so every server wrapper path is covered.
   With no surface, the Admin route table, security contract and audience
   behaviour are unchanged and covered by the P1 baseline snapshot.
7. Surface CSRF in v1.6.0 is an exact-Origin check against the surface's CORS
   origins for unsafe cookie-authenticated requests. The bearer exemption
   follows the credential the authenticator reported, never the shape of the
   `Authorization` header. A surface may additionally opt into core
   double-submit tokens with `SurfaceRegistration.CSRF{SessionCookie, Key}`.
   Whether tokens are required is decided by the verified credential: for a
   cookie-authenticated unsafe request the core requires the session cookie
   (missing or empty -> 403), header `X-MSS-CSRF-Token` equal to the readable
   cookie `__Host-mss-<name>-csrf` (constant time), and an HMAC-SHA256 over
   (surface, nonce, session cookie value) under the surface key (>= 32 bytes;
   a key equal to the Admin auth key fails registration and mounting).
   The session and token cookies are read raw from the `Cookie` header (no
   decoding); any session cookie present (duplicate, empty, undecodable or
   malformed included) requires a valid token bound to that raw value, and
   duplicates or malformed values are rejected. The token header defaults to
   `X-MSS-CSRF-Token`; `SurfaceCSRF.HeaderName` may override it (valid header
   token, not `Authorization`/`Cookie`; empty falls back to the default). The
   resolved name is validated, checked, and always added to the surface CORS
   allowed headers, including custom `AllowHeaders`. Modules issue tokens with
   `business.SetSurfaceCSRFCookie` after sign-in or refresh.

## Consequences

- The runtime invariant now reads: modules cannot replace authentication,
  CORS or CSRF for Admin **or** for any surface; they only implement the
  credential lookup that the core calls and checks.
- New public API: `SurfaceRegistration`, `SurfaceRoute`, `SurfaceRouteCategory`,
  `SurfaceAuthenticator`, `SurfaceRequest`, `SurfacePrincipal`,
  `SurfaceCredentialKind`, `SurfaceCORS`, `Registry.MountSurfaces`,
  `Registry.Surfaces`. Field-name construction of `Registration` stays source
  compatible.
- Operators who install a surface must expect pre-v1.5.0 Admin tokens without
  `aud` to stop working.
