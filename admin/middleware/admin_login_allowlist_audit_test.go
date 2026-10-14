package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
	"github.com/mss-boot-sys/mss-boot-admin/admin/pkg"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/config/gormdb"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/security"
)

type deniedAllowlistVerifier struct {
	*models.User
}

func (deniedAllowlistVerifier) Verify(context.Context) (bool, security.Verifier, error) {
	return false, nil, &models.AdminLoginDeniedError{Provider: pkg.GithubLoginProvider, Subject: "42", Login: "intruder"}
}

func TestAllowlistDenialIsAuditedWithoutSecrets(t *testing.T) {
	database, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = database.AutoMigrate(&models.LoginLog{}); err != nil {
		t.Fatal(err)
	}
	previousDB := gormdb.DB
	gormdb.DB = database
	t.Cleanup(func() { gormdb.DB = previousDB })

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/callback", nil)
	verifier := deniedAllowlistVerifier{User: &models.User{UserLogin: models.UserLogin{
		Provider: pkg.GithubLoginProvider,
		Password: "provider-token-secret",
	}}}
	principal, err := AuthenticateVerifier(c, verifier)
	if principal != nil || !errors.Is(err, models.ErrAdminLoginNotAllowed) {
		t.Fatalf("AuthenticateVerifier() = %v, %v", principal, err)
	}
	var logs []models.LoginLog
	if err = database.Find(&logs).Error; err != nil {
		t.Fatal(err)
	}
	if len(logs) != 1 {
		t.Fatalf("login logs = %d, want 1", len(logs))
	}
	entry := logs[0]
	if entry.Username != "github:intruder" || !strings.Contains(entry.Message, "not in allowlist") ||
		!strings.Contains(entry.Message, "id 42") {
		t.Fatalf("audit entry = %+v", entry)
	}
	if strings.Contains(entry.Message+entry.Username, "provider-token-secret") {
		t.Fatalf("audit entry leaked provider token: %+v", entry)
	}
}
