package business

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
	"github.com/mss-boot-sys/mss-boot-admin/admin/pkg/browsersecurity"
)

// SurfaceCSRF configures core double-submit CSRF for a surface whose browser
// session lives in a cookie. The token is HMAC-bound to the surface name and
// the session cookie value, so a token minted for another session, another
// surface or Admin never validates.
type SurfaceCSRF struct {
	// SessionCookie is the module's session cookie name. Requests that carry
	// it must present a valid CSRF token on unsafe methods.
	SessionCookie string
	// Key signs tokens. At least 32 bytes; must not be the Admin auth key.
	Key []byte
}

const (
	surfaceCSRFVersion    = "s1"
	surfaceCSRFNonceBytes = 32
	// SurfaceCSRFHeader carries the readable token on unsafe requests.
	SurfaceCSRFHeader = "X-MSS-CSRF-Token"
	surfaceCSRFKey    = "mss.surface.csrf"
)

var cookieNamePattern = regexp.MustCompile(`^[A-Za-z0-9!#$%&'*+.^_|~-]{1,64}$`)

// SurfaceCSRFCookieName is derived from the surface and never equals the Admin
// CSRF cookie. The __Host- prefix forces Secure, Path=/ and no Domain.
func SurfaceCSRFCookieName(surface string) string {
	return "__Host-mss-" + surface + "-csrf"
}

var errSurfaceCSRFAdminKey = errors.New("CSRF key must not be the Admin auth key")

// surfaceCSRFKeyIsAdminKey compares in constant time and never exposes either
// key. It is checked at registration and again when surfaces are mounted, so
// a configuration loaded after registration is still covered.
func surfaceCSRFKeyIsAdminKey(key []byte) bool {
	adminKey := []byte(config.Cfg.Auth.Key)
	if len(key) == 0 || len(adminKey) == 0 {
		return false
	}
	return subtle.ConstantTimeCompare(key, adminKey) == 1
}

func validateSurfaceCSRF(options SurfaceCSRF) error {
	if !cookieNamePattern.MatchString(options.SessionCookie) {
		return errors.New("CSRF session cookie name is invalid")
	}
	if len(options.Key) < 32 {
		return errors.New("CSRF key must be at least 32 bytes")
	}
	if surfaceCSRFKeyIsAdminKey(options.Key) {
		return errSurfaceCSRFAdminKey
	}
	return nil
}

type surfaceCSRFScope struct {
	surface string
	options SurfaceCSRF
}

func surfaceCSRFSignature(surface, nonce, session string, key []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(surfaceCSRFVersion + "\x00" + surface + "\x00" + nonce + "\x00" + session))
	return mac.Sum(nil)
}

func issueSurfaceCSRFToken(surface, session string, key []byte) (string, error) {
	if session == "" || len(key) == 0 {
		return "", errors.New("csrf binding material is missing")
	}
	nonce := make([]byte, surfaceCSRFNonceBytes)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(nonce)
	signature := surfaceCSRFSignature(surface, encoded, session, key)
	return surfaceCSRFVersion + "." + encoded + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func validSurfaceCSRFToken(value, surface, session string, key []byte) bool {
	parts := strings.Split(value, ".")
	if len(parts) != 3 || parts[0] != surfaceCSRFVersion || session == "" {
		return false
	}
	nonce, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || len(nonce) != surfaceCSRFNonceBytes {
		return false
	}
	provided, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(provided) != sha256.Size {
		return false
	}
	return subtle.ConstantTimeCompare(provided, surfaceCSRFSignature(surface, parts[1], session, key)) == 1
}

// ErrSurfaceCSRFDisabled is returned when the current request's surface did
// not opt into double-submit CSRF.
var ErrSurfaceCSRFDisabled = errors.New("surface did not enable CSRF tokens")

// SetSurfaceCSRFCookie issues a CSRF token bound to session (the value the
// module just wrote to its session cookie) and sets the readable
// __Host- cookie. Call it from the sign-in or session-refresh handler.
// It returns the token so the module may also return it in the body.
func SetSurfaceCSRFCookie(c *gin.Context, session string, expiresAt time.Time) (string, error) {
	value, ok := c.Get(surfaceCSRFKey)
	if !ok {
		return "", ErrSurfaceCSRFDisabled
	}
	scope := value.(surfaceCSRFScope)
	token, err := issueSurfaceCSRFToken(scope.surface, session, scope.options.Key)
	if err != nil {
		return "", err
	}
	maxAge := int(time.Until(expiresAt).Seconds())
	if maxAge < 1 {
		return "", errors.New("CSRF cookie expiry must be in the future")
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     SurfaceCSRFCookieName(scope.surface),
		Value:    token,
		Path:     "/",
		MaxAge:   maxAge,
		Expires:  expiresAt,
		Secure:   true,
		HttpOnly: false,
		SameSite: http.SameSiteLaxMode,
	})
	return token, nil
}

// surfaceCSRFCheck rejects unsafe browser requests unless they carry an exact
// trusted Origin. What is exempt and what needs a double-submit token is
// decided by the credential the core chain actually verified, never by the
// shape of request headers or by which cookies happen to be present:
//
//   - bearer-authenticated: not subject to browser CSRF;
//   - cookie-authenticated: trusted Origin required and, when the surface
//     opted into CSRF tokens, the session cookie must be present (missing or
//     empty -> 403) and the header token must equal the cookie token and be
//     HMAC-bound to that session and surface;
//   - public route (no principal): a request without cookies and without
//     Origin carries no ambient credential and passes; otherwise a trusted
//     Origin is required, plus a valid token if the session cookie is sent.
func surfaceCSRFCheck(surface SurfaceRegistration) gin.HandlerFunc {
	origins := surface.CORS.AllowOrigins
	return func(c *gin.Context) {
		if !surfaceUnsafeMethod(c.Request.Method) {
			c.Next()
			return
		}
		origin := c.GetHeader("Origin")
		principal, authenticated := SurfacePrincipalFrom(c)
		if authenticated && principal.Credential == SurfaceCredentialBearer {
			c.Next()
			return
		}
		if !authenticated && origin == "" && len(c.Request.Cookies()) == 0 {
			c.Next()
			return
		}
		if !browsersecurity.IsTrustedOrigin(origin, "", origins) {
			abortSurface(c, http.StatusForbidden, "csrf validation failed")
			return
		}
		if surface.CSRF != nil {
			session, err := c.Cookie(surface.CSRF.SessionCookie)
			sessionPresent := err == nil && session != ""
			cookieAuthenticated := authenticated && principal.Credential == SurfaceCredentialCookie
			if cookieAuthenticated && !sessionPresent {
				// Authenticated by a cookie, but not by the declared session
				// cookie: the token cannot be bound, so fail closed.
				abortSurface(c, http.StatusForbidden, "csrf validation failed")
				return
			}
			if sessionPresent && !surfaceCSRFTokenAccepted(c, surface, session) {
				abortSurface(c, http.StatusForbidden, "csrf validation failed")
				return
			}
		}
		c.Next()
	}
}

func surfaceCSRFTokenAccepted(c *gin.Context, surface SurfaceRegistration, session string) bool {
	cookieToken, _ := c.Cookie(SurfaceCSRFCookieName(surface.Name))
	headerToken := strings.TrimSpace(c.GetHeader(SurfaceCSRFHeader))
	if cookieToken == "" || headerToken == "" ||
		subtle.ConstantTimeCompare([]byte(cookieToken), []byte(headerToken)) != 1 {
		return false
	}
	return validSurfaceCSRFToken(headerToken, surface.Name, session, surface.CSRF.Key)
}
