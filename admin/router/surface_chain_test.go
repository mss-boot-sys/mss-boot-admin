package router

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	jwt "github.com/appleboy/gin-jwt/v2"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/mss-boot-sys/mss-boot-admin/admin/business"
	"github.com/mss-boot-sys/mss-boot-admin/admin/business/audit"
	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
	"github.com/mss-boot-sys/mss-boot-admin/admin/middleware"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/migration"
)

// v1.6.0 E1 acceptance for the core-enforced surface security chain.

type surfaceTestRecord struct{}

type surfaceTestModule struct {
	name     string
	id       migration.MigrationID
	surfaces []business.SurfaceRegistration
}

func (m surfaceTestModule) Name() string { return m.name }

func (m surfaceTestModule) Register(registry *business.Registry) error {
	return registry.Register(business.Registration{
		Descriptor: business.Descriptor{Name: m.name, DisplayName: strings.ToUpper(m.name), Model: new(surfaceTestRecord)},
		Migrations: func(runner *migration.Migration) error {
			return runner.Register(m.id, func(*gorm.DB, string) error { return nil })
		},
		Readiness: func(context.Context, *gorm.DB) error { return nil },
		Routes:    func(*gin.RouterGroup, business.Runtime) error { return nil },
		Surfaces:  m.surfaces,
	})
}

const surfaceTestIssuer = "example-portal"

// headerAuthenticator lets the test choose the principal the module reports.
// The module is deliberately permissive: the core must still reject.
var headerAuthenticator = business.SurfaceAuthenticatorFunc(func(c *gin.Context) (business.SurfacePrincipal, error) {
	switch c.GetHeader("X-Test-Principal") {
	case "portal":
		return business.SurfacePrincipal{Subject: "c1", Issuer: surfaceTestIssuer, Audience: []string{"portal"}}, nil
	case "admin":
		return business.SurfacePrincipal{Subject: "u1", Issuer: "mss-boot-admin", Audience: []string{"admin"}}, nil
	case "multi":
		return business.SurfacePrincipal{Subject: "c1", Issuer: surfaceTestIssuer, Audience: []string{"portal", "admin"}}, nil
	case "wrong-iss":
		return business.SurfacePrincipal{Subject: "c1", Issuer: "mss-boot-admin", Audience: []string{"portal"}}, nil
	case "no-subject":
		return business.SurfacePrincipal{Issuer: surfaceTestIssuer, Audience: []string{"portal"}}, nil
	case "writes":
		c.String(http.StatusOK, "module decided")
		return business.SurfacePrincipal{Subject: "c1", Issuer: surfaceTestIssuer, Audience: []string{"portal"}}, nil
	}
	return business.SurfacePrincipal{}, errors.New("no credential")
})

func portalSurface(hits *[]string) business.SurfaceRegistration {
	record := func(tag string) gin.HandlerFunc {
		return func(c *gin.Context) { *hits = append(*hits, tag); c.Status(http.StatusOK) }
	}
	return business.SurfaceRegistration{
		Name:          "portal",
		Issuer:        surfaceTestIssuer,
		Authenticator: headerAuthenticator,
		CORS:          business.SurfaceCORS{AllowOrigins: []string{"https://shop.example.com"}},
		Middleware:    []gin.HandlerFunc{func(c *gin.Context) { *hits = append(*hits, "mw"); c.Next() }},
		Routes: []business.SurfaceRoute{
			{Method: http.MethodGet, Path: "/me", Category: business.SurfaceRouteAuthenticated, Handlers: []gin.HandlerFunc{record("me")}},
			{Method: http.MethodPost, Path: "/orders", Category: business.SurfaceRouteAuthenticated, Handlers: []gin.HandlerFunc{record("orders")}},
			{Method: http.MethodPost, Path: "/sign-in", Category: business.SurfaceRoutePublic, Handlers: []gin.HandlerFunc{record("sign-in")}},
		},
	}
}

