package oidc

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mss-boot-io/mss-boot-admin/admin/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Form parameters must occur once across query and body. Query parsing errors
// are fatal, rather than silently dropping a malformed security parameter.
func parameters(c *gin.Context) (url.Values, error) {
	values, err := url.ParseQuery(c.Request.URL.RawQuery)
	if err != nil || len(c.Request.URL.RawQuery) > 16384 {
		return nil, errDenied
	}
	if c.Request.Method == http.MethodPost {
		if strings.Split(c.GetHeader("Content-Type"), ";")[0] != "application/x-www-form-urlencoded" {
			return nil, errDenied
		}
		if err := c.Request.ParseForm(); err != nil {
			return nil, err
		}
		values = c.Request.Form
	}
	for _, v := range values {
		if len(v) != 1 || len(v[0]) > 4096 {
			return nil, errDenied
		}
	}
	return values, nil
}
func (p *Provider) redirect(c *gin.Context, r *models.OIDCRequest, values url.Values) {
	u, _ := url.Parse(r.RedirectURI)
	query := u.Query()
	for k, v := range values {
		query[k] = v
	}
	if r.State != "" {
		query.Set("state", r.State)
	}
	query.Set("iss", p.issuer)
	u.RawQuery = query.Encode()
	if c.GetBool("oidc.redirect.json") {
		c.JSON(200, gin.H{"redirect": u.String()})
		return
	}
	c.Redirect(http.StatusFound, u.String())
}
func (p *Provider) authorizationError(c *gin.Context, r *models.OIDCRequest, code string) {
	_ = p.audit(p.database(c), c, "authorize."+code, r.ClientID, "", false)
	p.redirect(c, r, url.Values{"error": {code}})
}
func (p *Provider) authorize(c *gin.Context) {
	values, err := parameters(c)
	if err != nil {
		protocolError(c, 400, "invalid_request")
		return
	}
	db := p.database(c)
	client, err := p.client(db, values.Get("client_id"))
	if err != nil || !slices.Contains(client.RedirectURIs, values.Get("redirect_uri")) {
		// Never redirect before both the registered client and exact URI are known.
		protocolError(c, 400, "invalid_request")
		return
	}
	r := &models.OIDCRequest{ClientID: client.ID, ClientRevision: client.Revision, RedirectURI: values.Get("redirect_uri"), State: values.Get("state"), Nonce: values.Get("nonce"), Challenge: values.Get("code_challenge"), Prompt: values.Get("prompt"), CreatedAt: time.Now()}
	fail := func(code string) { p.authorizationError(c, r, code) }
	if values.Has("nonce") && values.Get("nonce") == "" {
		fail("invalid_request")
		return
	}
	if values.Get("response_type") != "code" {
		fail("unsupported_response_type")
		return
	}
	if mode := values.Get("response_mode"); mode != "" && mode != "query" {
		fail("invalid_request")
		return
	}
	for key, code := range map[string]string{"request": "request_not_supported", "request_uri": "request_uri_not_supported", "registration": "registration_not_supported"} {
		if _, ok := values[key]; ok {
			fail(code)
			return
		}
	}
	for _, key := range []string{"claims", "id_token_hint", "acr_values"} {
		if values.Get(key) != "" {
			fail("invalid_request")
			return
		}
	}
	scopes := strings.Fields(values.Get("scope"))
	if !slices.Contains(scopes, "openid") || len(scopes) > 3 {
		fail("invalid_scope")
		return
	}
	seen := map[string]bool{}
	for _, scope := range scopes {
		if seen[scope] || !slices.Contains(client.Scopes, scope) {
			fail("invalid_scope")
			return
		}
		seen[scope] = true
	}
	r.Scope = strings.Join(scopes, " ")
	challenge, err := base64.RawURLEncoding.DecodeString(r.Challenge)
	if values.Get("code_challenge_method") != "S256" || err != nil || len(challenge) != 32 || base64.RawURLEncoding.EncodeToString(challenge) != r.Challenge {
		fail("invalid_request")
		return
	}
	prompts := strings.Fields(r.Prompt)
	seen = map[string]bool{}
	for _, prompt := range prompts {
		if seen[prompt] || !slices.Contains([]string{"none", "login", "consent", "select_account"}, prompt) {
			fail("invalid_request")
			return
		}
		seen[prompt] = true
	}
	if seen["none"] && len(prompts) != 1 {
		fail("invalid_request")
		return
	}
	if raw, ok := values["max_age"]; ok {
		n, err := strconv.ParseInt(raw[0], 10, 32)
		if err != nil || n < 0 || strings.Trim(raw[0], "0123456789") != "" {
			fail("invalid_request")
			return
		}
		r.MaxAge = &n
	}
	session, err := p.browserSession(c)
	if err != nil {
		fail("temporarily_unavailable")
		return
	}
	if seen["none"] && needsLogin(r, session) {
		fail("login_required")
		return
	}
	if session != nil && !needsLogin(r, session) {
		if _, _, err := p.identity(db, client, session.UserID, session.ID); err != nil {
			fail("access_denied")
			return
		}
	}
	binding, _ := c.Cookie(flowCookie)
	if len(binding) != 43 {
		binding = randomSecret()
	}
	http.SetCookie(c.Writer, &http.Cookie{Name: flowCookie, Value: binding, Path: basePath, Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 600})
	handle := randomSecret()
	r.Hash = digest(handle)
	r.BrowserHash = digest(binding)
	r.ExpiresAt = time.Now().Add(10 * time.Minute)
	if err := pruneExpired(db); err != nil {
		fail("temporarily_unavailable")
		return
	}
	if err := db.Create(r).Error; err != nil {
		fail("temporarily_unavailable")
		return
	}
	p.advance(c, r, client, session, handle, false)
}

