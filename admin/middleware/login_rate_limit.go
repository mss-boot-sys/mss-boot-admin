package middleware

import (
	"errors"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"sync"

	"github.com/gin-gonic/gin"

	"github.com/mss-boot-sys/mss-boot-admin/admin/center"
	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
	"github.com/mss-boot-sys/mss-boot-admin/admin/service"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/keyedlimit"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/response"
)

var (
	loginLimiterMu sync.RWMutex
	loginLimiter   keyedlimit.KeyedLimiter
)

// SetLoginRateLimiter installs the KeyedLimiter used for Admin sign-in
// attempts. nil disables login rate limiting. Hosts running several replicas
// can install a shared-store implementation that passes limittest.Run.
func SetLoginRateLimiter(limiter keyedlimit.KeyedLimiter) {
	loginLimiterMu.Lock()
	loginLimiter = limiter
	loginLimiterMu.Unlock()
}

func currentLoginRateLimiter() keyedlimit.KeyedLimiter {
	loginLimiterMu.RLock()
	defer loginLimiterMu.RUnlock()
	return loginLimiter
}

// ConfigureLoginRateLimit installs the in-memory limiter from
// auth.adminLogin.rateLimit, or disables limiting when it is unset.
func ConfigureLoginRateLimit(cfg config.AdminLoginRateLimit) error {
	if !cfg.Enabled() {
		SetLoginRateLimiter(nil)
		return nil
	}
	limiter, err := keyedlimit.NewMemory(keyedlimit.Config{Limit: cfg.Limit, Window: cfg.Window})
	if err != nil {
		return err
	}
	SetLoginRateLimiter(limiter)
	return nil
}

// AdminLoginRateLimit limits sign-in attempts per client IP (LoginClientIP). Exceeding the
// budget returns 429 with Retry-After and writes a login audit record. It is
// a no-op when no limiter is installed (the default).
func AdminLoginRateLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		limiter := currentLoginRateLimiter()
		if limiter == nil {
			c.Next()
			return
		}
		decision, err := limiter.Allow(c.Request.Context(), "admin-login:ip:"+LoginClientIP(c))
		if err != nil {
			if errors.Is(err, c.Request.Context().Err()) {
				c.Abort()
				return
			}
			// Fail closed: an unavailable limiter must not open brute force.
			slog.Error("admin login rate limiter unavailable")
			response.Make(c).Err(http.StatusServiceUnavailable)
			c.Abort()
			return
		}
		if !decision.Allowed {
			seconds := int(math.Ceil(decision.RetryAfter.Seconds()))
			if seconds < 1 {
				seconds = 1
			}
			c.Header("Retry-After", strconv.Itoa(seconds))
			if logErr := service.Audit.LogLogin(center.Default.GetDB(c, nil), "", "", LoginClientIP(c),
				c.GetHeader("User-Agent"), "admin login rate limited", false); logErr != nil {
				slog.Warn("write login log failed")
			}
			response.Make(c).Err(http.StatusTooManyRequests)
			c.Abort()
			return
		}
		c.Next()
	}
}