func composeSurfaceRegistry(t *testing.T, surfaces ...business.SurfaceRegistration) *business.Registry {
	t.Helper()
	registry, err := business.Compose(migration.New(), surfaceTestModule{name: "shop", id: "202610140001", surfaces: surfaces})
	require.NoError(t, err)
	return registry
}

func restoreSurfaceEnforcement(t *testing.T) {
	previous := config.Cfg.Auth.RequireAdminAudience
	t.Cleanup(func() { config.Cfg.Auth.RequireAdminAudience = previous })
	config.Cfg.Auth.RequireAdminAudience = false
}

// 1. No surface registered: Admin route table equals the frozen baseline and
// audience compatibility mode is untouched.
func TestNoSurfaceKeepsAdminBaselineAndAudienceBehaviour(t *testing.T) {
	restoreSurfaceEnforcement(t)
	previousMode := config.Cfg.Application.Mode
	t.Cleanup(func() { config.Cfg.Application.Mode = previousMode })
	gin.SetMode(gin.TestMode)
	config.Cfg.Application.Mode = config.ModeProd

	registry := composeSurfaceRegistry(t)
	engine := gin.New()
	InitRouter(engine.Group("/admin"))
	mounted, err := registry.MountSurfaces(engine, nil)
	require.NoError(t, err)
	require.Zero(t, mounted)
	require.Empty(t, registry.Surfaces())
	require.False(t, config.Cfg.Auth.RequireAdminAudience)

	lines := []string{}
	for _, route := range engine.Routes() {
		lines = append(lines, route.Method+" "+route.Path)
	}
	sort.Strings(lines)
	golden, err := os.ReadFile(filepath.Join("testdata", "baseline", "routes-prod.txt"))
	require.NoError(t, err)
	require.Equal(t, string(golden), strings.Join(lines, "\n")+"\n")

	// Compatibility mode still accepts a pre-v1.5.0 token without aud.
	config.Cfg.Auth.RequireAdminAudience = false
	require.True(t, middleware.AdminTokenAudienceAccepted(jwt.MapClaims{"uid": "u1"}))
}

// 2. Surface tokens never reach Admin routes, and mounting a surface forces
// strict Admin audience even when auth.requireAdminAudience is false.
func TestSurfaceTokensNeverReachAdminRoutes(t *testing.T) {
	restoreSurfaceEnforcement(t)
	engine := newAudienceAcceptanceEngine(t, false)
	var hits []string
	registry := composeSurfaceRegistry(t, portalSurface(&hits))
	mounted, err := registry.MountSurfaces(engine, nil)
	require.NoError(t, err)
	require.Equal(t, 1, mounted)
	// Mirrors server.mountBusinessSurfaces (tested in internal/cmd/server).
	config.Cfg.Auth.RequireAdminAudience = true

	tokens := map[string]jwt.MapClaims{
		"surface aud=portal":         {"aud": "portal", "iss": surfaceTestIssuer},
		"surface aud=[portal]":       {"aud": []any{"portal"}, "iss": surfaceTestIssuer},
		"surface aud, admin iss":     {"aud": "portal", "iss": "mss-boot-admin"},
		"legacy no aud (now strict)": {},
	}
	routes := nonPublicBaselineRoutes(t)
	require.NotEmpty(t, routes)
	for name, claims := range tokens {
		token := signAudienceTestToken(t, claims)
		for _, route := range routes {
			requireRejected(t, name, route, callWithBearer(engine, route, token))
		}
	}
	require.Empty(t, hits, "no surface handler may run for Admin requests")
}

func serveSurface(engine *gin.Engine, method, path string, headers map[string]string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader("{}"))
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	return recorder
}

