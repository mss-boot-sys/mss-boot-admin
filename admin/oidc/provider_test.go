package oidc

import (
	"bytes"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v4"
	"github.com/mss-boot-io/mss-boot-admin/admin/config"
	"github.com/mss-boot-io/mss-boot-admin/admin/middleware"
	"github.com/mss-boot-io/mss-boot-admin/admin/models"
	"github.com/mss-boot-io/mss-boot-admin/admin/pkg/sessioncache"
	"github.com/mss-boot-io/mss-boot-admin/admin/service"
	"github.com/mss-boot-io/mss-boot-admin/mss-boot/pkg/config/gormdb"
	"github.com/mss-boot-io/mss-boot-admin/mss-boot/pkg/enum"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type fixture struct {
	t                *testing.T
	db               *gorm.DB
	p                *Provider
	router           *gin.Engine
	client           models.OIDCClient
	secret, password string
	user             models.User
	cookies          []*http.Cookie
}

func setup(t *testing.T) *fixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "oidc.db")+"?_busy_timeout=5000&_journal_mode=WAL"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, db.AutoMigrate(&models.Role{}, &models.User{}, &models.UserSession{}, &models.LoginLog{}, &models.AuditLog{}, &models.OIDCClient{}, &models.OIDCSubject{}, &models.OIDCRequest{}, &models.OIDCCode{}, &models.OIDCAccessToken{}, &models.OIDCSigningKey{}, &models.OIDCKeySet{}))
	oldCfg, oldDB, oldAuth, oldVerifier, oldService := config.Cfg, gormdb.DB, middleware.Auth, middleware.Verifier, service.Session
	t.Cleanup(func() {
		config.Cfg = oldCfg
		gormdb.DB = oldDB
		middleware.Auth = oldAuth
		middleware.Verifier = oldVerifier
		service.Session = oldService
	})
	config.Cfg = &config.Config{Application: config.Application{Origin: "https://id.example.test"}, Auth: config.Auth{Realm: "admin", Key: randomSecret(), IdentityKey: "identity", Timeout: time.Hour, MaxRefresh: time.Hour, BrowserSession: config.BrowserSession{Secure: true, SameSite: "lax"}}}
	gormdb.DB = db
	middleware.Verifier = &models.User{}
	service.Session = service.NewSessionService(sessioncache.New(nil))
	require.NoError(t, middleware.Init())
	f := &fixture{t: t, db: db, secret: randomSecret(), password: randomSecret()}
	role := models.Role{Name: "SSO only", Status: enum.Enabled}
	role.ID = "sso-only"
	require.NoError(t, db.Create(&role).Error)
	f.user = models.User{Name: "Alice", UserLogin: models.UserLogin{Username: "alice", Email: "alice@example.test", Password: f.password, RoleID: role.ID, Status: enum.Enabled}}
	require.NoError(t, db.Create(&f.user).Error)
	f.client = models.OIDCClient{ID: "test-client", Name: "PVE test", Enabled: true, Revision: 1, SecretHash: digest(f.secret), RedirectURIs: []string{"https://pve.example.test:8006"}, Scopes: []string{"openid", "profile", "email"}, Claims: []string{"preferred_username", "name", "email"}, UserIDs: []string{f.user.ID}, RoleIDs: []string{}}
	require.NoError(t, db.Create(&f.client).Error)
	f.p = &Provider{issuer: "https://id.example.test" + basePath, wrappingKey: []byte(randomSecret()[:32]), database: func(c *gin.Context) *gorm.DB { return quietDB(db).WithContext(c.Request.Context()) }, browserSession: middleware.OIDCBrowserSession}
	require.NoError(t, f.p.ensureKeys(quietDB(db)))
	f.router = gin.New()
	f.p.MountProtocol(f.router.Group("/admin/api"))
	f.router.POST("/admin/api/user/session/login", middleware.BrowserSessionLoginHandler)
	return f
}
func (f *fixture) call(method, path string, body string, headers map[string]string, cookies []*http.Cookie) *httptest.ResponseRecorder {
	f.t.Helper()
	r := httptest.NewRequest(method, "https://id.example.test"+path, strings.NewReader(body))
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	for _, cookie := range cookies {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	f.router.ServeHTTP(w, r)
	return w
}
func (f *fixture) login() {
	f.t.Helper()
	body, _ := json.Marshal(map[string]string{"username": "alice", "password": f.password})
	w := f.call("POST", "/admin/api/user/session/login", string(body), map[string]string{"Origin": "https://id.example.test", "Content-Type": "application/json"}, nil)
	require.Equal(f.t, 200, w.Code, "canonical login failed")
	f.cookies = w.Result().Cookies()
	require.Len(f.t, f.cookies, 2)
	require.Equal(f.t, "/admin/api", f.cookies[0].Path)
}
func (f *fixture) authValues() (url.Values, string) {
	verifier := randomSecret()
	hash := sha256.Sum256([]byte(verifier))
	return url.Values{"client_id": {f.client.ID}, "redirect_uri": {f.client.RedirectURIs[0]}, "scope": {"openid profile email"}, "response_type": {"code"}, "state": {randomSecret()}, "nonce": {randomSecret()}, "code_challenge_method": {"S256"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(hash[:])}}, verifier
}
func queryLocation(t *testing.T, w *httptest.ResponseRecorder) url.Values {
	t.Helper()
	u, err := url.Parse(w.Header().Get("Location"))
	require.NoError(t, err)
	return u.Query()
}
func (f *fixture) authorize(v url.Values) *httptest.ResponseRecorder {
	f.t.Helper()
	return f.call("GET", basePath+"/authorize?"+v.Encode(), "", nil, f.cookies)
}
func (f *fixture) exchange(code, verifier string, changes url.Values, secret string) *httptest.ResponseRecorder {
	f.t.Helper()
	v := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {f.client.RedirectURIs[0]}, "code_verifier": {verifier}}
	for k, values := range changes {
		v[k] = values
	}
	return f.call("POST", basePath+"/token", v.Encode(), map[string]string{"Content-Type": "application/x-www-form-urlencoded", "Authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte(url.QueryEscape(f.client.ID)+":"+url.QueryEscape(secret)))}, nil)
}
func bodyJSON(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var b map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &b))
	return b
}
func (f *fixture) verifyIDToken(raw string) jwt.MapClaims {
	f.t.Helper()
	jwks := bodyJSON(f.t, f.call("GET", basePath+"/jwks", "", nil, nil))
	keys := jwks["keys"].([]any)
	parsed, err := jwt.Parse(raw, func(token *jwt.Token) (any, error) {
		require.Equal(f.t, "RS256", token.Method.Alg())
		for _, item := range keys {
			k := item.(map[string]any)
			if k["kid"] == token.Header["kid"] {
				n, _ := base64.RawURLEncoding.DecodeString(k["n"].(string))
				e, _ := base64.RawURLEncoding.DecodeString(k["e"].(string))
				return &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}, nil
			}
		}
		return nil, errDenied
	}, jwt.WithValidMethods([]string{"RS256"}))
	require.NoError(f.t, err)
	require.True(f.t, parsed.Valid)
	claims := parsed.Claims.(jwt.MapClaims)
	require.Equal(f.t, f.p.issuer, claims["iss"])
	require.Equal(f.t, f.client.ID, claims["aud"])
	return claims
}
func TestCodeFlowReusesCanonicalSessionAcrossClients(t *testing.T) {
	f := setup(t)
	f.login()
	v, verifier := f.authValues()
	w := f.authorize(v)
	require.Equal(t, 302, w.Code)
	q := queryLocation(t, w)
	require.Equal(t, v.Get("state"), q.Get("state"))
	require.NotEmpty(t, q.Get("code"))
	token := f.exchange(q.Get("code"), verifier, nil, f.secret)
	require.Equal(t, 200, token.Code)
	require.Equal(t, "no-store", token.Header().Get("Cache-Control"))
	data := bodyJSON(t, token)
	claims := f.verifyIDToken(data["id_token"].(string))
	require.Equal(t, v.Get("nonce"), claims["nonce"])
	require.NotEmpty(t, claims["auth_time"])
	require.NotEqual(t, f.user.Username, claims["sub"])
	userinfo := f.call("GET", basePath+"/userinfo", "", map[string]string{"Authorization": "Bearer " + data["access_token"].(string)}, nil)
	require.Equal(t, 200, userinfo.Code)
	identity := bodyJSON(t, userinfo)
	require.Equal(t, claims["sub"], identity["sub"])
	require.Equal(t, "alice", identity["preferred_username"])
	require.NotContains(t, identity, "email_verified")
	// A second registered RP needs no extra login or Admin RBAC grant.
	second := f.client
	second.ID = "second-client"
	require.NoError(t, f.db.Create(&second).Error)
	v.Set("client_id", second.ID)
	w = f.authorize(v)
	require.NotEmpty(t, queryLocation(t, w).Get("code"))
	var count int64
	require.NoError(t, f.db.Model(&models.UserSession{}).Count(&count).Error)
	require.Equal(t, int64(1), count)
	replay := f.exchange(q.Get("code"), verifier, nil, f.secret)
	require.Equal(t, 400, replay.Code)
	require.Equal(t, 401, f.call("GET", basePath+"/userinfo", "", map[string]string{"Authorization": "Bearer " + data["access_token"].(string)}, nil).Code)
}
func TestAuthorizationValidationAndPromptSemantics(t *testing.T) {
	f := setup(t)
	cases := []struct {
		name, key, value, code string
		local                  bool
	}{
		{"unknown client", "client_id", "missing", "invalid_request", true}, {"unregistered redirect", "redirect_uri", "https://evil.test", "invalid_request", true}, {"fragment redirect", "redirect_uri", f.client.RedirectURIs[0] + "#bad", "invalid_request", true},
		{"implicit", "response_type", "token", "unsupported_response_type", false}, {"plain PKCE", "code_challenge_method", "plain", "invalid_request", false}, {"scope escalation", "scope", "openid admin", "invalid_scope", false}, {"duplicate scopes", "scope", "openid openid", "invalid_scope", false}, {"mixed none", "prompt", "none login", "invalid_request", false}, {"unknown prompt", "prompt", "unknown", "invalid_request", false}, {"negative age", "max_age", "-1", "invalid_request", false}, {"request URI", "request_uri", "https://evil.test/request", "request_uri_not_supported", false}, {"silent no session", "prompt", "none", "login_required", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v, _ := f.authValues()
			v.Set(tc.key, tc.value)
			w := f.authorize(v)
			if tc.local {
				require.Equal(t, 400, w.Code)
				require.Empty(t, w.Header().Get("Location"))
				require.Equal(t, tc.code, bodyJSON(t, w)["error"])
			} else {
				require.Equal(t, tc.code, queryLocation(t, w).Get("error"))
			}
		})
	}
	v, _ := f.authValues()
	v.Add("redirect_uri", v.Get("redirect_uri"))
	require.Equal(t, 400, f.authorize(v).Code)
	f.login()
	for _, change := range []url.Values{{"prompt": {"login"}}, {"prompt": {"select_account"}}, {"max_age": {"0"}}} {
		v, _ := f.authValues()
		for k, value := range change {
			v[k] = value
		}
		w := f.authorize(v)
		require.Contains(t, w.Header().Get("Location"), "/user/login?")
		next := queryLocation(t, w).Get("redirect")
		flow := w.Result().Cookies()
		require.Len(t, flow, 1)
		f.login()
		cookies := append(append([]*http.Cookie{}, f.cookies...), flow...)
		resumed := f.call("GET", next, "", nil, cookies)
		require.NotEmpty(t, queryLocation(t, resumed).Get("code"))
		require.Equal(t, 400, f.call("GET", next, "", nil, cookies).Code)
	}
	v, _ = f.authValues()
	v.Set("prompt", "none")
	require.NotEmpty(t, queryLocation(t, f.authorize(v)).Get("code"))
}
func TestTokenBindingsExpiryRevocationAndOpaqueAccess(t *testing.T) {
	for _, name := range []string{"wrong secret", "wrong verifier", "wrong redirect", "wrong client", "expired", "disabled client", "disabled user", "disabled role", "revoked session", "grant removed", "client changed", "body secret"} {
		t.Run(name, func(t *testing.T) {
			f := setup(t)
			f.login()
			v, verifier := f.authValues()
			q := queryLocation(t, f.authorize(v))
			raw := q.Get("code")
			require.NotEmpty(t, raw)
			changes := url.Values{}
			secret := f.secret
			switch name {
			case "wrong secret":
				secret = randomSecret()
			case "wrong verifier":
				verifier = randomSecret()
			case "wrong redirect":
				changes.Set("redirect_uri", f.client.RedirectURIs[0]+"/")
			case "wrong client":
				copy := f.client
				copy.ID = "other"
				require.NoError(t, f.db.Create(&copy).Error)
				f.client = copy
			case "expired":
				require.NoError(t, f.db.Model(&models.OIDCCode{}).Where("hash = ?", digest(raw)).Update("expires_at", time.Now().Add(-time.Second)).Error)
			case "disabled client":
				require.NoError(t, f.db.Model(&f.client).Update("enabled", false).Error)
			case "disabled user":
				require.NoError(t, f.db.Model(&f.user).Update("status", enum.Disabled).Error)
			case "disabled role":
				require.NoError(t, f.db.Model(&models.Role{}).Where("id = ?", f.user.RoleID).Update("status", enum.Disabled).Error)
			case "revoked session":
				require.NoError(t, f.db.Model(&models.UserSession{}).Where("user_id = ?", f.user.ID).Update("revoked", true).Error)
			case "grant removed":
				require.NoError(t, f.db.Model(&f.client).Update("user_ids", "[]").Error)
			case "client changed":
				require.NoError(t, f.db.Model(&f.client).Update("revision", 2).Error)
			case "body secret":
				changes.Set("client_secret", secret)
			}
			w := f.exchange(raw, verifier, changes, secret)
			require.Contains(t, []int{400, 401}, w.Code)
			require.NotContains(t, bodyJSON(t, w), "access_token")
		})
	}
	f := setup(t)
	f.login()
	for _, cookie := range f.cookies {
		if cookie.Name == middleware.BrowserSessionCookieName {
			require.Equal(t, 401, f.call("GET", basePath+"/userinfo", "", map[string]string{"Authorization": "Bearer " + cookie.Value}, nil).Code)
		}
	}
}
func TestSigningKeysPersistRotateAndDoNotLeak(t *testing.T) {
	f := setup(t)
	f.login()
	v, verifier := f.authValues()
	q := queryLocation(t, f.authorize(v))
	token := bodyJSON(t, f.exchange(q.Get("code"), verifier, nil, f.secret))
	claims := f.verifyIDToken(token["id_token"].(string))
	firstKeys, err := f.p.publicKeys(quietDB(f.db))
	require.NoError(t, err)
	require.NoError(t, f.p.ensureKeys(quietDB(f.db)))
	secondKeys, err := f.p.publicKeys(quietDB(f.db))
	require.NoError(t, err)
	require.Equal(t, firstKeys, secondKeys)
	require.NoError(t, f.p.rotateKeys(quietDB(f.db), func(*gorm.DB) error { return nil }))
	require.Equal(t, claims["sub"], f.verifyIDToken(token["id_token"].(string))["sub"])
	keys, err := f.p.publicKeys(quietDB(f.db))
	require.NoError(t, err)
	require.Len(t, keys, 2)
	var rows []models.OIDCSigningKey
	require.NoError(t, f.db.Find(&rows).Error)
	for _, row := range rows {
		require.False(t, bytes.Contains(row.EncryptedPrivateKey, []byte("PRIVATE KEY")))
		b, err := json.Marshal(row)
		require.NoError(t, err)
		require.NotContains(t, string(b), "EncryptedPrivateKey")
	}
	invalid := *f.p
	invalid.wrappingKey = []byte(randomSecret()[:32])
	require.Error(t, invalid.ensureKeys(quietDB(f.db)))
	invalid = *f.p
	invalid.issuer = "https://other.test" + basePath
	require.Error(t, invalid.ensureKeys(quietDB(f.db)))
}
func TestConcurrentCodeConsumption(t *testing.T) {
	f := setup(t)
	f.login()
	v, verifier := f.authValues()
	raw := queryLocation(t, f.authorize(v)).Get("code")
	var wg sync.WaitGroup
	results := make(chan int, 8)
	for range 8 {
		wg.Add(1)
		go func() { defer wg.Done(); results <- f.exchange(raw, verifier, nil, f.secret).Code }()
	}
	wg.Wait()
	close(results)
	success := 0
	for code := range results {
		if code == 200 {
			success++
		} else {
			require.Equal(t, 400, code)
		}
	}
	require.Equal(t, 1, success)
	var count int64
	require.NoError(t, f.db.Model(&models.OIDCAccessToken{}).Count(&count).Error)
	require.Equal(t, int64(1), count)
}
func TestConsentRequiresCSRFAndFlowCookie(t *testing.T) {
	f := setup(t)
	f.login()
	v, _ := f.authValues()
	v.Set("prompt", "consent")
	w := f.authorize(v)
	require.Contains(t, w.Header().Get("Location"), "/user/oidc?")
	handle := queryLocation(t, w).Get("request")
	cookies := append(append([]*http.Cookie{}, f.cookies...), w.Result().Cookies()...)
	require.Equal(t, 400, f.call("GET", basePath+"/interaction?request="+handle, "", nil, f.cookies).Code)
	require.Equal(t, 200, f.call("GET", basePath+"/interaction?request="+handle, "", nil, cookies).Code)
	b, _ := json.Marshal(map[string]any{"request": handle, "approve": true})
	headers := map[string]string{"Content-Type": "application/json", "Origin": "https://id.example.test"}
	require.Equal(t, 403, f.call("POST", basePath+"/interaction", string(b), headers, cookies).Code)
	for _, cookie := range cookies {
		if cookie.Name == middleware.BrowserCSRFCookieName {
			headers[middleware.BrowserCSRFHeaderName] = cookie.Value
		}
	}
	response := f.call("POST", basePath+"/interaction", string(b), headers, cookies)
	require.Equal(t, 200, response.Code)
	destination, err := url.Parse(bodyJSON(t, response)["redirect"].(string))
	require.NoError(t, err)
	require.NotEmpty(t, destination.Query().Get("code"))
	require.Equal(t, 400, f.call("POST", basePath+"/interaction", string(b), headers, cookies).Code)
}
func TestClientValidation(t *testing.T) {
	valid := ClientInput{Name: "PVE", Enabled: true, RedirectURIs: []string{"https://pve.example.test:8006"}, Scopes: []string{"openid", "profile", "email"}, Claims: []string{"name", "preferred_username", "email"}}
	require.NoError(t, validateClient(valid))
	for _, uri := range []string{"http://pve.example.test:8006", "https://*.example.test", "https://pve.example.test/#fragment", "https://user:password@pve.example.test", "https://pve.example.test?code=bad"} {
		in := valid
		in.RedirectURIs = []string{uri}
		require.Error(t, validateClient(in))
	}
	in := valid
	in.Scopes = []string{"openid", "admin"}
	require.Error(t, validateClient(in))
	in = valid
	in.Claims = []string{"email_verified"}
	require.Error(t, validateClient(in))
}

