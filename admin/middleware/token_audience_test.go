package middleware

import (
	"testing"

	jwt "github.com/appleboy/gin-jwt/v2"

	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
)

func withAudienceConfig(t *testing.T, issuer string, strict bool, key string) {
	t.Helper()
	previous := config.Cfg.Auth
	config.Cfg.Auth.Issuer = issuer
	config.Cfg.Auth.RequireAdminAudience = strict
	config.Cfg.Auth.Key = key
	t.Cleanup(func() { config.Cfg.Auth = previous })
}

func TestAdminTokenAudienceAcceptedMatrix(t *testing.T) {
	withAudienceConfig(t, "", false, "k")
	cases := []struct {
		name   string
		claims jwt.MapClaims
		compat bool
		strict bool
	}{
		{"admin aud and iss", jwt.MapClaims{"aud": "admin", "iss": DefaultAdminIssuer}, true, true},
		{"admin aud no iss", jwt.MapClaims{"aud": "admin"}, true, true},
		{"admin in array", jwt.MapClaims{"aud": []any{"portal", "admin"}}, true, true},
		{"legacy no aud", jwt.MapClaims{"uid": "u"}, true, false},
		{"empty aud array", jwt.MapClaims{"aud": []any{}}, true, false},
		{"portal", jwt.MapClaims{"aud": "portal"}, false, false},
		{"user", jwt.MapClaims{"aud": "user"}, false, false},
		{"case differs", jwt.MapClaims{"aud": "Admin"}, false, false},
		{"prefix", jwt.MapClaims{"aud": "admin2"}, false, false},
		{"non-string aud", jwt.MapClaims{"aud": 7}, false, false},
		{"mixed array", jwt.MapClaims{"aud": []any{"admin", 7}}, false, false},
		{"foreign iss", jwt.MapClaims{"aud": "admin", "iss": "mss-portal"}, false, false},
		{"non-string iss", jwt.MapClaims{"aud": "admin", "iss": 1}, false, false},
		{"legacy with foreign iss", jwt.MapClaims{"iss": "other"}, false, false},
	}
	for _, tc := range cases {
		config.Cfg.Auth.RequireAdminAudience = false
		if got := AdminTokenAudienceAccepted(tc.claims); got != tc.compat {
			t.Errorf("%s compat = %v want %v", tc.name, got, tc.compat)
		}
		config.Cfg.Auth.RequireAdminAudience = true
		if got := AdminTokenAudienceAccepted(tc.claims); got != tc.strict {
			t.Errorf("%s strict = %v want %v", tc.name, got, tc.strict)
		}
	}
}

func TestConfiguredIssuerIsEnforced(t *testing.T) {
	withAudienceConfig(t, "https://admin.example", false, "k")
	if !AdminTokenAudienceAccepted(jwt.MapClaims{"aud": "admin", "iss": "https://admin.example"}) {
		t.Fatal("configured issuer rejected")
	}
	if AdminTokenAudienceAccepted(jwt.MapClaims{"aud": "admin", "iss": DefaultAdminIssuer}) {
		t.Fatal("default issuer accepted after override")
	}
}

func TestPrincipalClaimsCarryIssuerAndAdminAudience(t *testing.T) {
	withAudienceConfig(t, "", false, "k")
	user := &models.User{}
	user.ID = "user-1"
	claims := principalClaims(user)
	if claims["aud"] != AdminAudience || claims["iss"] != DefaultAdminIssuer {
		t.Fatalf("claims = %#v", claims)
	}
	if !AdminTokenAudienceAccepted(claims) {
		t.Fatal("freshly issued claims must be accepted in strict mode too")
	}
}

func TestSharesAdminSigningKeyIsBoolean(t *testing.T) {
	withAudienceConfig(t, "", false, "admin-signing-key")
	if !SharesAdminSigningKey([]byte("admin-signing-key")) {
		t.Fatal("same key not detected")
	}
	for _, key := range [][]byte{nil, {}, []byte("admin-signing-ke"), []byte("other")} {
		if SharesAdminSigningKey(key) {
			t.Fatalf("key %q reported as shared", key)
		}
	}
	config.Cfg.Auth.Key = ""
	if SharesAdminSigningKey([]byte("")) {
		t.Fatal("empty admin key must never match")
	}
}
