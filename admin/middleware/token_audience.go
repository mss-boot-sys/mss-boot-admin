package middleware

import (
	"crypto/subtle"
	"strings"

	jwt "github.com/appleboy/gin-jwt/v2"

	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
)

// AdminAudience is the JWT "aud" carried by every Admin-issued token
// (browser session and PAT). Tokens for other surfaces (portal, user) must use
// a different audience and are rejected by Admin APIs.
const AdminAudience = "admin"

// DefaultAdminIssuer is used when auth.issuer is not configured.
const DefaultAdminIssuer = "mss-boot-admin"

// AdminIssuer returns the configured Admin token issuer.
func AdminIssuer() string {
	if issuer := strings.TrimSpace(config.Cfg.Auth.Issuer); issuer != "" {
		return issuer
	}
	return DefaultAdminIssuer
}

func stampAdminTokenClaims(claims jwt.MapClaims) jwt.MapClaims {
	if claims == nil {
		claims = jwt.MapClaims{}
	}
	claims["iss"] = AdminIssuer()
	claims["aud"] = AdminAudience
	return claims
}

func constantTimeStringEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// claimAudiences normalizes the RFC 7519 "aud" claim (string or array).
func claimAudiences(value any) ([]string, bool) {
	switch typed := value.(type) {
	case nil:
		return nil, true
	case string:
		return []string{typed}, true
	case []string:
		return typed, true
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			text, ok := item.(string)
			if !ok {
				return nil, false
			}
			out = append(out, text)
		}
		return out, true
	default:
		return nil, false
	}
}

// AdminTokenAudienceAccepted reports whether claims may authenticate an Admin
// API request. Only a boolean is returned; comparisons are constant-time.
//
//   - aud present: it must contain exactly "admin"; any other (foreign)
//     audience is rejected, whatever key signed it.
//   - iss present: it must equal the Admin issuer.
//   - aud absent (tokens issued before v1.5.0): accepted only while
//     auth.requireAdminAudience is false (compatibility mode, the default).
func AdminTokenAudienceAccepted(claims jwt.MapClaims) bool {
	rawAud, hasAud := claims["aud"]
	audiences, ok := claimAudiences(rawAud)
	if !ok {
		return false
	}
	if rawIss, hasIss := claims["iss"]; hasIss {
		issuer, isString := rawIss.(string)
		if !isString || !constantTimeStringEqual(issuer, AdminIssuer()) {
			return false
		}
	}
	if !hasAud || len(audiences) == 0 {
		return !config.Cfg.Auth.RequireAdminAudience
	}
	matched := 0
	for _, audience := range audiences {
		matched |= subtle.ConstantTimeCompare([]byte(audience), []byte(AdminAudience))
	}
	return matched == 1
}

// SharesAdminSigningKey reports, in constant time, whether key equals the
// Admin signing key. Surfaces use it to refuse sharing the Admin key without
// ever exposing a key fingerprint.
func SharesAdminSigningKey(key []byte) bool {
	adminKey := []byte(config.Cfg.Auth.Key)
	if len(key) == 0 || len(adminKey) == 0 {
		return false
	}
	return subtle.ConstantTimeCompare(key, adminKey) == 1
}
