package audit

import (
	"context"
	"strings"
	"testing"
)

const sampleJWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXZhbHVl"

// Contract (AGENTS.md audit redaction): tokens, refresh tokens, OAuth
// code/state, PKCE verifiers, cookies and Authorization headers never reach a
// Sink, whatever key casing or embedding a module uses.
func TestRedactingSinkNeverForwardsCredentials(t *testing.T) {
	var got Event
	sink := Redacting(SinkFunc(func(_ context.Context, e Event) error { got = e; return nil }))
	secrets := map[string]string{
		"access_token":      "at-123456789",
		"refreshToken":      "rt-123456789",
		"Refresh-Token":     "rt-987654321",
		"id_token":          sampleJWT,
		"code":              "oauth-code-abcdef",
		"state":             "oauth-state-abcdef",
		"code_verifier":     "pkce-verifier-abcdef",
		"Cookie":            "portal_session=abc",
		"Set-Cookie":        "portal_session=abc",
		"Authorization":     "Bearer abcdefghijkl",
		"password":          "hunter2hunter2",
		"client_secret":     "cs-abcdef",
		"X-CSRF-Token":      "csrf-abcdef",
		"personAccessToken": "pat-abcdef",
	}
	detail := map[string]string{"orderId": "o-1", "note": "header was Bearer abcdefghijklmnop and jwt " + sampleJWT}
	for k, v := range secrets {
		detail[k] = v
	}
	original := map[string]string{}
	for k, v := range detail {
		original[k] = v
	}
	err := sink.Record(context.Background(), Event{
		Surface: "portal", Action: "order.create", Result: "success",
		Resource: "orders/" + sampleJWT, UserAgent: "ua", Detail: detail,
	})
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range secrets {
		if got.Detail[k] != Redacted {
			t.Errorf("Detail[%q] = %q, want redacted", k, got.Detail[k])
		}
		for _, field := range append([]string{got.Resource, got.Action, got.UserAgent}, values(got.Detail)...) {
			if len(v) >= 8 && strings.Contains(field, v) {
				t.Errorf("secret %q leaked in %q", k, field)
			}
		}
	}
	if got.Detail["orderId"] != "o-1" {
		t.Errorf("non-sensitive detail changed: %q", got.Detail["orderId"])
	}
	if strings.Contains(got.Detail["note"], "abcdefghijklmnop") || strings.Contains(got.Detail["note"], sampleJWT) {
		t.Errorf("embedded credential leaked: %q", got.Detail["note"])
	}
	if got.At.IsZero() {
		t.Error("At must default to now")
	}
	for k, v := range original {
		if detail[k] != v {
			t.Errorf("caller's Detail mutated at %q", k)
		}
	}
}

func TestRedactingSinkRejectsIncompleteEventsAndIsIdempotent(t *testing.T) {
	calls := 0
	inner := SinkFunc(func(context.Context, Event) error { calls++; return nil })
	sink := Redacting(Redacting(inner))
	if err := sink.Record(context.Background(), Event{Action: "x"}); err != ErrInvalidEvent {
		t.Fatalf("missing result: %v", err)
	}
	if err := sink.Record(nil, Event{Action: "x", Result: "ok"}); err != nil { //nolint:staticcheck
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("calls = %d", calls)
	}
	if err := Redacting(nil).Record(context.Background(), Event{Action: "x", Result: "ok"}); err != nil {
		t.Fatal(err)
	}
}

func values(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for _, v := range m {
		out = append(out, v)
	}
	return out
}
