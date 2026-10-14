package router

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	jwt "github.com/appleboy/gin-jwt/v2"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	gojwt "github.com/golang-jwt/jwt/v4"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
	"github.com/mss-boot-sys/mss-boot-admin/admin/middleware"
	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/config/gormdb"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/response"
)

const audienceTestSigningKey = "token-audience-acceptance-signing-key-2026"

// Acceptance (v1.5.0 C2): tokens minted for another surface with the SAME
// signing key must not authenticate any non-public Admin route listed in the
// P1 baseline route table.
func TestForeignAudienceTokensAreRejectedOnEveryNonPublicAdminRoute(t *testing.T) {
	engine := newAudienceAcceptanceEngine(t, false)
	routes := nonPublicBaselineRoutes(t)
	require.NotEmpty(t, routes)

	foreign := map[string]jwt.MapClaims{
		"aud=portal":            {"aud": "portal", "iss": "mss-portal"},
		"aud=user":              {"aud": "user"},
		"aud=[portal,user]":     {"aud": []any{"portal", "user"}},
		"aud=admin foreign iss": {"aud": "admin", "iss": "mss-portal"},
		"aud=portal PAT":        {"aud": "portal", "personAccessToken": "pat-1", "refreshTokenDisabled": true},
	}
	for name, extra := range foreign {
		token := signAudienceTestToken(t, extra)
		for _, route := range routes {
			requireRejected(t, name, route, callWithBearer(engine, route, token))
		}
	}
}

func TestLegacyNoAudienceTokenRejectedInStrictMode(t *testing.T) {
	engine := newAudienceAcceptanceEngine(t, true)
	token := signAudienceTestToken(t, jwt.MapClaims{})
	for _, route := range nonPublicBaselineRoutes(t) {
		requireRejected(t, "legacy no-aud (strict)", route, callWithBearer(engine, route, token))
	}
}

// knownUnauthenticatedStubs are pre-existing generic action routes mounted by
// a controller with an empty base path. They run no authentication and answer
// 501 Not Implemented without touching data. They are pinned here so any
// behaviour change surfaces; removing them is tracked separately from C2.
var knownUnauthenticatedStubs = map[string]bool{
	"GET /admin/api/:id":    true,
	"PUT /admin/api/:id":    true,
	"DELETE /admin/api/:id": true,
}

func requireRejected(t *testing.T, name string, route baselineRoute, code int) {
	t.Helper()
	if knownUnauthenticatedStubs[route.String()] {
		if code != http.StatusNotImplemented {
			t.Errorf("%s token on stub %s returned %d, want pinned 501", name, route, code)
		}
		return
	}
	if code != http.StatusUnauthorized && code != http.StatusForbidden {
		t.Errorf("%s token on %s returned %d, want 401/403", name, route, code)
	}
}

type baselineRoute struct{ method, path string }

func (r baselineRoute) String() string { return r.method + " " + r.path }

func nonPublicBaselineRoutes(t *testing.T) []baselineRoute {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "baseline", "routes-prod.txt"))
	require.NoError(t, err)
	public := map[string]bool{}
	for _, contract := range CustomRouteContracts() {
		if contract.Class == RoutePublic {
			public[contract.Method+" "+contract.Path] = true
		}
	}
	var routes []baselineRoute
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		method, path, _ := strings.Cut(line, " ")
		if method == http.MethodOptions || !strings.HasPrefix(path, "/admin/api/") || public[line] {
			continue
		}
		routes = append(routes, baselineRoute{method: method, path: path})
	}
	return routes
}

func concretePath(path string) string {
	parts := strings.Split(path, "/")
	for index, part := range parts {
		if strings.HasPrefix(part, ":") || strings.HasPrefix(part, "*") {
			parts[index] = "x1"
		}
	}
	return strings.Join(parts, "/")
}

func callWithBearer(engine *gin.Engine, route baselineRoute, token string) int {
	request := httptest.NewRequest(route.method, concretePath(route.path), strings.NewReader("{}"))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	return recorder.Code
}

func signAudienceTestToken(t *testing.T, extra jwt.MapClaims) string {
	t.Helper()
	claims := gojwt.MapClaims{
		"uid":      "user-1",
		"rid":      "role-1",
		"sid":      "session-1",
		"exp":      time.Now().Add(time.Hour).Unix(),
		"orig_iat": time.Now().Unix(),
	}
	for key, value := range extra {
		claims[key] = value
	}
	signed, err := gojwt.NewWithClaims(gojwt.SigningMethodHS256, claims).SignedString([]byte(audienceTestSigningKey))
	require.NoError(t, err)
	return signed
}

func newAudienceAcceptanceEngine(t *testing.T, strict bool) *gin.Engine {
	t.Helper()
	previousGinMode := gin.Mode()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "audience.db")), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.Role{}, &models.User{}, &models.UserSession{}, &models.LoginLog{}, &models.UserAuthToken{}))
	previousHandle := gormdb.InstallDefault(&gormdb.Handle{DB: db})

	previousAuthConfig := config.Cfg.Auth
	previousMode := config.Cfg.Application.Mode
	previousAuth := middleware.Auth
	previousVerifier := middleware.Verifier
	previousAuthHandler := response.AuthHandler
	previousVerifyHandler := response.VerifyHandler
	previousAuthMiddleware, hadAuthMiddleware := middleware.Middlewares.Load("auth")
	t.Cleanup(func() {
		gin.SetMode(previousGinMode)
		gormdb.InstallDefault(previousHandle)
		config.Cfg.Auth = previousAuthConfig
		config.Cfg.Application.Mode = previousMode
		middleware.Auth = previousAuth
		middleware.Verifier = previousVerifier
		response.AuthHandler = previousAuthHandler
		response.VerifyHandler = previousVerifyHandler
		if hadAuthMiddleware {
			middleware.Middlewares.Store("auth", previousAuthMiddleware)
		} else {
			middleware.Middlewares.Delete("auth")
		}
	})
	config.Cfg.Application.Mode = config.ModeProd
	config.Cfg.Auth = config.Auth{
		Realm:                "audience-acceptance",
		Key:                  audienceTestSigningKey,
		IdentityKey:          "audience-acceptance-principal",
		Timeout:              time.Hour,
		MaxRefresh:           time.Hour,
		RequireAdminAudience: strict,
	}
	middleware.Verifier = &models.User{}
	require.NoError(t, middleware.Init())

	engine := gin.New()
	InitRouter(engine.Group("/admin"))
	return engine
}
