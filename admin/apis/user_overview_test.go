package apis

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
)

func setupUserOverviewTest(t *testing.T, principal *models.User) (*gin.Engine, *gorm.DB, time.Time) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	previousIdentityKey := config.Cfg.Auth.IdentityKey
	config.Cfg.Auth.IdentityKey = "test-user-overview-identity"
	t.Cleanup(func() { config.Cfg.Auth.IdentityKey = previousIdentityKey })

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.UserSession{}))
	// The overview only reads id/created_at/deleted_at; keep the fixture
	// independent of the full user schema's hooks.
	require.NoError(t, db.Exec(`CREATE TABLE mss_boot_users (
		id varchar(64) primary key, created_at datetime, updated_at datetime, deleted_at datetime)`).Error)

	now := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	insertUser := func(id string, created time.Time, deleted bool) {
		var deletedAt any
		if deleted {
			deletedAt = now
		}
		require.NoError(t, db.Exec(
			"INSERT INTO mss_boot_users (id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?)",
			id, created, created, deletedAt).Error)
	}
	insertUser("old", now.Add(-30*24*time.Hour), false)
	insertUser("new-1", now.Add(-2*24*time.Hour), false)
	insertUser("new-2", now.Add(-time.Hour), false)
	insertUser("new-deleted", now.Add(-time.Hour), true)

	session := func(id, userID string, login time.Time, expired time.Time, revoked bool) {
		s := &models.UserSession{UserID: userID, LoginAt: login, LastSeenAt: login, ExpiredAt: expired, Revoked: revoked}
		s.ID = id
		require.NoError(t, db.Create(s).Error)
	}
	session("s1", "old", now.Add(-48*time.Hour), now.Add(-24*time.Hour), false) // expired
	session("s2", "old", now.Add(-10*time.Minute), now.Add(time.Hour), false)   // active, latest
	session("s3", "new-1", now.Add(-5*time.Minute), now.Add(time.Hour), true)   // revoked
	session("s4", "stranger", now.Add(-time.Minute), now.Add(time.Hour), false) // active, not requested

	api := &UserOverviewAPI{db: db, now: func() time.Time { return now }}
	r := gin.New()
	r.GET("/admin/api/user/overview", func(c *gin.Context) {
		if principal != nil {
			c.Set(config.Cfg.Auth.IdentityKey, principal)
		}
		c.Next()
	}, requireRootManagement, api.Overview)
	return r, db, now
}

func rootPrincipal() *models.User {
	return &models.User{UserLogin: models.UserLogin{RoleID: "root", Role: &models.Role{Root: true}}}
}

func TestUserOverviewAggregates(t *testing.T) {
	r, _, now := setupUserOverviewTest(t, rootPrincipal())
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/admin/api/user/overview?ids=old,new-1,old,missing", nil))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var body UserOverviewResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	require.Equal(t, int64(2), body.WeekNew, "soft-deleted and old users are excluded")
	require.Equal(t, int64(2), body.OnlineSessions, "expired and revoked sessions are excluded")
	require.Len(t, body.LastLogin, 2)
	require.True(t, body.LastLogin["old"].Equal(now.Add(-10*time.Minute)))
	require.True(t, body.LastLogin["new-1"].Equal(now.Add(-5*time.Minute)))
	_, leaked := body.LastLogin["stranger"]
	require.False(t, leaked, "only requested IDs are returned")
}

func TestUserOverviewRejectsTooManyIDs(t *testing.T) {
	r, _, _ := setupUserOverviewTest(t, rootPrincipal())
	ids := ""
	for i := 0; i <= maxUserOverviewIDs; i++ {
		ids += "u" + string(rune('a'+i%26)) + string(rune('a'+i/26)) + ","
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/admin/api/user/overview?ids="+ids, nil))
	require.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUserOverviewIsRootOnly(t *testing.T) {
	delegated := &models.User{UserLogin: models.UserLogin{RoleID: "delegated", Role: &models.Role{Root: false}}}
	for name, principal := range map[string]*models.User{"anonymous": nil, "delegated": delegated} {
		t.Run(name, func(t *testing.T) {
			r, _, _ := setupUserOverviewTest(t, principal)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/admin/api/user/overview", nil))
			require.Contains(t, []int{http.StatusUnauthorized, http.StatusForbidden}, w.Code)
			require.NotContains(t, w.Body.String(), "lastLogin")
		})
	}
}
