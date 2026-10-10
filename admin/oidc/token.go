package oidc

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v4"
	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
	"gorm.io/gorm"
)

var errCodeConsumptionConflict = errors.New("OIDC code consumption conflict")

func (p *Provider) token(c *gin.Context) {
	// Token credentials and grants belong in the POST body and a single
	// authentication header, never in URLs or ambiguous duplicate headers.
	if c.Request.URL.RawQuery != "" || len(c.Request.Header.Values("Authorization")) > 1 {
		protocolError(c, 400, "invalid_request")
		return
	}
	v, err := parameters(c)
	if err != nil {
		protocolError(c, 400, "invalid_request")
		return
	}
	id, secret, ok := c.Request.BasicAuth()
	id, e1 := url.QueryUnescape(id)
	secret, e2 := url.QueryUnescape(secret)
	db := p.database(c)
	client, err := p.client(db, id)
	if !ok || e1 != nil || e2 != nil || err != nil || len(secret) > 256 || subtle.ConstantTimeCompare([]byte(digest(secret)), []byte(client.SecretHash)) != 1 {
		c.Header("WWW-Authenticate", `Basic realm="OIDC"`)
		protocolError(c, 401, "invalid_client")
		return
	}
	defer func() {
		if c.Writer.Status() >= 400 {
			_ = p.audit(db, c, "token.rejected", client.ID, "", false)
		}
	}()
	// Reject a second authentication method or a conflicting client identifier.
	if v.Has("client_secret") || (v.Has("client_id") && v.Get("client_id") != client.ID) {
		protocolError(c, 400, "invalid_request")
		return
	}
	if v.Get("grant_type") != "authorization_code" {
		protocolError(c, 400, "unsupported_grant_type")
		return
	}
	var code models.OIDCCode
	if len(v.Get("code")) != 43 || db.First(&code, "hash = ?", digest(v.Get("code"))).Error != nil || code.ClientID != client.ID {
		protocolError(c, 400, "invalid_grant")
		return
	}
	if code.ConsumedAt != nil {
		p.rejectCodeReplay(c, db, &code)
		return
	}
	verifier := v.Get("code_verifier")
	validVerifier := len(verifier) >= 43 && len(verifier) <= 128
	for _, ch := range verifier {
		if !((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || strings.ContainsRune("-._~", ch)) {
			validVerifier = false
		}
	}
	hash := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(hash[:])
	if !validVerifier || subtle.ConstantTimeCompare([]byte(challenge), []byte(code.Challenge)) != 1 || code.RedirectURI != v.Get("redirect_uri") || code.ClientRevision != client.Revision || !code.ExpiresAt.After(time.Now()) {
		protocolError(c, 400, "invalid_grant")
		return
	}
	access := randomSecret()
	var idToken string
	now := time.Now()
	err = db.Transaction(func(tx *gorm.DB) error {
		consumed := tx.Model(&models.OIDCCode{}).Where("hash = ? AND consumed_at IS NULL AND expires_at > ?", code.Hash, now).Update("consumed_at", now)
		if consumed.Error != nil {
			return consumed.Error
		}
		if consumed.RowsAffected != 1 {
			return errCodeConsumptionConflict
		}
		current, err := p.client(tx, client.ID)
		if err != nil || current.Revision != code.ClientRevision {
			return errDenied
		}
		user, _, err := p.identity(tx, current, code.UserID, code.SessionID)
		if err != nil {
			return errDenied
		}
		var subject models.OIDCSubject
		if err := tx.Where("sub = ? AND user_id = ? AND user_created_at = ?", code.Sub, user.ID, user.CreatedAt).Take(&subject).Error; err != nil {
			return errDenied
		}
		claims := jwt.MapClaims(profileClaims(current, user, code.Scope, code.Sub))
		claims["iss"] = p.issuer
		claims["aud"] = client.ID
		claims["iat"] = now.Unix()
		claims["exp"] = now.Add(tokenLifetime).Unix()
		claims["auth_time"] = code.AuthTime
		if code.Nonce != "" {
			claims["nonce"] = code.Nonce
		}
		ath := sha256.Sum256([]byte(access))
		claims["at_hash"] = base64.RawURLEncoding.EncodeToString(ath[:16])
		idToken, err = p.signIDToken(tx, claims)
		if err != nil {
			return err
		}
		row := models.OIDCAccessToken{Hash: digest(access), CodeHash: code.Hash, ClientID: client.ID, ClientRevision: current.Revision, UserID: code.UserID, SessionID: code.SessionID, Sub: code.Sub, Scope: code.Scope, ExpiresAt: now.Add(tokenLifetime)}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		return p.audit(tx, c, "token", client.ID, code.UserID, true)
	})
	if errors.Is(err, errCodeConsumptionConflict) {
		// Concurrent exchanges can both read an unconsumed code. Inspect the
		// committed state only after the losing transaction has rolled back;
		// revocation inside that transaction would otherwise be rolled back too.
		var current models.OIDCCode
		if readErr := db.Select("consumed_at").First(&current, "hash = ?", code.Hash).Error; readErr != nil {
			protocolError(c, 503, "temporarily_unavailable")
			return
		}
		if current.ConsumedAt != nil {
			p.rejectCodeReplay(c, db, &code)
			return
		}
	}
	if err != nil {
		protocolError(c, 400, "invalid_grant")
		return
	}
	c.JSON(200, gin.H{"access_token": access, "token_type": "Bearer", "expires_in": int(tokenLifetime.Seconds()), "id_token": idToken, "scope": code.Scope})
}

func (p *Provider) rejectCodeReplay(c *gin.Context, db *gorm.DB, code *models.OIDCCode) {
	// Revoke only this authenticated client's proven replayed grant. Keep the
	// revocation durable even when writing the subsequent audit record fails.
	if err := db.Model(&models.OIDCAccessToken{}).Where("code_hash = ?", code.Hash).Update("revoked", true).Error; err != nil {
		protocolError(c, 503, "temporarily_unavailable")
		return
	}
	if err := p.audit(db, c, "token.replay", code.ClientID, code.UserID, false); err != nil {
		protocolError(c, 503, "temporarily_unavailable")
		return
	}
	protocolError(c, 400, "invalid_grant")
}

func (p *Provider) userinfo(c *gin.Context) {
	if len(c.Request.Header.Values("Authorization")) > 1 {
		protocolError(c, 400, "invalid_request")
		return
	}
	parts := strings.Fields(c.GetHeader("Authorization"))
	deny := func() {
		c.Header("WWW-Authenticate", `Bearer error="invalid_token"`)
		protocolError(c, 401, "invalid_token")
	}
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || len(parts[1]) != 43 {
		deny()
		return
	}
	// Only the header bearer mechanism is accepted; credentials in URLs never work.
	if c.Request.URL.RawQuery != "" {
		protocolError(c, 400, "invalid_request")
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil || len(body) != 0 {
		protocolError(c, 400, "invalid_request")
		return
	}
	db := p.database(c)
	var access models.OIDCAccessToken
	if err := db.Where("hash = ? AND revoked = ? AND expires_at > ?", digest(parts[1]), false, time.Now()).Take(&access).Error; err != nil {
		deny()
		return
	}
	client, err := p.client(db, access.ClientID)
	if err != nil || client.Revision != access.ClientRevision {
		deny()
		return
	}
	user, _, err := p.identity(db, client, access.UserID, access.SessionID)
	if err != nil {
		deny()
		return
	}
	var subject models.OIDCSubject
	if err := db.Where("sub = ? AND user_id = ? AND user_created_at = ?", access.Sub, user.ID, user.CreatedAt).Take(&subject).Error; err != nil {
		deny()
		return
	}
	c.JSON(200, profileClaims(client, user, access.Scope, access.Sub))
}