// 3. A module cannot bypass the chain: the core enforces aud/iss whatever the
// authenticator reports, CSRF and CORS stay on, module middleware only runs
// after authentication, and registration rejects unsafe declarations.
func TestModuleCannotBypassSurfaceChain(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var hits []string
	registry := composeSurfaceRegistry(t, portalSurface(&hits))
	engine := gin.New()
	_, err := registry.MountSurfaces(engine, nil)
	require.NoError(t, err)

	for _, principal := range []string{"", "admin", "multi", "wrong-iss", "no-subject"} {
		hits = nil
		res := serveSurface(engine, http.MethodGet, "/portal/api/me", map[string]string{"X-Test-Principal": principal})
		require.Equal(t, http.StatusUnauthorized, res.Code, "principal %q", principal)
		require.Empty(t, hits, "module middleware/handler ran for rejected principal %q", principal)
	}

	hits = nil
	res := serveSurface(engine, http.MethodGet, "/portal/api/me", map[string]string{"X-Test-Principal": "writes"})
	require.Equal(t, "module decided", res.Body.String())
	require.Empty(t, hits, "an authenticator that writes a response must abort the chain")

	hits = nil
	res = serveSurface(engine, http.MethodGet, "/portal/api/me", map[string]string{"X-Test-Principal": "portal"})
	require.Equal(t, http.StatusOK, res.Code)
	require.Equal(t, []string{"mw", "me"}, hits)

	// CSRF: unsafe cookie-authenticated requests need the exact surface origin.
	cookie := map[string]string{"X-Test-Principal": "portal", "Cookie": "portal_session=x"}
	hits = nil
	require.Equal(t, http.StatusForbidden, serveSurface(engine, http.MethodPost, "/portal/api/orders", cookie).Code)
	cookie["Origin"] = "https://evil.example.net"
	require.Equal(t, http.StatusForbidden, serveSurface(engine, http.MethodPost, "/portal/api/orders", cookie).Code)
	require.Equal(t, http.StatusForbidden, serveSurface(engine, http.MethodPost, "/portal/api/sign-in", map[string]string{"Cookie": "a=b"}).Code,
		"public routes still pass CSRF")
	require.Empty(t, hits)
	cookie["Origin"] = "https://shop.example.com"
	require.Equal(t, http.StatusOK, serveSurface(engine, http.MethodPost, "/portal/api/orders", cookie).Code)

	// Public route skips authentication only because it was declared public.
	require.Equal(t, http.StatusOK, serveSurface(engine, http.MethodPost, "/portal/api/sign-in",
		map[string]string{"Authorization": "Bearer anything"}).Code)

	// CORS is per surface and default-deny for other origins.
	preflight := map[string]string{"Origin": "https://evil.example.net", "Access-Control-Request-Method": "POST"}
	require.Empty(t, serveSurface(engine, http.MethodOptions, "/portal/api/orders", preflight).Header().Get("Access-Control-Allow-Origin"))
	preflight["Origin"] = "https://shop.example.com"
	require.Equal(t, "https://shop.example.com",
		serveSurface(engine, http.MethodOptions, "/portal/api/orders", preflight).Header().Get("Access-Control-Allow-Origin"))

	// Undeclared paths do not exist on the surface.
	require.Equal(t, http.StatusNotFound, serveSurface(engine, http.MethodGet, "/portal/api/undeclared", nil).Code)
}

