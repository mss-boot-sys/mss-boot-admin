package oidc

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mss-boot-sys/mss-boot-admin/admin/middleware"
	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
	"gorm.io/gorm"
)

// ManagementRoutes is also consumed by the permission migration. No role is
// automatically granted these privileges, including roles used as SSO groups.
var ManagementRoutes = []struct{ Method, Path, Permission string }{
	{"GET", "/sso/clients", "sso:read"},
	{"POST", "/sso/clients", "sso:write"},
	{"PUT", "/sso/clients/:id", "sso:write"},
	{"POST", "/sso/clients/:id/rotate-secret", "sso:secret-rotate"},
	{"GET", "/sso/audit", "sso:audit"},
	{"GET", "/sso/signing-keys", "sso:read"},
	{"POST", "/sso/signing-keys/rotate", "sso:key-rotate"},
}

// MountDisabledManagement keeps the console entrypoint diagnosable without
// mounting protocol or mutation routes. The existing authentication and API
// permission checks run before disclosing this non-sensitive capability state.
func MountDisabledManagement(api *gin.RouterGroup) {
	api.GET("/sso/clients", protocolHeaders, middleware.Auth.MiddlewareFunc(), func(c *gin.Context) {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
			"success":      false,
			"errorCode":    "SSO_PROVIDER_DISABLED",
			"errorMessage": "SSO provider is not configured",
		})
	})
}

func (p *Provider) MountManagement(api *gin.RouterGroup) {
	g := api.Group("/sso", protocolHeaders, middleware.Auth.MiddlewareFunc())
	g.GET("/clients", p.listClients)
	g.POST("/clients", p.createClient)
	g.PUT("/clients/:id", p.updateClient)
	g.POST("/clients/:id/rotate-secret", p.rotateSecret)
	g.GET("/audit", p.listAudit)
	g.GET("/signing-keys", p.listKeys)
	g.POST("/signing-keys/rotate", p.rotateSigningKey)
}

type ClientInput struct {
	Name         string   `json:"name"`
	Enabled      bool     `json:"enabled"`
	Revision     int64    `json:"revision"`
	RedirectURIs []string `json:"redirectURIs"`
	Scopes       []string `json:"scopes"`
	Claims       []string `json:"claims"`
	UserIDs      []string `json:"userIDs"`
	RoleIDs      []string `json:"roleIDs"`
}

