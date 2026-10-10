---
title: Native OIDC Provider and Proxmox VE
---

# Native OIDC Provider and Proxmox VE

This page describes the `codex/native-oidc-provider` development branch in `mss-boot-sys/mss-boot-admin`, based on main commit `65eb485` and its v1.3.7 distribution contract. The OIDC feature is not part of that published baseline.

Admin remains the account and policy authority. No separate identity service is required. Core authentication reuses its password verification, browser cookies, durable sessions, disabled-account checks and audit. `admin/oidc` owns the OIDC protocol; it uses the existing `golang-jwt/jwt/v4` library and Go crypto for RS256 and AES-GCM. It does not hand PVE an Admin JWT.

## Enable the Provider

1. Apply the normal Admin migrations, including `20261010100000`, using the same configuration and database as the server. From `admin/`, inspect `go run . migrate --help`, then run `go run . migrate` with the configured environment and database as documented in the repository setup guide. The migration adds seven OIDC tables and default-deny menu/API permissions. Existing accounts, sessions and business data are preserved. An existing conflicting `/sso` menu fails migration for explicit resolution.
2. Choose one stable public HTTPS origin reachable both by browsers and by every PVE server. Serve the Admin frontend and API on that origin. Register real DNS and trusted TLS through your normal deployment process. The examples here do not configure DNS or production services.
3. Supply a persistent 32-byte random wrapping key, base64 encoded, through your secret manager/environment. For example, generate it with `openssl rand -base64 32` in a secure operator session and store it as `MSS_OIDC_KEY_ENCRYPTION_KEY`. Never place it in Git, command arguments, screenshots, logs or a normal configuration list. All replicas must use the same value and database. Back it up separately from the database.
4. Add the following deployment configuration:

```yaml
application:
  origin: https://identity.example.com
auth:
  browserSession:
    secure: true
    sameSite: lax
oidc:
  enabled: true
  issuer: https://identity.example.com/admin/api/oidc
  keyEncryptionKeyEnv: MSS_OIDC_KEY_ENCRYPTION_KEY
```

The default is disabled. Enabled startup fails closed if the wrapping key, issuer, cookie policy or signing tables are unavailable. The issuer path is deliberately `/admin/api/oidc`, within the existing `/admin/api` session-cookie path. A deployment with a custom Admin route-group prefix is not supported by this first version. Discovery is at `https://identity.example.com/admin/api/oidc/.well-known/openid-configuration`.

The canonical cookie stays host-only, HttpOnly, Secure and SameSite Lax. Cross-site top-level GET navigation to authorization can carry it. The protocol does not widen global CORS, bypass Admin CSRF, or move the Admin cookie to `/`. The token and UserInfo endpoints use client/bearer authentication; consent POSTs require the existing browser CSRF header. A browser authorization continuation additionally requires an HttpOnly, short-lived browser-flow cookie.

## Register a PVE application

Open **SSO applications** in the system menu. A root operator can bootstrap access; delegate only the necessary menu/actions to other operators:

| Permission | Purpose |
| --- | --- |
| `sso:read` | Read client metadata and signing-key metadata |
| `sso:write` | Register, edit or disable clients and application allowlists |
| `sso:secret-rotate` | Generate a replacement client secret |
| `sso:key-rotate` | Rotate the Provider signing key |
| `sso:audit` | Read authorization and management audit |

These permissions do not flow to accounts merely because they may log into a PVE application. Conversely, a root Admin account still needs an explicit user or role application grant before OIDC authorization succeeds.

Register one confidential client per PVE cluster or independent instance. Multiple browser origins for one cluster may share its client. Do not infer cluster membership from node names.