func TestSurfaceRegistrationRejectsUnsafeDeclarations(t *testing.T) {
	base := func() business.SurfaceRegistration { var hits []string; return portalSurface(&hits) }
	cases := map[string]func(*business.SurfaceRegistration){
		"reserved admin":   func(s *business.SurfaceRegistration) { s.Name = "admin" },
		"reserved api":     func(s *business.SurfaceRegistration) { s.Name = "api" },
		"invalid name":     func(s *business.SurfaceRegistration) { s.Name = "Portal/x" },
		"no authenticator": func(s *business.SurfaceRegistration) { s.Authenticator = nil },
		"no issuer":        func(s *business.SurfaceRegistration) { s.Issuer = " " },
		"wildcard origin":  func(s *business.SurfaceRegistration) { s.CORS.AllowOrigins = []string{"*"} },
		"unknown category": func(s *business.SurfaceRegistration) { s.Routes[0].Category = "internal" },
		"empty category":   func(s *business.SurfaceRegistration) { s.Routes[0].Category = "" },
		"traversal path":   func(s *business.SurfaceRegistration) { s.Routes[0].Path = "/../../admin/api/users" },
		"nil middleware":   func(s *business.SurfaceRegistration) { s.Middleware = append(s.Middleware, nil) },
		"no routes":        func(s *business.SurfaceRegistration) { s.Routes = nil },
	}
	for name, mutate := range cases {
		surface := base()
		mutate(&surface)
		_, err := business.Compose(migration.New(), surfaceTestModule{name: "shop", id: "202610140001", surfaces: []business.SurfaceRegistration{surface}})
		require.Error(t, err, name)
	}

	_, err := business.Compose(migration.New(),
		surfaceTestModule{name: "shop", id: "202610140001", surfaces: []business.SurfaceRegistration{base()}},
		surfaceTestModule{name: "other", id: "202610140002", surfaces: []business.SurfaceRegistration{base()}},
	)
	require.ErrorContains(t, err, "already registered")
}

func TestSurfaceAuditEventsAreScopedAndRedactedByCore(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var recorded []audit.Event
	sink := audit.SinkFunc(func(_ context.Context, e audit.Event) error { recorded = append(recorded, e); return nil })
	surface := business.SurfaceRegistration{
		Name: "portal", Issuer: surfaceTestIssuer, Authenticator: headerAuthenticator,
		Routes: []business.SurfaceRoute{{Method: http.MethodGet, Path: "/me", Category: business.SurfaceRouteAuthenticated,
			Handlers: []gin.HandlerFunc{func(c *gin.Context) {
				err := business.RecordSurfaceEvent(c, audit.Event{
					Surface: "admin", ActorID: "spoofed", Action: "profile.view", Result: "success",
					Detail: map[string]string{"access_token": "at-leak-value"},
				})
				if err != nil {
					c.Status(http.StatusInternalServerError)
					return
				}
				c.Status(http.StatusOK)
			}}}},
	}
	registry := composeSurfaceRegistry(t, surface)
	engine := gin.New()
	_, err := registry.MountSurfaces(engine, sink)
	require.NoError(t, err)
	res := serveSurface(engine, http.MethodGet, "/portal/api/me", map[string]string{"X-Test-Principal": "portal"})
	require.Equal(t, http.StatusOK, res.Code)
	require.Len(t, recorded, 1)
	require.Equal(t, "portal", recorded[0].Surface)
	require.Equal(t, "c1", recorded[0].ActorID)
	require.Equal(t, audit.Redacted, recorded[0].Detail["access_token"])

	outside, _ := gin.CreateTestContext(httptest.NewRecorder())
	require.ErrorIs(t, business.RecordSurfaceEvent(outside, audit.Event{Action: "a", Result: "b"}), business.ErrNoSurfaceAudit)
}