func decodeJSON(c *gin.Context, out any) error {
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return errDenied
	}
	return nil
}
func uniqueBounded(values []string, limit int) bool {
	if len(values) > limit {
		return false
	}
	seen := map[string]bool{}
	for _, v := range values {
		if v == "" || len(v) > 2048 || strings.TrimSpace(v) != v || seen[v] {
			return false
		}
		seen[v] = true
	}
	return true
}
func validateClient(in ClientInput) error {
	if strings.TrimSpace(in.Name) == "" || len(in.Name) > 120 || len(in.RedirectURIs) == 0 || !uniqueBounded(in.RedirectURIs, 20) || !uniqueBounded(in.Scopes, 3) || !uniqueBounded(in.Claims, 3) || !uniqueBounded(in.UserIDs, 200) || !uniqueBounded(in.RoleIDs, 100) {
		return errDenied
	}
	for _, raw := range in.RedirectURIs {
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" || strings.Contains(raw, "#") || strings.Contains(raw, "*") {
			return errDenied
		}
		q, err := url.ParseQuery(u.RawQuery)
		if err != nil {
			return errDenied
		}
		for _, k := range []string{"code", "state", "error", "iss"} {
			if q.Has(k) {
				return errDenied
			}
		}
	}
	if !slices.Contains(in.Scopes, "openid") {
		return errDenied
	}
	for _, scope := range in.Scopes {
		if !slices.Contains([]string{"openid", "profile", "email"}, scope) {
			return errDenied
		}
	}
	for _, claim := range in.Claims {
		if !slices.Contains([]string{"name", "preferred_username", "email"}, claim) {
			return errDenied
		}
		scope := "profile"
		if claim == "email" {
			scope = "email"
		}
		if !slices.Contains(in.Scopes, scope) {
			return errDenied
		}
	}
	for _, id := range append(append([]string{}, in.UserIDs...), in.RoleIDs...) {
		if len(id) > 64 {
			return errDenied
		}
	}
	return nil
}
func validateMembers(db *gorm.DB, in ClientInput) error {
	for _, item := range []struct {
		Model any
		IDs   []string
	}{{&models.User{}, in.UserIDs}, {&models.Role{}, in.RoleIDs}} {
		if len(item.IDs) == 0 {
			continue
		}
		var count int64
		if err := db.Model(item.Model).Where("id IN ?", item.IDs).Count(&count).Error; err != nil {
			return err
		}
		if count != int64(len(item.IDs)) {
			return errDenied
		}
	}
	return nil
}
func clientFromInput(in ClientInput) models.OIDCClient {
	return models.OIDCClient{Name: in.Name, Enabled: in.Enabled, RedirectURIs: in.RedirectURIs, Scopes: in.Scopes, Claims: append([]string{}, in.Claims...), UserIDs: append([]string{}, in.UserIDs...), RoleIDs: append([]string{}, in.RoleIDs...)}
}
func actor(c *gin.Context) string {
	if v := middleware.GetVerify(c); v != nil {
		return v.GetUserID()
	}
	return ""
}
func managementError(c *gin.Context, err error) {
	status := 503
	message := "SSO service unavailable"
	if errors.Is(err, errDenied) {
		status = 422
		message = "Invalid SSO application or grant"
	}
	if errors.Is(err, errConflict) {
		status = 409
		message = "SSO application changed; reload before retrying"
	}
	c.AbortWithStatusJSON(status, gin.H{"success": false, "errorMessage": message})
}
func page(c *gin.Context) (int, int) {
	n, _ := strconv.Atoi(c.Query("current"))
	if n < 1 {
		n = 1
	}
	size, _ := strconv.Atoi(c.Query("pageSize"))
	if size < 1 || size > 100 {
		size = 20
	}
	if n > 100000 {
		n = 100000
	}
	return n, size
}
func (p *Provider) listClients(c *gin.Context) {
	db := p.database(c)
	n, size := page(c)
	var rows []models.OIDCClient
	var total int64
	if err := db.Model(&models.OIDCClient{}).Count(&total).Error; err != nil {
		managementError(c, err)
		return
	}
	if err := db.Order("created_at DESC, id").Offset((n - 1) * size).Limit(size).Find(&rows).Error; err != nil {
		managementError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"list": rows, "total": total, "issuer": p.issuer}})
}
func (p *Provider) createClient(c *gin.Context) {
	var in ClientInput
	if decodeJSON(c, &in) != nil || validateClient(in) != nil {
		managementError(c, errDenied)
		return
	}
	secret := randomSecret()
	client := clientFromInput(in)
	client.ID = "mss_" + randomSecret()
	client.SecretHash = digest(secret)
	client.Revision = 1
	err := p.database(c).Transaction(func(tx *gorm.DB) error {
		if err := validateMembers(tx, in); err != nil {
			return err
		}
		if err := tx.Create(&client).Error; err != nil {
			return err
		}
		return p.audit(tx, c, "client.create", client.ID, actor(c), true)
	})
	if err != nil {
		managementError(c, err)
		return
	}
	c.JSON(201, gin.H{"success": true, "data": gin.H{"client": client, "secret": secret}})
}
func (p *Provider) updateClient(c *gin.Context) {
	var in ClientInput
	if decodeJSON(c, &in) != nil || validateClient(in) != nil || in.Revision < 1 {
		managementError(c, errDenied)
		return
	}
	err := p.database(c).Transaction(func(tx *gorm.DB) error {
		if err := validateMembers(tx, in); err != nil {
			return err
		}
		client := clientFromInput(in)
		client.Revision = in.Revision + 1
		result := tx.Model(&models.OIDCClient{}).Where("id = ? AND revision = ?", c.Param("id"), in.Revision).
			Select("Name", "Enabled", "RedirectURIs", "Scopes", "Claims", "UserIDs", "RoleIDs", "Revision").Updates(&client)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errConflict
		}
		return p.audit(tx, c, "client.update", c.Param("id"), actor(c), true)
	})
	if err != nil {
		managementError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true})
}
func (p *Provider) rotateSecret(c *gin.Context) {
	var in struct {
		Revision int64 `json:"revision"`
	}
	if decodeJSON(c, &in) != nil || in.Revision < 1 {
		managementError(c, errDenied)
		return
	}
	secret := randomSecret()
	err := p.database(c).Transaction(func(tx *gorm.DB) error {
		r := tx.Model(&models.OIDCClient{}).Where("id = ? AND revision = ?", c.Param("id"), in.Revision).Updates(map[string]any{"secret_hash": digest(secret), "revision": in.Revision + 1})
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected != 1 {
			return errConflict
		}
		return p.audit(tx, c, "client.rotate-secret", c.Param("id"), actor(c), true)
	})
	if err != nil {
		managementError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"secret": secret}})
}
func (p *Provider) listAudit(c *gin.Context) {
	db := p.database(c).Model(&models.AuditLog{}).Where("type = ? AND action LIKE ?", models.AuditLogTypeSecurity, "oidc.%")
	if id := c.Query("clientID"); id != "" {
		db = db.Where("resource = ?", id)
	}
	n, size := page(c)
	var rows []models.AuditLog
	var total int64
	if err := db.Count(&total).Error; err != nil {
		managementError(c, err)
		return
	}
	if err := db.Order("created_at DESC, id").Offset((n - 1) * size).Limit(size).Find(&rows).Error; err != nil {
		managementError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"list": rows, "total": total}})
}
func (p *Provider) listKeys(c *gin.Context) {
	var rows []models.OIDCSigningKey
	if err := p.database(c).Select("kid", "created_at", "retain_until").Order("created_at DESC").Find(&rows).Error; err != nil {
		managementError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": rows})
}
func (p *Provider) rotateSigningKey(c *gin.Context) {
	if err := p.rotateKeys(p.database(c), func(tx *gorm.DB) error { return p.audit(tx, c, "signing-key.rotate", "provider", actor(c), true) }); err != nil {
		managementError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true})
}