func TestUserInfoRechecksAuthorityAndStableSubject(t *testing.T) {
	for _, change := range []string{"disable user", "disable client", "revoke session", "remove grant", "change role", "delete user", "expire token"} {
		t.Run(change, func(t *testing.T) {
			f := setup(t)
			f.login()
			v, verifier := f.authValues()
			raw := queryLocation(t, f.authorize(v)).Get("code")
			w := f.exchange(raw, verifier, nil, f.secret)
			require.Equal(t, 200, w.Code)
			data := bodyJSON(t, w)
			switch change {
			case "disable user":
				require.NoError(t, f.db.Model(&f.user).Update("status", "disabled").Error)
			case "disable client":
				require.NoError(t, f.db.Model(&f.client).Update("enabled", false).Error)
			case "revoke session":
				require.NoError(t, f.db.Model(&models.UserSession{}).Where("user_id = ?", f.user.ID).Update("revoked", true).Error)
			case "remove grant":
				require.NoError(t, f.db.Model(&f.client).Update("user_ids", "[]").Error)
			case "change role":
				require.NoError(t, f.db.Model(&f.user).Update("role_id", "missing-role").Error)
			case "delete user":
				require.NoError(t, f.db.Delete(&f.user).Error)
			case "expire token":
				require.NoError(t, f.db.Model(&models.OIDCAccessToken{}).Where("client_id = ?", f.client.ID).Update("expires_at", time.Now().Add(-time.Second)).Error)
			}
			require.Equal(t, 401, f.call("GET", basePath+"/userinfo", "", map[string]string{"Authorization": "Bearer " + data["access_token"].(string)}, nil).Code)
		})
	}
	f := setup(t)
	f.login()
	v, verifier := f.authValues()
	raw := queryLocation(t, f.authorize(v)).Get("code")
	first := bodyJSON(t, f.exchange(raw, verifier, nil, f.secret))
	sub := f.verifyIDToken(first["id_token"].(string))["sub"]
	require.NoError(t, f.db.Model(&f.user).Update("username", "renamed").Error)
	// Nonce cannot be overwritten by an irrelevant token request parameter.
	v, verifier = f.authValues()
	raw = queryLocation(t, f.authorize(v)).Get("code")
	second := bodyJSON(t, f.exchange(raw, verifier, url.Values{"nonce": {randomSecret()}}, f.secret))
	claims := f.verifyIDToken(second["id_token"].(string))
	require.True(t, sub == claims["sub"])
	require.True(t, v.Get("nonce") == claims["nonce"])
	require.Equal(t, "renamed", claims["preferred_username"])
}

func TestIssuerDiscoveryAndAuthorizationPOST(t *testing.T) {
	f := setup(t)
	f.login()
	meta := bodyJSON(t, f.call("GET", basePath+"/.well-known/openid-configuration", "", nil, nil))
	require.Equal(t, f.p.issuer, meta["issuer"])
	require.Equal(t, []any{"client_secret_basic"}, meta["token_endpoint_auth_methods_supported"])
	require.NotContains(t, meta, "end_session_endpoint")
	require.NotContains(t, meta, "registration_endpoint")
	v, _ := f.authValues()
	w := f.call("POST", basePath+"/authorize", v.Encode(), map[string]string{"Content-Type": "application/x-www-form-urlencoded"}, f.cookies)
	require.NotEmpty(t, queryLocation(t, w).Get("code"))
	require.Equal(t, 400, f.call("POST", basePath+"/authorize?client_id=duplicate", v.Encode(), map[string]string{"Content-Type": "application/x-www-form-urlencoded"}, f.cookies).Code)
}
