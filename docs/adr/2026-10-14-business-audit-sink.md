# ADR: Redacted audit sink for business modules (Runtime.Audit)

- Status: Accepted for v1.6.0 (implementation in a later v1.6.0 PR)
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

## Compatibility

Adding a struct field is a v1.6.0 public API change. Construction by field
name stays source compatible; positional construction of `Runtime` is not
supported.