- Add each **exact HTTPS browser origin**, such as `https://pve.example.com:8006`. PVE uses the browser's `location.origin`; do not append `/callback`, add a trailing slash, or omit a non-default port. Register each allowed proxy/node origin separately. Wildcards, URI fragments and HTTP are rejected.
- Allow `openid`, `profile`, `email` for PVE's usual request. Choose allowed claims from `name`, `preferred_username`, `email`. `sub` is always included. Claim release also depends on the requested scope. No `email_verified` claim is asserted because the account profile alone is not verified-email evidence.
- Fill allowed **user IDs**, or allowed **role IDs** as managed groups. These are immutable database identifiers, not usernames. User and role lists are ORed; empty lists deny everybody. The user-editable profile `group` field never grants access. No groups claim or automatic PVE group mapping is provided.
- Save the generated client ID and **one-time client secret** securely. Only a SHA-256 digest of the 256-bit secret is stored. Lists never return the secret or digest. Closing its dialog erases the displayed value from component state; loss requires rotation.

Saving any client edit or rotating its secret increments its revision and invalidates outstanding requests, codes and UserInfo access tokens for that client. Concurrent stale edits/rotations return 409; reload before retrying. Disabling a client rejects future authorizations and token/UserInfo requests.

## Configure the PVE realm

On a separately authorized test PVE cluster, use **Datacenter → Permissions → Realms → Add → OpenID Connect**. Labels and supported options depend on PVE version.

| PVE setting | Value |
| --- | --- |
| Issuer URL | `https://identity.example.com/admin/api/oidc` |
| Client ID | ID from the SSO application |
| Client Key | Its one-time secret |
| Scopes | `openid email profile` |
| Username claim | `sub` recommended |
| Autocreate | An operator policy choice; it creates an identity, not ACL grants |

`sub` is a random, persistent subject bound to the account's creation identity. It is independent of a mutable username/email and does not change when the account is renamed or the signing key rotates. A recreated account receives a new subject. `preferred_username` is available for display/integration compatibility but is unsuitable as a reusable security identity. The old PVE `username` alias may map to it depending on PVE version. Changing a realm's username claim after users exist can create different PVE identities: plan that separately.

PVE owns its users, roles and ACLs. Grant the resulting `subject@realm` principal the required PVE paths and privileges separately. SSO success and `autocreate` do not grant virtual-machine, storage or cluster administration. Do not assign broad Admin backend permissions merely to enable a PVE login.

