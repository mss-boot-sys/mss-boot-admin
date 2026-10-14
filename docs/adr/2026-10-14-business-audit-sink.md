# ADR: Redacted audit sink for business modules (Runtime.Audit)

- Status: Accepted for v1.6.0
- Date: 2026-10-14
- Scope: new `admin/business/audit`, `business.Runtime`

## Context

Modules and surfaces need to write audit evidence. `business.Runtime` has no
audit dependency today, and letting each module write its own audit storage
would fragment evidence and redaction.

## Decision

1. New package `admin/business/audit` with
   `type Sink interface { Record(ctx context.Context, e Event) error }` and
   `Event{Surface, Action, Resource, Result, ActorKind, ActorID, RequestID, IP,
   UserAgent, At, Detail map[string]string}`.
2. `business.Runtime` gains an `Audit audit.Sink` field. The core
   implementation writes to the existing operation audit store, filterable by
   surface through `/admin/api/audit-logs/operation`.
3. Every `Detail` passes a core redactor. Tokens, refresh tokens, OAuth
   code/state, PKCE verifiers, cookies and `Authorization` headers are never
   persisted; contract tests enforce it.

4. Storage needs no migration: events are rows of the existing operation audit
   table with `type=business`, `path=/<surface>/api`, `user_id=ActorID`,
   `message=Result` and the redacted `Detail` as JSON in `request`.
5. `Registry.Mount` always wraps `Runtime.Audit` with `audit.Redacting`, so a
   host-supplied sink cannot receive unredacted events; a nil sink becomes
   `audit.Discard`.
6. Surface handlers record through `business.RecordSurfaceEvent(c, e)`; the
   core overwrites `Surface`, `IP`, `UserAgent`, `RequestID` and (when
   authenticated) `ActorID`, so a module cannot attribute an event to another
   surface or actor.
7. Redaction is key-based (token, secret, password, authorization, cookie,
   verifier, credential, session, csrf, exact `code`/`state`/`nonce`, …) plus
   value-based masking of JWTs and `Bearer`/`Basic` credentials. Modules
   should not use those key names for non-secret data.

## Compatibility

Adding a struct field is a v1.6.0 public API change. Construction by field
name stays source compatible; positional construction of `Runtime` is not
supported.
