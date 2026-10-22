package apis

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/config/gormdb"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/response"
)

func TestUserControllerEnforcesManagedUsernameWritesAndPreservesLegacyIdentity(t *testing.T) {
	db := openUserIdentityWriteTestDB(t)
	if err := db.AutoMigrate(&models.Role{}, &models.User{}, &models.Statistics{}); err != nil {
		t.Fatal(err)
	}
	legacy := "e2erestricted0123456789"
	if err := db.Exec("INSERT INTO mss_boot_users (id, username, name) VALUES (?, ?, ?)", "legacy", legacy, "Before").Error; err != nil {
		t.Fatal(err)
	}
	previousDB, previousAuth, previousIdentityKey := gormdb.DB, response.AuthHandler, config.Cfg.Auth.IdentityKey
	gormdb.DB = db
	config.Cfg.Auth.IdentityKey = "test-managed-username"
	principal := &models.User{UserLogin: models.UserLogin{Role: &models.Role{Root: true}}}
	principal.ID = "root"
	response.AuthHandler = func(ctx *gin.Context) {
		ctx.Set(config.Cfg.Auth.IdentityKey, principal)
		ctx.Next()
	}
	t.Cleanup(func() {
		gormdb.DB, response.AuthHandler, config.Cfg.Auth.IdentityKey = previousDB, previousAuth, previousIdentityKey
	})
	controller := newUserController()
	control := controller.GetAction(response.Control)
	gin.SetMode(gin.TestMode)
	router := gin.New()
	routes := router.Group("/admin/api/users", controller.Handlers()...)
	routes.POST("", control.Handler()...)
	routes.PUT("/:id", control.Handler()...)
	write := func(method, path string, values map[string]any) *httptest.ResponseRecorder {
		t.Helper()
		body, err := json.Marshal(values)
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(method, path, bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		result := httptest.NewRecorder()
		router.ServeHTTP(result, request)
		return result
	}
	for _, username := range []string{"", "ab", strings.Repeat("a", 21), "has-hyphen", "用户名", "space name"} {
		for _, method := range []string{http.MethodPost, http.MethodPut} {
			path := "/admin/api/users"
			if method == http.MethodPut {
				path += "/legacy"
			}
			result := write(method, path, map[string]any{"username": username, "name": "Rejected"})
			if result.Code != http.StatusUnprocessableEntity || !strings.Contains(result.Body.String(), "INVALID_USERNAME") {
				t.Errorf("%s invalid username %q = %d: %s", method, username, result.Code, result.Body.String())
			}
		}
	}
	var count int64
	if err := db.Model(&models.User{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("rejected creates changed persisted users: count=%d, err=%v", count, err)
	}
	var unchanged models.User
	if err := db.First(&unchanged, "id = ?", "legacy").Error; err != nil || unchanged.Name != "Before" || unchanged.Username != legacy {
		t.Fatalf("rejected update changed persisted user: username=%q name=%q err=%v", unchanged.Username, unchanged.Name, err)
	}
	for _, body := range []map[string]any{
		{"name": "Profile only"},
		{"username": legacy, "name": "Legacy unchanged", "status": "disabled"},
	} {
		result := write(http.MethodPut, "/admin/api/users/legacy", body)
		if result.Code != http.StatusOK {
			t.Fatalf("legacy maintenance = %d: %s", result.Code, result.Body.String())
		}
		var user models.User
		if err := db.First(&user, "id = ?", "legacy").Error; err != nil || user.Username != legacy || user.Name != body["name"] {
			t.Fatalf("legacy identity was altered or profile not saved: username=%q name=%q err=%v response=%s", user.Username, user.Name, err, result.Body.String())
		}
	}
	for _, username := range []string{"abc", strings.Repeat("a", 20)} {
		result := write(http.MethodPost, "/admin/api/users", map[string]any{"username": username, "password": "Testing123!"})
		if result.Code != http.StatusCreated {
			t.Fatalf("boundary create = %d: %s", result.Code, result.Body.String())
		}
	}
	result := write(http.MethodPut, "/admin/api/users/legacy", map[string]any{"username": "renamed_legacy"})
	if result.Code != http.StatusOK {
		t.Fatalf("valid legacy rename = %d: %s", result.Code, result.Body.String())
	}
	var renamed models.User
	if err := db.First(&renamed, "id = ?", "legacy").Error; err != nil || renamed.Username != "renamed_legacy" {
		t.Fatalf("rename was not persisted: username=%q err=%v", renamed.Username, err)
	}
}