The verified upstream code uses code flow with S256 PKCE and state/nonce; a configured client key uses HTTP Basic client authentication. The Provider supports `client_secret_basic`, not `client_secret_post`. It signs independent ID tokens with RS256 and issues opaque UserInfo access tokens. See the [Proxmox OIDC library](https://github.com/proxmox/proxmox-rs/blob/master/proxmox-openid/src/lib.rs), [realm API](https://github.com/proxmox/pve-access-control/blob/master/src/PVE/API2/OpenId.pm), [login window](https://github.com/proxmox/pve-manager/blob/master/www/manager6/window/LoginWindow.js) and [PVE access-control documentation](https://github.com/proxmox/pve-docs/blob/master/pveum.adoc). These upstream references do not substitute for testing the installed 8.3.0 and 9.0.3 releases.

PVE keeps login state on the initiating node. A reverse proxy/load balancer must preserve the initiating-node/callback relationship. Use the same external origin throughout the login. The same realm/client configuration within a cluster does not make its pending login state shared.

## Protocol and session boundaries

| Capability | Implementation |
| --- | --- |
| Discovery, Authorization, Token, JWKS, UserInfo | Standard protocol JSON/status/headers, outside the ordinary Admin response envelope |
| Authorization | GET or form POST, only `response_type=code`, `response_mode=query`, S256 mandatory |
| Authorization code | 60 seconds, digest-only storage, atomic single consumption; bound to client revision, exact redirect, subject/session, scopes, nonce and PKCE |
| ID token / access token | 5 minutes; no refresh token or offline access |
| `prompt=none` | No interaction; returns `login_required` if authentication is needed |
| `prompt=login`, `select_account`, `max_age` | Uses the canonical login page to establish a fresh session when required; continuation cannot remove these constraints |
| `prompt=consent` | Explicit allow/deny page with browser/session/CSRF checks |
| `auth_time` | Actual durable session login time, preserved in the authorization code and ID token |
| Nonce | Stored with the request/code and echoed in the signed ID token; PVE must compare its expected nonce |
| Request objects, `request_uri`, claims parameter, `id_token_hint`, ACR requirements | Not supported; explicitly rejected, never advertised as supported |
| Dynamic registration, implicit/hybrid grants, logout/session-management endpoints | Not implemented or advertised |

See [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html) and [Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html) for protocol definitions. This is a bounded implementation, not an OpenID certification claim. Client authorization is administratively preapproved by the application allowlist and claim policy; normal authorization therefore does not prompt repeatedly. `prompt=consent` always presents interaction. `select_account` presents fresh canonical authentication rather than maintaining a separate account chooser.

UserInfo reloads the enabled account/role, unrevoked durable session, enabled client revision and current application grant. Revoking the Admin session, disabling the account/client or removing access prevents further Provider access. An already signed ID token remains cryptographically valid until its expiry. PVE has its own tickets, CSRF tokens and session renewal: **Provider logout or disablement does not immediately terminate all existing PVE sessions**. Use PVE's own session/access controls for urgent RP-side revocation. The Provider does not advertise an end-session endpoint.

## Keys, operations and troubleshooting

Private signing keys are encrypted in the database with AES-256-GCM and a separate external wrapping key; key IDs and public JWKS are safe to distribute. The first enabled startup creates the key set transactionally. Subsequent startups reuse it and reject a different persisted issuer or an unusable wrapping key. Rotation generates a new active key and keeps retired public keys available for 24 hours, covering five-minute tokens and JWKS refresh. Old encrypted key records remain durable for audit/backup. Never replace the wrapping key casually: losing it prevents signing with existing keys. There is no automated wrapping-key migration in this version.

Use a database shared by all replicas and route security reads to its primary. Application grants and token state are not authorized from an eventually consistent replica. Back up the subject table, encrypted keys, key-set issuer and wrapping key together; restoring only part can break identity continuity. A rollback disables `oidc.enabled` without dropping these tables.

| Symptom | Check |
| --- | --- |
| 404 on Discovery or SSO management | Provider disabled; route prefix/configuration differs |
| Startup rejects issuer/wrapping key | Exact HTTPS issuer, same frontend origin, secret environment variable, persisted issuer and key continuity |
| No redirect / `invalid_request` | Client ID and exact registered redirect URI, duplicate parameters, unsupported request options |
| `invalid_client` / 401 | Enabled client, current secret, HTTP Basic; do not use form-post client secrets |
| `invalid_grant` | 60-second code expiry, reuse, client revision changes, exact redirect, verifier, user/role and server-session state |
| `access_denied` | Explicit user/role allowlist, account and role enabled; Admin root is not an implicit SSO allowlist entry |
| Repeated login | Cookie host/path/Secure/Lax, same public origin, expired session, `prompt` or `max_age` |
| PVE accepts identity but denies action | PVE ACL/user provisioning; check `sub@realm` mapping separately |
| PVE reports missing state | Callback landed on another PVE node or changed origin |

Audit contains action, client ID, user ID, time and outcome; it does not retain codes, verifiers, client secrets, tokens, nonce, state or request bodies. Access/recovery logs redact credential query fields. Configure reverse-proxy/CDN access logs with equivalent query/header redaction: application redaction cannot sanitize upstream logs.

## Acceptance evidence

Automated Go tests exercise the canonical password login and its actual session cookie, SQLite persistence, protocol HTTP handlers, independent verification against the public RSA JWKS, repeated SSO, prompt/max-age/consent semantics, replay/concurrent exchange, client/redirect/PKCE checks, grant/session revocation, key rotation, management permissions and migration idempotency. Browser UI fixtures verify the application-management controls separately. Test fixtures are not live Proxmox verification.

Before deployment, use explicitly authorized test instances from both PVE 8.3 and 9.0 series: record installed package versions; test first and second-client SSO, exact node/proxy callbacks, state affinity, nonce validation, key rotation, disabling accounts/clients, PVE ACL denial and PVE-side session revocation. No live PVE realm, ACL, host, DNS or release is modified by this implementation task.
