package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/config/gormdb"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/keyedlimit"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/keyedlimit/limittest"
)

type failingLimiter struct{}

func (failingLimiter) Allow(context.Context, string) (keyedlimit.Decision, error) {
	return keyedlimit.Decision{}, errors.New("store down")
}
func (failingLimiter) Reset(context.Context, string) error { return nil }

func loginRateLimitRouter(t *testing.T, limiter keyedlimit.KeyedLimiter) (*gin.Engine, *gorm.DB) {
	t.Helper()
	database, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = database.AutoMigrate(&models.LoginLog{}); err != nil {
		t.Fatal(err)
	}
	previousDB := gormdb.DB
	gormdb.DB = database
	SetLoginRateLimiter(limiter)
	t.Cleanup(func() {
		gormdb.DB = previousDB
		SetLoginRateLimiter(nil)
	})
	gin.SetMode(gin.TestMode)
	router := gin.New()
	if err = router.SetTrustedProxies(nil); err != nil {
		t.Fatal(err)
	}
	router.POST("/login", AdminLoginRateLimit(), func(c *gin.Context) { c.Status(http.StatusNoContent) })
	return router, database
}

func postLogin(router *gin.Engine, ip string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/login", nil)
	request.RemoteAddr = ip + ":40000"
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func TestAdminLoginRateLimitDisabledByDefault(t *testing.T) {
	if err := ConfigureLoginRateLimit(config.AdminLoginRateLimit{}); err != nil {
		t.Fatal(err)
	}
	router, _ := loginRateLimitRouter(t, nil)
	for i := 0; i < 50; i++ {
		if code := postLogin(router, "198.51.100.1").Code; code != http.StatusNoContent {
			t.Fatalf("attempt %d status = %d with limiting disabled", i, code)
		}
	}
}

func TestAdminLoginRateLimitReturns429PerIPAndAudits(t *testing.T) {
	clock := limittest.NewFakeClock()
	limiter, err := keyedlimit.NewMemory(keyedlimit.Config{Limit: 2, Window: time.Minute, Clock: clock})
	if err != nil {
		t.Fatal(err)
	}
	router, database := loginRateLimitRouter(t, limiter)
	for i := 0; i < 2; i++ {
		if code := postLogin(router, "198.51.100.1").Code; code != http.StatusNoContent {
			t.Fatalf("attempt %d status = %d", i, code)
		}
	}
	limited := postLogin(router, "198.51.100.1")
	if limited.Code != http.StatusTooManyRequests || limited.Header().Get("Retry-After") != "60" {
		t.Fatalf("limited status=%d retry-after=%q", limited.Code, limited.Header().Get("Retry-After"))
	}
	if code := postLogin(router, "198.51.100.2").Code; code != http.StatusNoContent {
		t.Fatalf("other IP status = %d", code)
	}
	var logs []models.LoginLog
	if err = database.Where("message = ?", "admin login rate limited").Find(&logs).Error; err != nil {
		t.Fatal(err)
	}
	if len(logs) != 1 || logs[0].IP != "198.51.100.1" {
		t.Fatalf("rate-limit audit = %+v", logs)
	}
	clock.Advance(time.Minute)
	if code := postLogin(router, "198.51.100.1").Code; code != http.StatusNoContent {
		t.Fatalf("after window status = %d", code)
	}
}

func TestAdminLoginRateLimitFailsClosedWhenStoreUnavailable(t *testing.T) {
	router, _ := loginRateLimitRouter(t, failingLimiter{})
	if code := postLogin(router, "198.51.100.1").Code; code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", code)
	}
}

func TestConfigureLoginRateLimitInstallsMemoryLimiter(t *testing.T) {
	t.Cleanup(func() { SetLoginRateLimiter(nil) })
	if err := ConfigureLoginRateLimit(config.AdminLoginRateLimit{Limit: 3, Window: time.Minute}); err != nil {
		t.Fatal(err)
	}
	if _, ok := currentLoginRateLimiter().(*keyedlimit.Memory); !ok {
		t.Fatalf("limiter = %T", currentLoginRateLimiter())
	}
	if err := ConfigureLoginRateLimit(config.AdminLoginRateLimit{Limit: -1, Window: time.Minute}); err == nil {
		t.Fatal("invalid config accepted")
	}
}
