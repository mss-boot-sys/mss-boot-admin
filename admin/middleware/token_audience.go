package middleware

import (
	"crypto/subtle"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"

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
		if config.Cfg.Auth.RequireAdminAudience || surfacesRegistered.Load() {
			return false
		}
		recordLegacyAudienceToken(claims)
		return true
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

var surfacesRegistered atomic.Bool

// EnforceAdminAudienceForSurfaces switches Admin APIs to strict audience mode
// for the life of the process. The core calls it as soon as any non-Admin
// surface is mounted, so a token without aud can never be ambiguous between
// Admin and a surface, regardless of auth.requireAdminAudience.
func EnforceAdminAudienceForSurfaces() {
	surfacesRegistered.Store(true)
}

// SetAdminAudienceEnforcedBySurfacesForTest restores the process-wide flag.
// Production code must use EnforceAdminAudienceForSurfaces only.
func SetAdminAudienceEnforcedBySurfacesForTest(enforced bool) {
	surfacesRegistered.Store(enforced)
}

// AdminAudienceEnforcedBySurfaces reports whether a mounted surface forced
// strict Admin audience mode.
func AdminAudienceEnforcedBySurfaces() bool {
	return surfacesRegistered.Load()
}

var (
	legacySessionTokens atomic.Int64
	legacyPATokens      atomic.Int64
	legacyLastLog       atomic.Int64
)

// LegacyAudienceTokenCounts reports how many tokens without aud were accepted
// in compatibility mode since start, split into browser sessions and PATs.
// Operators use it (and the WARN log) to decide when strict mode is safe.
func LegacyAudienceTokenCounts() (sessions, personalAccessTokens int64) {
	return legacySessionTokens.Load(), legacyPATokens.Load()
}

const legacyAudienceLogInterval = time.Minute

func recordLegacyAudienceToken(claims jwt.MapClaims) {
	kind := "session"
	if pat, _ := claims["personAccessToken"].(string); pat != "" {
		kind = "pat"
		legacyPATokens.Add(1)
	} else {
		legacySessionTokens.Add(1)
	}
	now := time.Now().UnixNano()
	last := legacyLastLog.Load()
	if now-last < int64(legacyAudienceLogInterval) || !legacyLastLog.CompareAndSwap(last, now) {
		return
	}
	sessions, pats := LegacyAudienceTokenCounts()
	// Low-cardinality, rate-limited (once per minute); no token or user data.
	slog.Warn("accepted legacy admin token without aud (compatibility mode)",
		"kind", kind, "legacy_sessions_total", sessions, "legacy_pats_total", pats)
}