func TestSurfaceDoubleSubmitCSRFForCookieSessions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	key := []byte("portal-csrf-key-0123456789abcdef-0123")
	var issued string
	surface := business.SurfaceRegistration{
		Name: "portal", Issuer: surfaceTestIssuer, Authenticator: headerAuthenticator,
		CORS: business.SurfaceCORS{AllowOrigins: []string{"https://shop.example.com"}},
		CSRF: &business.SurfaceCSRF{SessionCookie: "__Host-portal-session", Key: key},
		Routes: []business.SurfaceRoute{
			{Method: http.MethodPost, Path: "/sign-in", Category: business.SurfaceRoutePublic, Handlers: []gin.HandlerFunc{func(c *gin.Context) {
				token, err := business.SetSurfaceCSRFCookie(c, c.GetHeader("X-Session"), time.Now().Add(time.Hour))
				if err != nil {
					c.Status(http.StatusInternalServerError)
					return
				}
				issued = token
				c.Status(http.StatusOK)
			}}},
			{Method: http.MethodPost, Path: "/orders", Category: business.SurfaceRouteAuthenticated, Handlers: []gin.HandlerFunc{func(c *gin.Context) { c.Status(http.StatusOK) }}},
		},
	}
	registry := composeSurfaceRegistry(t, surface)
	engine := gin.New()
	_, err := registry.MountSurfaces(engine, nil)
	require.NoError(t, err)

	origin := "https://shop.example.com"
	res := serveSurface(engine, http.MethodPost, "/portal/api/sign-in", map[string]string{"Origin": origin, "X-Session": "session-A"})
	require.Equal(t, http.StatusOK, res.Code)
	cookie := res.Result().Cookies()[0]
	require.Equal(t, business.SurfaceCSRFCookieName("portal"), cookie.Name)
	require.True(t, cookie.Secure)
	require.False(t, cookie.HttpOnly)
	require.Equal(t, "/", cookie.Path)
	require.Equal(t, issued, cookie.Value)

	post := func(session, cookieToken, header string) int {
		headers := map[string]string{"Origin": origin, "X-Test-Principal": "portal",
			"Cookie": "__Host-portal-session=" + session}
		if cookieToken != "" {
			headers["Cookie"] += "; " + business.SurfaceCSRFCookieName("portal") + "=" + cookieToken
		}
		if header != "" {
			headers[business.SurfaceCSRFHeader] = header
		}
		return serveSurface(engine, http.MethodPost, "/portal/api/orders", headers).Code
	}
	require.Equal(t, http.StatusOK, post("session-A", issued, issued))
	require.Equal(t, http.StatusForbidden, post("session-A", issued, ""), "missing header")
	require.Equal(t, http.StatusForbidden, post("session-A", "", issued), "missing cookie")
	require.Equal(t, http.StatusForbidden, post("session-A", issued, issued+"x"), "header != cookie")
	require.Equal(t, http.StatusForbidden, post("session-B", issued, issued), "token bound to another session")
	forged := "s1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	require.Equal(t, http.StatusForbidden, post("session-A", forged, forged), "forged token")

	// A token for the same session minted for another surface does not validate.
	portalToken := issued
	other := surface
	other.Name = "shop"
	otherRegistry, err := business.Compose(migration.New(), surfaceTestModule{name: "other", id: "202610140009", surfaces: []business.SurfaceRegistration{other}})
	require.NoError(t, err)
	otherEngine := gin.New()
	_, err = otherRegistry.MountSurfaces(otherEngine, nil)
	require.NoError(t, err)
	res = serveSurface(otherEngine, http.MethodPost, "/shop/api/sign-in", map[string]string{"Origin": origin, "X-Session": "session-A"})
	require.Equal(t, http.StatusOK, res.Code)
	shopToken := res.Result().Cookies()[0].Value
	require.NotEqual(t, portalToken, shopToken)
	require.Equal(t, http.StatusForbidden, post("session-A", shopToken, shopToken), "token minted for another surface")
}

func TestSurfaceCSRFIsOptInAndValidated(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var hits []string
	plain := portalSurface(&hits) // no CSRF option
	registry := composeSurfaceRegistry(t, plain)
	engine := gin.New()
	_, err := registry.MountSurfaces(engine, nil)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, serveSurface(engine, http.MethodPost, "/portal/api/orders", map[string]string{
		"Origin": "https://shop.example.com", "X-Test-Principal": "portal", "Cookie": "portal_session=x"}).Code,
		"without opt-in only the Origin check applies")

	for name, csrf := range map[string]*business.SurfaceCSRF{
		"short key":      {SessionCookie: "s", Key: []byte("short")},
		"bad cookie":     {SessionCookie: "bad cookie;", Key: make([]byte, 32)},
		"missing cookie": {Key: make([]byte, 32)},
	} {
		bad := portalSurface(&hits)
		bad.CSRF = csrf
		_, err := business.Compose(migration.New(), surfaceTestModule{name: "shop", id: "202610140001", surfaces: []business.SurfaceRegistration{bad}})
		require.Error(t, err, name)
	}
}
