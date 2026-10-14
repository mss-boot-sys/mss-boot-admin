package middleware

import (
	"net"
	"net/http"
	"strings"
	"sync/atomic"

	"github.com/gin-gonic/gin"

	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
)

type loginClientIPResolver struct {
	trusted []*net.IPNet
	header  string
}

var loginClientIP atomic.Pointer[loginClientIPResolver]

// ConfigureLoginClientIP installs the dedicated client-IP rule used by the
// login rate limiter and login audit. An empty TrustedProxies list inherits
// fallback (application.trustedProxies). gin's global ClientIP is untouched.
func ConfigureLoginClientIP(cfg config.AdminLoginClientIP, fallback []string) error {
	entries := cfg.TrustedProxies
	if len(entries) == 0 {
		entries = fallback
	}
	trusted, err := config.ParseTrustedProxies(entries)
	if err != nil {
		return err
	}
	loginClientIP.Store(&loginClientIPResolver{
		trusted: trusted,
		header:  http.CanonicalHeaderKey(strings.TrimSpace(cfg.Header)),
	})
	return nil
}

// LoginClientIP returns the client address for login rate limiting and audit.
// Forwarding headers are honoured only when the direct peer is trusted;
// otherwise the peer address is returned, so a client cannot spoof its
// rate-limit bucket or audit IP.
func LoginClientIP(c *gin.Context) string {
	peer := peerIP(c.Request)
	resolver := loginClientIP.Load()
	if resolver == nil || peer == nil || !resolver.isTrusted(peer) {
		return ipString(peer, c.Request.RemoteAddr)
	}
	headers := []string{"X-Forwarded-For", "X-Real-Ip"}
	if resolver.header != "" {
		headers = []string{resolver.header}
	}
	for _, name := range headers {
		if ip := resolver.fromHeader(c.Request.Header.Get(name)); ip != nil {
			return ip.String()
		}
	}
	return peer.String()
}

func (r *loginClientIPResolver) isTrusted(ip net.IP) bool {
	for _, network := range r.trusted {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// fromHeader walks a comma-separated chain from the right and returns the
// first address that is not a trusted proxy (the nearest untrusted hop).
func (r *loginClientIPResolver) fromHeader(value string) net.IP {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	hops := strings.Split(value, ",")
	var last net.IP
	for index := len(hops) - 1; index >= 0; index-- {
		ip := net.ParseIP(strings.TrimSpace(hops[index]))
		if ip == nil {
			return nil
		}
		last = ip
		if !r.isTrusted(ip) {
			return ip
		}
	}
	return last
}

func peerIP(request *http.Request) net.IP {
	if request == nil {
		return nil
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(request.RemoteAddr))
	if err != nil {
		host = strings.TrimSpace(request.RemoteAddr)
	}
	return net.ParseIP(host)
}

func ipString(ip net.IP, fallback string) string {
	if ip != nil {
		return ip.String()
	}
	return fallback
}
