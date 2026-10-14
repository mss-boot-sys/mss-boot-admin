package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/keyedlimit"
)

func resolveLoginIP(t *testing.T, remote string, headers map[string]string) string {
	t.Helper()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/login", nil)
	c.Request.RemoteAddr = remote
	for key, value := range headers {
		c.Request.Header.Set(key, value)
	}
	return LoginClientIP(c)
}

func configureLoginIPForTest(t *testing.T, cfg config.AdminLoginClientIP, fallback []string) {
	t.Helper()
	previous := loginClientIP.Load()
	t.Cleanup(func() { loginClientIP.Store(previous) })
	if err := ConfigureLoginClientIP(cfg, fallback); err != nil {
		t.Fatal(err)
	}
}

func TestLoginClientIPDefaultIgnoresForwardingHeaders(t *testing.T) {
	configureLoginIPForTest(t, config.AdminLoginClientIP{}, nil)
	got := resolveLoginIP(t, "203.0.113.9:5555", map[string]string{
		"X-Forwarded-For":  "1.2.3.4",
		"X-Real-IP":        "5.6.7.8",
		"CF-Connecting-IP": "9.9.9.9",
	})
	if got != "203.0.113.9" {
		t.Fatalf("default resolver = %q, want peer", got)
	}
}

func TestLoginClientIPIgnoresSpoofedHeaderFromUntrustedPeer(t *testing.T) {
	configureLoginIPForTest(t, config.AdminLoginClientIP{TrustedProxies: []string{"10.0.0.0/8"}}, nil)
	got := resolveLoginIP(t, "203.0.113.9:5555", map[string]string{"X-Forwarded-For": "1.2.3.4"})
	if got != "203.0.113.9" {
		t.Fatalf("untrusted peer XFF honoured: %q", got)
	}
}

func TestLoginClientIPHonoursHeadersFromTrustedPeer(t *testing.T) {
	configureLoginIPForTest(t, config.AdminLoginClientIP{TrustedProxies: []string{"10.0.0.0/8", "192.0.2.1"}}, nil)
	cases := []struct {
		name    string
		headers map[string]string
		want    string
	}{
		{"single XFF", map[string]string{"X-Forwarded-For": "198.51.100.7"}, "198.51.100.7"},
		{"rightmost untrusted wins over spoofed left", map[string]string{"X-Forwarded-For": "6.6.6.6, 198.51.100.7, 10.1.1.1"}, "198.51.100.7"},
		{"all trusted falls back to leftmost", map[string]string{"X-Forwarded-For": "10.2.2.2, 10.1.1.1"}, "10.2.2.2"},
		{"invalid hop falls back to X-Real-IP", map[string]string{"X-Forwarded-For": "not-an-ip", "X-Real-IP": "198.51.100.8"}, "198.51.100.8"},
		{"no header uses peer", nil, "10.0.0.5"},
	}
	for _, tc := range cases {
		if got := resolveLoginIP(t, "10.0.0.5:443", tc.headers); got != tc.want {
			t.Errorf("%s: got %q want %q", tc.name, got, tc.want)
		}
	}
	if got := resolveLoginIP(t, "192.0.2.1:443", map[string]string{"X-Forwarded-For": "198.51.100.9"}); got != "198.51.100.9" {
		t.Fatalf("bare-IP trusted proxy: %q", got)
	}
}

func TestLoginClientIPDedicatedHeaderOnly(t *testing.T) {
	configureLoginIPForTest(t, config.AdminLoginClientIP{TrustedProxies: []string{"10.0.0.0/8"}, Header: "cf-connecting-ip"}, nil)
	got := resolveLoginIP(t, "10.0.0.5:443", map[string]string{"CF-Connecting-IP": "198.51.100.10", "X-Forwarded-For": "6.6.6.6"})
	if got != "198.51.100.10" {
		t.Fatalf("dedicated header = %q", got)
	}
	got = resolveLoginIP(t, "10.0.0.5:443", map[string]string{"X-Forwarded-For": "6.6.6.6"})
	if got != "10.0.0.5" {
		t.Fatalf("XFF must be ignored when a dedicated header is configured: %q", got)
	}
}

func TestLoginClientIPInheritsApplicationTrustedProxies(t *testing.T) {
	configureLoginIPForTest(t, config.AdminLoginClientIP{}, []string{"10.0.0.0/8"})
	if got := resolveLoginIP(t, "10.0.0.5:443", map[string]string{"X-Forwarded-For": "198.51.100.7"}); got != "198.51.100.7" {
		t.Fatalf("inherited trusted proxies not applied: %q", got)
	}
}

func TestConfigureLoginClientIPRejectsInvalidCIDR(t *testing.T) {
	if err := ConfigureLoginClientIP(config.AdminLoginClientIP{TrustedProxies: []string{"10.0.0.0/33"}}, nil); err == nil {
		t.Fatal("invalid CIDR accepted")
	}
	if err := (config.AdminLogin{ClientIP: config.AdminLoginClientIP{TrustedProxies: []string{"proxy.local"}}}).Validate(); err == nil {
		t.Fatal("startup validation accepted invalid proxy")
	}
	if err := (config.AdminLogin{ClientIP: config.AdminLoginClientIP{Header: "Bad Header"}}).Validate(); err == nil {
		t.Fatal("startup validation accepted invalid header")
	}
}

// Clients behind one trusted proxy get separate rate-limit buckets, while a
// direct attacker cannot escape its bucket by rotating X-Forwarded-For.
func TestLoginRateLimitBucketsFollowResolvedClientIP(t *testing.T) {
	configureLoginIPForTest(t, config.AdminLoginClientIP{TrustedProxies: []string{"10.0.0.0/8"}}, nil)
	limiter, err := keyedlimit.NewMemory(keyedlimit.Config{Limit: 1, Window: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	router, _ := loginRateLimitRouter(t, limiter)
	send := func(remote, xff string) int {
		request := httptest.NewRequest(http.MethodPost, "/login", nil)
		request.RemoteAddr = remote
		if xff != "" {
			request.Header.Set("X-Forwarded-For", xff)
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		return recorder.Code
	}
	if send("10.0.0.5:443", "198.51.100.1") != http.StatusNoContent ||
		send("10.0.0.5:443", "198.51.100.2") != http.StatusNoContent {
		t.Fatal("distinct clients behind the trusted proxy must have separate buckets")
	}
	if send("10.0.0.5:443", "198.51.100.1") != http.StatusTooManyRequests {
		t.Fatal("same client behind proxy must share its bucket")
	}
	if send("203.0.113.9:1", "1.1.1.1") != http.StatusNoContent {
		t.Fatal("first direct attempt must pass")
	}
	if send("203.0.113.9:1", "2.2.2.2") != http.StatusTooManyRequests {
		t.Fatal("rotating spoofed XFF from an untrusted peer must not reset the bucket")
	}
}
