package business

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"github.com/mss-boot-sys/mss-boot-admin/admin/business/audit"
	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
	"github.com/mss-boot-sys/mss-boot-admin/admin/pkg/browsersecurity"
)

// SurfaceRouteCategory is a closed set. A module cannot introduce a new
// category; every route must declare exactly one of these values.
type SurfaceRouteCategory string

const (
	// SurfaceRoutePublic skips the SurfaceAuthenticator. It must be declared
	// explicitly in the surface contract (for example sign-in or health).
	SurfaceRoutePublic SurfaceRouteCategory = "public"
	// SurfaceRouteAuthenticated requires a principal whose audience equals the
	// surface name. It is the only non-public category.
	SurfaceRouteAuthenticated SurfaceRouteCategory = "authenticated"
)

// SurfaceCredentialKind names how a SurfaceAuthenticator actually
// authenticated the request. The core uses it, not the shape of request
// headers, to decide whether browser CSRF protection applies.
type SurfaceCredentialKind string

const (
	// SurfaceCredentialBearer means the credential was an explicit bearer
	// token the client attached itself (not an ambient browser credential).
	SurfaceCredentialBearer SurfaceCredentialKind = "bearer"
	// SurfaceCredentialCookie means the credential was a cookie the browser
	// attaches automatically; unsafe requests are subject to CSRF checks.
	SurfaceCredentialCookie SurfaceCredentialKind = "cookie"
)

// SurfacePrincipal is the identity a SurfaceAuthenticator resolved. The core,
// not the module, decides whether Audience and Issuer are acceptable.
// Credential is required; any value other than bearer or cookie yields 401.
type SurfacePrincipal struct {
	Subject    string
	Issuer     string
	Audience   []string
	Credential SurfaceCredentialKind
}

// SurfaceRequest is the read-only view of an incoming request handed to a
// SurfaceAuthenticator. It deliberately exposes no response writer and no way
// to advance, abort or otherwise steer the handler chain, and no request body.
// Every accessor returns a copy.
type SurfaceRequest struct {
	request  *http.Request
	remoteIP string
}

func newSurfaceRequest(c *gin.Context) SurfaceRequest {
	return SurfaceRequest{request: c.Request, remoteIP: c.ClientIP()}
}

// NewSurfaceRequest builds a SurfaceRequest for tests of module authenticators.
func NewSurfaceRequest(request *http.Request, remoteIP string) SurfaceRequest {
	return SurfaceRequest{request: request, remoteIP: remoteIP}
}

// Context returns the request context (never the gin context).
func (r SurfaceRequest) Context() context.Context {
	if r.request == nil {
		return context.Background()
	}
	return r.request.Context()
}

// Method returns the HTTP method.
func (r SurfaceRequest) Method() string {
	if r.request == nil {
		return ""
	}
	return r.request.Method
}

// URL returns a copy of the request URL.
func (r SurfaceRequest) URL() *url.URL {
	if r.request == nil || r.request.URL == nil {
		return &url.URL{}
	}
	clone := *r.request.URL
	if r.request.URL.User != nil {
		user := *r.request.URL.User
		clone.User = &user
	}
	return &clone
}

// Header returns the first value of the named request header.
func (r SurfaceRequest) Header(name string) string {
	if r.request == nil {
		return ""
	}
	return r.request.Header.Get(name)
}

// Headers returns a copy of all request headers.
func (r SurfaceRequest) Headers() http.Header {
	if r.request == nil {
		return http.Header{}
	}
	return r.request.Header.Clone()
}

// Cookie returns a copy of the named request cookie.
func (r SurfaceRequest) Cookie(name string) (*http.Cookie, error) {
	if r.request == nil {
		return nil, http.ErrNoCookie
	}
	cookie, err := r.request.Cookie(name)
	if err != nil {
		return nil, err
	}
	clone := *cookie
	return &clone, nil
}

// Cookies returns copies of all request cookies.
func (r SurfaceRequest) Cookies() []*http.Cookie {
	if r.request == nil {
		return nil
	}
	cookies := r.request.Cookies()
	out := make([]*http.Cookie, 0, len(cookies))
	for _, cookie := range cookies {
		clone := *cookie
		out = append(out, &clone)
	}
	return out
}

// RemoteIP returns the client IP as resolved by the engine's trusted proxies.
func (r SurfaceRequest) RemoteIP() string { return r.remoteIP }

// SurfaceAuthenticator is implemented by the module and invoked by the core.
// It receives a read-only SurfaceRequest, so it cannot write a response or
// run later handlers; returning an error yields 401.
type SurfaceAuthenticator interface {
	Authenticate(SurfaceRequest) (SurfacePrincipal, error)
}

