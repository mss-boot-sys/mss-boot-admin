package middleware

import (
	"errors"
	"time"

	jwt "github.com/appleboy/gin-jwt/v2"
	"github.com/gin-gonic/gin"
	"github.com/mss-boot-sys/mss-boot-admin/admin/center"
	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
	"github.com/spf13/cast"
	"gorm.io/gorm"
	"gorm.io/plugin/dbresolver"
)

// OIDCBrowserSession resolves the canonical browser credential without invoking
// route-level Admin RBAC or writing an Admin response envelope. OIDC applies its
// own application grant and protocol response after this identity-only boundary.
// Personal access tokens and Authorization headers cannot establish browser SSO.
func OIDCBrowserSession(c *gin.Context) (*models.UserSession, error) {
	if Auth == nil {
		return nil, errors.New("browser authentication unavailable")
	}
	raw := browserSessionCookie(c)
	if raw == "" {
		return nil, nil
	}
	token, err := Auth.ParseTokenString(raw)
	if err != nil || token == nil || !token.Valid {
		return nil, nil
	}
	claims := jwt.ExtractClaimsFromToken(token)
	if cast.ToString(claims["personAccessToken"]) != "" || cast.ToBool(claims["refreshTokenDisabled"]) {
		return nil, nil
	}
	uid, rid, err := principalSnapshotFromClaims(claims)
	if err != nil {
		return nil, nil
	}
	sid := cast.ToString(claims["sid"])
	if sid == "" {
		return nil, nil
	}
	db := center.Default.GetDB(c, &models.UserSession{}).Clauses(dbresolver.Write).Session(&gorm.Session{})
	var session models.UserSession
	if err := db.Where("id = ? AND user_id = ? AND role_id = ? AND revoked = ? AND expired_at > ?", sid, uid, rid, false, time.Now()).Take(&session).Error; err != nil {
		// Missing, expired or revoked sessions are not authentication.
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	principal, err := models.LoadCurrentUserPrincipal(c.Request.Context(), db, uid)
	if err != nil {
		return nil, nil
	}
	if principal.RoleID != rid {
		return nil, nil
	}
	return &session, nil
}
