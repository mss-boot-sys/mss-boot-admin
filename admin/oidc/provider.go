// Package oidc implements the bounded confidential-client OIDC surface owned
// by core Admin authentication, independently of business module composition.
package oidc

import (
	"encoding/base64"
	"errors"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mss-boot-io/mss-boot-admin/admin/center"
	"github.com/mss-boot-io/mss-boot-admin/admin/config"
	"github.com/mss-boot-io/mss-boot-admin/admin/middleware"
	"github.com/mss-boot-io/mss-boot-admin/admin/models"
	"github.com/mss-boot-io/mss-boot-admin/admin/service"
	"github.com/mss-boot-io/mss-boot-admin/mss-boot/pkg/enum"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/plugin/dbresolver"
)

const basePath = "/admin/api/oidc"
const flowCookie = "mss_oidc_flow"

var errConflict = errors.New("OIDC revision conflict")
var errDenied = errors.New("OIDC access denied")

type Provider struct {
	issuer         string
	wrappingKey    []byte
	database       func(*gin.Context) *gorm.DB
	browserSession func(*gin.Context) (*models.UserSession, error)
}

func New(cfg config.OIDC, db *gorm.DB) (*Provider, error) {
	env := cfg.KeyEncryptionKeyEnv
	if env == "" {
		env = "MSS_OIDC_KEY_ENCRYPTION_KEY"
	}
	key, err := base64.StdEncoding.DecodeString(os.Getenv(env))
	if err != nil || len(key) != 32 {
		return nil, errors.New("OIDC wrapping key environment variable must contain base64 of 32 random bytes")
	}
	p := &Provider{issuer: cfg.Issuer, wrappingKey: key, browserSession: middleware.OIDCBrowserSession}
	p.database = func(c *gin.Context) *gorm.DB {
		return quietDB(center.Default.GetDB(c, &models.OIDCClient{})).WithContext(c.Request.Context())
	}
	if err := p.ensureKeys(quietDB(db)); err != nil {
		return nil, err
	}
	return p, nil
}

// Always consult the primary; replica lag must never resurrect revoked grants.
// Protocol values, credentials and encrypted key material never enter SQL logs.
func quietDB(db *gorm.DB) *gorm.DB {
	return db.Session(&gorm.Session{Logger: logger.Discard}).Clauses(dbresolver.Write).Session(&gorm.Session{})
}

// MountProtocol deliberately does not inherit the Admin CORS/CSRF middleware:
// the server-to-server token endpoint authenticates a client, not a browser.
// Browser consent has the canonical CSRF check on its own POST route. The
// authorization GET is the narrowly scoped OIDC protocol redirect boundary.
func (p *Provider) MountProtocol(api *gin.RouterGroup) {
	g := api.Group("/oidc", protocolHeaders)
	g.GET("/.well-known/openid-configuration", p.discovery)
	g.GET("/jwks", p.jwks)
	g.GET("/authorize", p.authorize)
	g.POST("/authorize", p.authorize)
	g.GET("/continue", p.continueAuthorization)
	g.GET("/interaction", p.interaction)
	g.POST("/interaction", middleware.EnforceBrowserCSRF(), p.approve)
	g.POST("/token", p.token)
	g.GET("/userinfo", p.userinfo)
	g.POST("/userinfo", p.userinfo)
}
func protocolHeaders(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("X-Frame-Options", "DENY")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16384)
	c.Next()
}
func protocolError(c *gin.Context, status int, code string) {
	c.AbortWithStatusJSON(status, gin.H{"error": code})
}
func (p *Provider) discovery(c *gin.Context) {
	c.JSON(200, gin.H{"issuer": p.issuer, "authorization_endpoint": p.issuer + "/authorize", "token_endpoint": p.issuer + "/token", "userinfo_endpoint": p.issuer + "/userinfo", "jwks_uri": p.issuer + "/jwks", "scopes_supported": []string{"openid", "profile", "email"}, "response_types_supported": []string{"code"}, "response_modes_supported": []string{"query"}, "grant_types_supported": []string{"authorization_code"}, "subject_types_supported": []string{"public"}, "id_token_signing_alg_values_supported": []string{"RS256"}, "token_endpoint_auth_methods_supported": []string{"client_secret_basic"}, "code_challenge_methods_supported": []string{"S256"}, "claims_supported": []string{"iss", "sub", "aud", "iat", "exp", "auth_time", "nonce", "name", "preferred_username", "email"}, "authorization_response_iss_parameter_supported": true, "claims_parameter_supported": false, "request_parameter_supported": false, "request_uri_parameter_supported": false})
}
func (p *Provider) jwks(c *gin.Context) {
	keys, err := p.publicKeys(p.database(c))
	if err != nil {
		protocolError(c, 503, "temporarily_unavailable")
		return
	}
	c.JSON(200, gin.H{"keys": keys})
}
func (p *Provider) client(db *gorm.DB, id string) (*models.OIDCClient, error) {
	var client models.OIDCClient
	if err := db.Where("id = ? AND enabled = ?", id, true).Take(&client).Error; err != nil {
		return nil, err
	}
	return &client, nil
}

func (p *Provider) identity(db *gorm.DB, client *models.OIDCClient, userID, sessionID string) (*models.User, *models.UserSession, error) {
	principal, err := models.LoadCurrentUserPrincipal(db.Statement.Context, db, userID)
	if err != nil {
		return nil, nil, errDenied
	}
	if !slices.Contains(client.UserIDs, userID) && !slices.Contains(client.RoleIDs, principal.RoleID) {
		return nil, nil, errDenied
	}
	var session models.UserSession
	if err := db.Where("id = ? AND user_id = ? AND role_id = ? AND revoked = ? AND expired_at > ?", sessionID, userID, principal.RoleID, false, time.Now()).Take(&session).Error; err != nil {
		return nil, nil, errDenied
	}
	// Read only released profile fields, never password hashes or recovery data.
	var user models.User
	if err := db.Select("id", "created_at", "username", "name", "email").First(&user, "id = ?", userID).Error; err != nil {
		return nil, nil, err
	}
	return &user, &session, nil
}
func profileClaims(client *models.OIDCClient, user *models.User, scope string, sub string) map[string]any {
	result := map[string]any{"sub": sub}
	scopes := strings.Fields(scope)
	if slices.Contains(scopes, "profile") {
		if slices.Contains(client.Claims, "name") {
			result["name"] = user.Name
		}
		if slices.Contains(client.Claims, "preferred_username") {
			result["preferred_username"] = user.Username
		}
	}
	if slices.Contains(scopes, "email") && slices.Contains(client.Claims, "email") && user.Email != "" {
		result["email"] = user.Email
	}
	return result
}
func (p *Provider) audit(db *gorm.DB, c *gin.Context, action, clientID, userID string, success bool) error {
	status := enum.Disabled
	if success {
		status = enum.Enabled
	}
	return service.Audit.Log(db, &models.AuditLog{Type: models.AuditLogTypeSecurity, UserID: userID, Action: "oidc." + action, Resource: clientID, Method: c.Request.Method, Path: c.Request.URL.Path, IP: c.ClientIP(), Status: status})
}