// SurfaceAuthenticatorFunc adapts a function to SurfaceAuthenticator.
type SurfaceAuthenticatorFunc func(SurfaceRequest) (SurfacePrincipal, error)

// Authenticate implements SurfaceAuthenticator.
func (f SurfaceAuthenticatorFunc) Authenticate(request SurfaceRequest) (SurfacePrincipal, error) {
	return f(request)
}

// SurfaceCORS is independent of the Admin CORS configuration. An empty
// AllowOrigins denies every cross-origin request.
type SurfaceCORS struct {
	AllowOrigins []string
	AllowHeaders []string
	MaxAge       time.Duration
}

// SurfaceRoute is declared, not mounted, by the module. Modules never receive
// a *gin.RouterGroup for a surface, so they cannot attach handlers outside the
// core chain.
type SurfaceRoute struct {
	Method   string
	Path     string
	Category SurfaceRouteCategory
	Handlers []gin.HandlerFunc
}

// SurfaceRegistration declares one non-Admin API surface served at
// /<Name>/api. The surface name is also the only accepted token audience.
type SurfaceRegistration struct {
	Name          string
	Issuer        string
	Authenticator SurfaceAuthenticator
	CORS          SurfaceCORS
	// CSRF opts the surface into core double-submit CSRF tokens for
	// cookie-based sessions. Nil keeps the exact-Origin check only.
	CSRF *SurfaceCSRF
	// Middleware runs after authentication and CSRF, immediately before the
	// route handlers. It cannot replace or reorder the core chain.
	Middleware []gin.HandlerFunc
	Routes     []SurfaceRoute
}

// SurfacePrincipalKey is the gin context key holding the verified principal.
const SurfacePrincipalKey = "mss.surface.principal"

// SurfacePrincipalFrom returns the principal verified by the core chain.
func SurfacePrincipalFrom(c *gin.Context) (SurfacePrincipal, bool) {
	value, ok := c.Get(SurfacePrincipalKey)
	if !ok {
		return SurfacePrincipal{}, false
	}
	principal, ok := value.(SurfacePrincipal)
	return principal, ok
}

var surfaceNamePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,30}[a-z0-9]$`)

// reservedSurfaceNames overlap Admin, OIDC, documentation, static assets, or
// the SPA fallback and can never be used as a surface.
var reservedSurfaceNames = map[string]struct{}{
	"admin": {}, "api": {}, "oidc": {}, ".well-known": {}, "swagger": {},
	"static": {}, "assets": {}, "public": {}, "docs": {}, "ws": {},
	"healthz": {}, "readyz": {}, "metrics": {}, "favicon.ico": {},
}

var allowedSurfaceMethods = map[string]struct{}{
	http.MethodGet: {}, http.MethodPost: {}, http.MethodPut: {},
	http.MethodPatch: {}, http.MethodDelete: {},
}

func validateSurface(surface SurfaceRegistration) error {
	name := surface.Name
	if !surfaceNamePattern.MatchString(name) {
		return fmt.Errorf("surface name %q must match %s", name, surfaceNamePattern)
	}
	if _, reserved := reservedSurfaceNames[name]; reserved {
		return fmt.Errorf("surface name %q is reserved", name)
	}
	if nilInterface(surface.Authenticator) {
		return fmt.Errorf("surface %s authenticator is required", name)
	}
	if strings.TrimSpace(surface.Issuer) == "" {
		return fmt.Errorf("surface %s issuer is required", name)
	}
	if len(surface.Routes) == 0 {
		return fmt.Errorf("surface %s must declare at least one route", name)
	}
	for _, origin := range surface.CORS.AllowOrigins {
		if _, ok := browsersecurity.NormalizeOrigin(origin); !ok {
			return fmt.Errorf("surface %s CORS origin %q is not an exact http(s) origin", name, origin)
		}
	}
	if surface.CSRF != nil {
		if err := validateSurfaceCSRF(*surface.CSRF); err != nil {
			return fmt.Errorf("surface %s: %w", name, err)
		}
	}
	for index, handler := range surface.Middleware {
		if handler == nil {
			return fmt.Errorf("surface %s middleware %d is nil", name, index)
		}
	}
	seen := map[string]struct{}{}
	for _, route := range surface.Routes {
		if _, ok := allowedSurfaceMethods[route.Method]; !ok {
			return fmt.Errorf("surface %s route %s %s uses an unsupported method", name, route.Method, route.Path)
		}
		if route.Path != "" && (!strings.HasPrefix(route.Path, "/") || strings.Contains(route.Path, "..")) {
			return fmt.Errorf("surface %s route path %q must be relative to /%s/api and start with /", name, route.Path, name)
		}
		switch route.Category {
		case SurfaceRoutePublic, SurfaceRouteAuthenticated:
		default:
			return fmt.Errorf("surface %s route %s %s has unknown category %q", name, route.Method, route.Path, route.Category)
		}
		if len(route.Handlers) == 0 {
			return fmt.Errorf("surface %s route %s %s has no handler", name, route.Method, route.Path)
		}
		for _, handler := range route.Handlers {
			if handler == nil {
				return fmt.Errorf("surface %s route %s %s has a nil handler", name, route.Method, route.Path)
			}
		}
		key := route.Method + " " + route.Path
		if _, dup := seen[key]; dup {
			return fmt.Errorf("surface %s route %s is declared twice", name, key)
		}
		seen[key] = struct{}{}
	}
	return nil
}

func cloneSurface(surface SurfaceRegistration) SurfaceRegistration {
	clone := surface
	clone.CORS.AllowOrigins = browsersecurity.TrustedOrigins(surface.CORS.AllowOrigins)
	clone.CORS.AllowHeaders = append([]string(nil), surface.CORS.AllowHeaders...)
	if surface.CSRF != nil {
		csrf := *surface.CSRF
		csrf.Key = append([]byte(nil), surface.CSRF.Key...)
		clone.CSRF = &csrf
	}
	clone.Middleware = append([]gin.HandlerFunc(nil), surface.Middleware...)
	clone.Routes = make([]SurfaceRoute, len(surface.Routes))
	for index, route := range surface.Routes {
		clone.Routes[index] = route
		clone.Routes[index].Handlers = append([]gin.HandlerFunc(nil), route.Handlers...)
	}
	return clone
}

// Surfaces returns the registered surface names in composition order.
func (r *Registry) Surfaces() []string {
	if r == nil || r.transactionView() {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := []string{}
	for _, registered := range r.entries {
		for _, surface := range registered.surfaces {
			names = append(names, surface.Name)
		}
	}
	return names
}

// MountSurfaces mounts every registered surface at /<name>/api on root with
// the non-replaceable core chain:
//
//	per-surface CORS -> SurfaceAuthenticator (aud == name, iss == Issuer)
//	-> CSRF (exact Origin) -> module middleware -> route handlers
//
// It must be called on the engine root after the Admin routes and before the
// SPA fallback. It returns the number of mounted surfaces.
func (r *Registry) MountSurfaces(root gin.IRouter, sink audit.Sink) (int, error) {
	if r == nil {
		return 0, errors.New("business module registry is required")
	}
	if r.transactionView() {
		return 0, r.rejectTransactionLifecycle("MountSurfaces")
	}
	if root == nil {
		return 0, errors.New("surface root router is required")
	}
	r.mu.RLock()
	if !r.frozen {
		r.mu.RUnlock()
		return 0, ErrRegistryNotFrozen
	}
	entries := append([]entry(nil), r.entries...)
	r.mu.RUnlock()
	sink = audit.Redacting(sink)
	mounted := 0
	for _, registered := range entries {
		for _, surface := range registered.surfaces {
			if surface.CSRF != nil && surfaceCSRFKeyIsAdminKey(surface.CSRF.Key) {
				return mounted, fmt.Errorf("surface %s: %w", surface.Name, errSurfaceCSRFAdminKey)
			}
		}
	}
	for _, registered := range entries {
		for _, surface := range registered.surfaces {
			mountSurface(root, surface, sink)
			mounted++
		}
	}
	if mounted > 0 {
		// Mounting any surface forces strict Admin audience for every caller
		// (server wrapper, embedded hosts, tests), so a surface token or a
		// legacy token without aud can never authenticate an Admin API.
		config.Cfg.Auth.RequireAdminAudience = true
	}
	return mounted, nil
}

func mountSurface(root gin.IRouter, surface SurfaceRegistration, sink audit.Sink) {
	group := root.Group("/" + surface.Name + "/api")
	group.Use(surfaceCORS(surface.CORS, surfaceCSRFHeaderFor(surface.CSRF)))
	group.Use(func(c *gin.Context) {
		c.Set(surfaceAuditKey, surfaceAudit{surface: surface.Name, sink: sink})
		if surface.CSRF != nil {
			c.Set(surfaceCSRFKey, surfaceCSRFScope{surface: surface.Name, options: *surface.CSRF})
		}
		c.Next()
	})
	group.OPTIONS("/*path", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	for _, route := range surface.Routes {
		chain := make([]gin.HandlerFunc, 0, 3+len(surface.Middleware)+len(route.Handlers))
		if route.Category == SurfaceRouteAuthenticated {
			chain = append(chain, surfaceAuthentication(surface))
		}
		chain = append(chain, surfaceCSRFCheck(surface))
		chain = append(chain, surface.Middleware...)
		chain = append(chain, route.Handlers...)
		group.Handle(route.Method, route.Path, chain...)
	}
}

func surfaceCORS(policy SurfaceCORS, csrfHeader string) gin.HandlerFunc {
	configCors := cors.DefaultConfig()
	configCors.AllowOrigins = append([]string(nil), policy.AllowOrigins...)
	if len(configCors.AllowOrigins) == 0 {
		configCors.AllowOriginFunc = func(string) bool { return false }
	}
	configCors.AllowCredentials = true
	if len(policy.AllowHeaders) > 0 {
		configCors.AllowHeaders = append([]string(nil), policy.AllowHeaders...)
	} else {
		configCors.AddAllowHeaders("Authorization")
	}
	if csrfHeader != "" && !surfaceHeaderListed(configCors.AllowHeaders, csrfHeader) {
		// Cross-origin unsafe requests carry the double-submit header; without
		// it the browser preflight fails before the core can verify the token.
		configCors.AddAllowHeaders(csrfHeader)
	}
	if policy.MaxAge > 0 {
		configCors.MaxAge = policy.MaxAge
	}
	return cors.New(configCors)
}

func surfaceHeaderListed(headers []string, name string) bool {
	for _, header := range headers {
		if strings.EqualFold(strings.TrimSpace(header), name) {
			return true
		}
	}
	return false
}

func abortSurface(c *gin.Context, status int, message string) {
	c.AbortWithStatusJSON(status, gin.H{"code": status, "msg": message})
}

func surfaceAuthentication(surface SurfaceRegistration) gin.HandlerFunc {
	return func(c *gin.Context) {
		principal, err := surface.Authenticator.Authenticate(newSurfaceRequest(c))
		if err != nil || !surfaceCredentialKnown(principal.Credential) || !surfaceAudienceAccepted(principal, surface) {
			abortSurface(c, http.StatusUnauthorized, "unauthorized")
			return
		}
		principal.Audience = append([]string(nil), principal.Audience...)
		c.Set(SurfacePrincipalKey, principal)
		c.Next()
	}
}

func surfaceCredentialKnown(kind SurfaceCredentialKind) bool {
	return kind == SurfaceCredentialBearer || kind == SurfaceCredentialCookie
}

// surfaceAudienceAccepted requires aud to contain exactly the surface name and
// nothing else, and iss to equal the surface issuer. Comparisons are
// constant-time so no oracle about either value leaks.
func surfaceAudienceAccepted(principal SurfacePrincipal, surface SurfaceRegistration) bool {
	if strings.TrimSpace(principal.Subject) == "" || len(principal.Audience) != 1 {
		return false
	}
	audOK := subtle.ConstantTimeCompare([]byte(principal.Audience[0]), []byte(surface.Name))
	issOK := subtle.ConstantTimeCompare([]byte(principal.Issuer), []byte(surface.Issuer))
	return audOK&issOK == 1
}

func surfaceUnsafeMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	default:
		return true
	}
}

const surfaceAuditKey = "mss.surface.audit"

type surfaceAudit struct {
	surface string
	sink    audit.Sink
}

// ErrNoSurfaceAudit is returned when RecordSurfaceEvent is called outside a
// surface request.
var ErrNoSurfaceAudit = errors.New("request is not served by a business surface")

// RecordSurfaceEvent writes a redacted audit event for the current surface
// request. The core fills Surface, IP, UserAgent and RequestID and, when the
// request was authenticated, ActorID; a module cannot attribute an event to
// another surface or another actor.
func RecordSurfaceEvent(c *gin.Context, e audit.Event) error {
	value, ok := c.Get(surfaceAuditKey)
	if !ok {
		return ErrNoSurfaceAudit
	}
	scope, ok := value.(surfaceAudit)
	if !ok {
		return ErrNoSurfaceAudit
	}
	e.Surface = scope.surface
	e.IP = c.ClientIP()
	e.UserAgent = c.Request.UserAgent()
	if requestID := c.GetHeader("X-Request-Id"); requestID != "" {
		e.RequestID = requestID
	}
	if principal, ok := SurfacePrincipalFrom(c); ok {
		e.ActorKind = scope.surface
		e.ActorID = principal.Subject
	}
	return scope.sink.Record(c.Request.Context(), e)
}
