// Package audit is the write-side audit API for business modules and
// surfaces. Modules record events through Sink; the core owns storage and
// redaction, so modules never write audit evidence of their own.
package audit

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
)

// Event is one audit record. Detail is free-form context and always passes the
// core redactor before it reaches any Sink implementation.
type Event struct {
	Surface   string
	Action    string
	Resource  string
	Result    string
	ActorKind string
	ActorID   string
	RequestID string
	IP        string
	UserAgent string
	At        time.Time
	Detail    map[string]string
}

// Sink persists audit events.
type Sink interface {
	Record(ctx context.Context, e Event) error
}

// SinkFunc adapts a function to Sink.
type SinkFunc func(context.Context, Event) error

// Record implements Sink.
func (f SinkFunc) Record(ctx context.Context, e Event) error { return f(ctx, e) }

// Redacted is the placeholder written instead of a sensitive value.
const Redacted = "[REDACTED]"

// sensitiveKeyParts match (case-insensitively, ignoring - and _) any Detail key
// that may carry a credential: tokens, refresh tokens, OAuth code/state, PKCE
// verifiers, cookies, Authorization headers, passwords and secrets.
var sensitiveKeyParts = []string{
	"token", "secret", "password", "passwd", "authorization", "cookie",
	"verifier", "credential", "apikey", "session", "csrf", "privatekey",
	"assertion", "otp", "signature",
}

// sensitiveExactKeys are OAuth parameters that are too short to match by
// substring without false positives.
var sensitiveExactKeys = map[string]struct{}{
	"code": {}, "state": {}, "oauthcode": {}, "authcode": {}, "nonce": {},
}

var (
	jwtPattern    = regexp.MustCompile(`eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*`)
	schemePattern = regexp.MustCompile(`(?i)\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}`)
)

func normalizeKey(key string) string {
	key = strings.ToLower(key)
	return strings.NewReplacer("-", "", "_", "", ".", "", " ", "").Replace(key)
}

// SensitiveKey reports whether a Detail key must never be persisted verbatim.
func SensitiveKey(key string) bool {
	normalized := normalizeKey(key)
	if _, ok := sensitiveExactKeys[normalized]; ok {
		return true
	}
	for _, part := range sensitiveKeyParts {
		if strings.Contains(normalized, part) {
			return true
		}
	}
	return false
}

// RedactValue masks credential-shaped substrings (JWTs and Authorization
// scheme values) inside an otherwise non-sensitive value.
func RedactValue(value string) string {
	value = jwtPattern.ReplaceAllString(value, Redacted)
	return schemePattern.ReplaceAllString(value, Redacted)
}

// Redact returns a copy of e that is safe to persist. It never mutates e.
func Redact(e Event) Event {
	out := e
	for _, field := range []*string{&out.Action, &out.Resource, &out.Result, &out.UserAgent} {
		*field = RedactValue(*field)
	}
	if e.Detail != nil {
		out.Detail = make(map[string]string, len(e.Detail))
		for key, value := range e.Detail {
			if SensitiveKey(key) {
				out.Detail[key] = Redacted
				continue
			}
			out.Detail[key] = RedactValue(value)
		}
	}
	if out.At.IsZero() {
		out.At = time.Now()
	}
	return out
}

// ErrInvalidEvent is returned for events missing required fields.
var ErrInvalidEvent = errors.New("audit event requires action and result")

// Redacting wraps next so every event is validated and redacted before it is
// handed to next. The core always installs this wrapper; it is idempotent.
func Redacting(next Sink) Sink {
	if next == nil {
		next = Discard
	}
	if already, ok := next.(redactingSink); ok {
		return already
	}
	return redactingSink{next: next}
}

type redactingSink struct{ next Sink }

func (s redactingSink) Record(ctx context.Context, e Event) error {
	if strings.TrimSpace(e.Action) == "" || strings.TrimSpace(e.Result) == "" {
		return ErrInvalidEvent
	}
	if ctx == nil {
		ctx = context.Background()
	}
	return s.next.Record(ctx, Redact(e))
}

// Discard drops events. It is used only when a host supplies no sink.
var Discard Sink = SinkFunc(func(context.Context, Event) error { return nil })