func needsLogin(r *models.OIDCRequest, s *models.UserSession) bool {
	if s == nil {
		return true
	}
	fresh := !s.LoginAt.Before(r.CreatedAt)
	prompts := strings.Fields(r.Prompt)
	if (slices.Contains(prompts, "login") || slices.Contains(prompts, "select_account")) && !fresh {
		return true
	}
	if r.MaxAge != nil {
		if *r.MaxAge == 0 {
			return !fresh
		}
		return time.Since(s.LoginAt) > time.Duration(*r.MaxAge)*time.Second
	}
	return false
}
func (p *Provider) loadRequest(c *gin.Context, handle string) (*models.OIDCRequest, *models.OIDCClient, error) {
	if len(handle) != 43 {
		return nil, nil, errDenied
	}
	binding, _ := c.Cookie(flowCookie)
	var r models.OIDCRequest
	if err := p.database(c).Where("hash = ? AND consumed_at IS NULL AND expires_at > ?", digest(handle), time.Now()).Take(&r).Error; err != nil {
		return nil, nil, err
	}
	if binding == "" || subtle.ConstantTimeCompare([]byte(digest(binding)), []byte(r.BrowserHash)) != 1 {
		return nil, nil, errDenied
	}
	client, err := p.client(p.database(c), r.ClientID)
	if err != nil || client.Revision != r.ClientRevision {
		return nil, nil, errDenied
	}
	return &r, client, nil
}
func (p *Provider) continueAuthorization(c *gin.Context) {
	values, err := parameters(c)
	if err != nil {
		protocolError(c, 400, "invalid_request")
		return
	}
	handle := values.Get("request")
	r, client, err := p.loadRequest(c, handle)
	if err != nil {
		protocolError(c, 400, "invalid_request")
		return
	}
	session, err := p.browserSession(c)
	if err != nil {
		p.authorizationError(c, r, "temporarily_unavailable")
		return
	}
	p.advance(c, r, client, session, handle, false)
}
func (p *Provider) advance(c *gin.Context, r *models.OIDCRequest, client *models.OIDCClient, session *models.UserSession, handle string, approved bool) {
	if needsLogin(r, session) {
		origin := strings.TrimSuffix(p.issuer, basePath)
		next := basePath + "/continue?request=" + url.QueryEscape(handle)
		c.Redirect(302, origin+"/user/login?redirect="+url.QueryEscape(next))
		return
	}
	user, current, err := p.identity(p.database(c), client, session.UserID, session.ID)
	if err != nil {
		p.authorizationError(c, r, "access_denied")
		return
	}
	if slices.Contains(strings.Fields(r.Prompt), "consent") && !approved {
		c.Redirect(302, strings.TrimSuffix(p.issuer, basePath)+"/user/oidc?request="+url.QueryEscape(handle))
		return
	}
	raw := randomSecret()
	now := time.Now()
	err = p.database(c).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&models.OIDCRequest{}).Where("hash = ? AND consumed_at IS NULL AND expires_at > ?", r.Hash, now).Update("consumed_at", now)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errDenied
		}
		subject := models.OIDCSubject{Sub: randomSecret(), UserID: user.ID, UserCreatedAt: user.CreatedAt}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&subject).Error; err != nil {
			return err
		}
		subject = models.OIDCSubject{}
		if err := tx.Where("user_id = ? AND user_created_at = ?", user.ID, user.CreatedAt).Take(&subject).Error; err != nil {
			return err
		}
		code := models.OIDCCode{Hash: digest(raw), ClientID: client.ID, ClientRevision: client.Revision, RedirectURI: r.RedirectURI, UserID: user.ID, SessionID: current.ID, Sub: subject.Sub, Scope: r.Scope, Nonce: r.Nonce, Challenge: r.Challenge, AuthTime: current.LoginAt.Unix(), ExpiresAt: now.Add(time.Minute)}
		if err := tx.Create(&code).Error; err != nil {
			return err
		}
		return p.audit(tx, c, "authorize", client.ID, user.ID, true)
	})
	if err != nil {
		p.authorizationError(c, r, "temporarily_unavailable")
		return
	}
	p.redirect(c, r, url.Values{"code": {raw}})
}
func (p *Provider) interaction(c *gin.Context) {
	v, err := parameters(c)
	if err != nil {
		protocolError(c, 400, "invalid_request")
		return
	}
	r, client, err := p.loadRequest(c, v.Get("request"))
	if err != nil {
		protocolError(c, 400, "invalid_request")
		return
	}
	s, err := p.browserSession(c)
	if err != nil || needsLogin(r, s) {
		protocolError(c, 401, "login_required")
		return
	}
	if _, _, err := p.identity(p.database(c), client, s.UserID, s.ID); err != nil {
		protocolError(c, 403, "access_denied")
		return
	}
	c.JSON(200, gin.H{"name": client.Name, "scopes": strings.Fields(r.Scope), "claims": client.Claims})
}
func (p *Provider) approve(c *gin.Context) {
	if c.GetHeader("Authorization") != "" {
		protocolError(c, 400, "invalid_request")
		return
	}
	var input struct {
		Request string `json:"request"`
		Approve bool   `json:"approve"`
	}
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		protocolError(c, 400, "invalid_request")
		return
	}
	r, client, err := p.loadRequest(c, input.Request)
	if err != nil {
		protocolError(c, 400, "invalid_request")
		return
	}
	s, err := p.browserSession(c)
	if err != nil || needsLogin(r, s) {
		protocolError(c, 401, "login_required")
		return
	}
	if !input.Approve {
		now := time.Now()
		result := p.database(c).Model(&models.OIDCRequest{}).Where("hash = ? AND consumed_at IS NULL", r.Hash).Update("consumed_at", now)
		if result.Error != nil || result.RowsAffected != 1 {
			protocolError(c, 400, "invalid_request")
			return
		}
		// Fetch must not follow a protocol redirect to a relying party with CORS.
		u, _ := url.Parse(r.RedirectURI)
		q := u.Query()
		q.Set("error", "access_denied")
		if r.State != "" {
			q.Set("state", r.State)
		}
		q.Set("iss", p.issuer)
		u.RawQuery = q.Encode()
		_ = p.audit(p.database(c), c, "authorize.access_denied", client.ID, s.UserID, false)
		c.JSON(200, gin.H{"redirect": u.String()})
		return
	}
	// The frontend POST receives a destination, then performs top-level navigation.
	c.Set("oidc.redirect.json", true)
	p.advance(c, r, client, s, input.Request, true)
}
