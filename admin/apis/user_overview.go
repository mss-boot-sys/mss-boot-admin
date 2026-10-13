package apis

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/response"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/response/actions"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/response/controller"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"

	"github.com/mss-boot-sys/mss-boot-admin/admin/center"
	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
)

func init() {
	response.AppendController(&UserOverviewAPI{
		Simple: controller.NewSimple(
			controller.WithAuth(true),
			controller.WithModel(new(models.UserSession)),
			controller.WithModelProvider(actions.ModelProviderGorm),
		),
	})
}

// UserOverviewAPI serves read-only aggregates for the user management page.
// It derives everything from existing tables (users and user sessions), so no
// schema migration is required.
type UserOverviewAPI struct {
	*controller.Simple
	db  *gorm.DB
	now func() time.Time
}

const (
	maxUserOverviewIDs   = 100
	userOverviewNewSince = 7 * 24 * time.Hour
)

// UserOverviewResponse is the aggregate projection for the user list.
type UserOverviewResponse struct {
	// WeekNew counts users created in the trailing seven days.
	WeekNew int64 `json:"weekNew"`
	// OnlineSessions counts unrevoked, unexpired sessions.
	OnlineSessions int64 `json:"onlineSessions"`
	// LastLogin maps each requested user ID to its latest session login time.
	// Users that never logged in are omitted.
	LastLogin map[string]time.Time `json:"lastLogin"`
}

func (*UserOverviewAPI) GetAction(string) response.Action { return nil }

func (e *UserOverviewAPI) Other(r *gin.RouterGroup) {
	// Session evidence is root-only (see OnlineSessionAPI), so the aggregate
	// inherits the same guard.
	r.GET("/user/overview", response.AuthHandler, requireRootManagement, e.Overview)
}

func (e *UserOverviewAPI) getDB(c *gin.Context, model schema.Tabler) *gorm.DB {
	if e.db != nil {
		return e.db.Model(model)
	}
	return center.Default.GetDB(c, model).Model(model)
}

func (e *UserOverviewAPI) clock() time.Time {
	if e.now != nil {
		return e.now()
	}
	return time.Now()
}

// Overview 用户列表聚合信息（本周新增、在线会话、最近登录）
// @Summary 用户列表聚合信息
// @Tags user
// @Produce json
// @Param ids query string false "逗号分隔的用户ID，最多100个"
// @Success 200 {object} UserOverviewResponse
// @Failure 400 {object} response.Response
// @Failure 403 {object} response.Response
// @Router /admin/api/user/overview [get]
// @Security Bearer
func (e *UserOverviewAPI) Overview(c *gin.Context) {
	api := response.Make(c)
	ids := make([]string, 0)
	seen := map[string]struct{}{}
	for _, id := range strings.Split(c.Query("ids"), ",") {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) > maxUserOverviewIDs {
		api.AddError(errors.New("too many ids")).Err(http.StatusBadRequest)
		return
	}
	now := e.clock()
	out := UserOverviewResponse{LastLogin: map[string]time.Time{}}
	if err := e.getDB(c, &models.User{}).
		Where("created_at >= ?", now.Add(-userOverviewNewSince)).
		Count(&out.WeekNew).Error; err != nil {
		api.AddError(err).Err(http.StatusInternalServerError)
		return
	}
	if err := e.getDB(c, &models.UserSession{}).
		Where("revoked = ? AND expired_at > ?", false, now).
		Count(&out.OnlineSessions).Error; err != nil {
		api.AddError(err).Err(http.StatusInternalServerError)
		return
	}
	if len(ids) > 0 {
		rows, err := e.getDB(c, &models.UserSession{}).
			Select("user_id, MAX(login_at) AS login_at").
			Where("user_id IN ?", ids).
			Group("user_id").
			Rows()
		if err != nil {
			api.AddError(err).Err(http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		for rows.Next() {
			var userID string
			var loginAt any
			if err := rows.Scan(&userID, &loginAt); err != nil {
				api.AddError(err).Err(http.StatusInternalServerError)
				return
			}
			if t, ok := parseAggregateTime(loginAt); ok {
				out.LastLogin[userID] = t
			}
		}
		if err := rows.Err(); err != nil {
			api.AddError(err).Err(http.StatusInternalServerError)
			return
		}
	}
	api.OK(out)
}

// parseAggregateTime accepts the textual forms MAX() returns across SQLite,
// MySQL and PostgreSQL drivers.
func parseAggregateTime(raw any) (time.Time, bool) {
	var value string
	switch v := raw.(type) {
	case time.Time:
		return v, !v.IsZero()
	case []byte:
		value = string(v)
	case string:
		value = v
	default:
		return time.Time{}, false
	}
	for _, layout := range []string{
		time.RFC3339Nano,
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05.999999999Z07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05",
	} {
		if t, err := time.Parse(layout, value); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}
