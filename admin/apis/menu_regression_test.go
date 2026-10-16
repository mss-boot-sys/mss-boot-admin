package apis

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
	"github.com/mss-boot-sys/mss-boot-admin/admin/pkg"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/enum"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/response"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func menuRegressionRecord(id, parent, name string, kind pkg.AccessType) models.Menu {
	menu := models.Menu{ParentID: parent, Name: name, Path: "/" + id, Method: "GET", Type: kind, Status: enum.Enabled}
	menu.ID = id
	return menu
}

func TestMenuListSearchKeepsAncestorsAndPaginatesBranches(t *testing.T) {
	db := setupRoleAuthorizationAPITest(t)
	menus := []models.Menu{
		menuRegressionRecord("a", "", "menu.business", pkg.DirectoryAccessType),
		menuRegressionRecord("a-users", "a", "users", pkg.MenuAccessType),
		menuRegressionRecord("a-other", "a", "other", pkg.MenuAccessType),
		menuRegressionRecord("b", "", "menu.system", pkg.DirectoryAccessType),
		menuRegressionRecord("b-users", "b", "users", pkg.MenuAccessType),
	}
	menus[1].Status = enum.Disabled
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&menus).Error)
	for _, tc := range []struct {
		query string
		total int64
		roots []string
		child string
	}{
		{"name=users&pageSize=1", 2, []string{"a"}, "a-users"},
		{"name=users&pageSize=1&current=2", 2, []string{"b"}, "b-users"},
		{"name=users&pageSize=1&current=3", 2, nil, ""},
		{"name=users&status=disabled", 1, []string{"a"}, "a-users"},
		{"name=用户&nameKeys[]=menu.business.users", 1, []string{"a"}, "a-users"},
		{"name=users&parentID=a", 1, []string{"a-users"}, ""},
		{"name=用户&nameKeys[]=menu.business.users&parentID=a", 1, []string{"a-users"}, ""},
	} {
		t.Run(tc.query, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodGet, "/admin/api/menus?"+tc.query, nil)
			(&Menu{}).List(ctx)
			require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
			var page struct {
				Data  []*models.Menu `json:"data"`
				Total int64          `json:"total"`
			}
			require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &page))
			require.Equal(t, tc.total, page.Total)
			require.Len(t, page.Data, len(tc.roots))
			for index, id := range tc.roots {
				require.Equal(t, id, page.Data[index].ID)
			}
			if tc.child != "" {
				require.Len(t, page.Data[0].Children, 1)
				require.Equal(t, tc.child, page.Data[0].Children[0].ID)
			}
		})
	}
}

func TestMenuListAndSelectorIncludeDeepNodesAndRecoverLegacyDamage(t *testing.T) {
	db := setupRoleAuthorizationAPITest(t)
	parent := ""
	for i := 0; i < 7; i++ {
		menu := menuRegressionRecord(fmt.Sprint(i), parent, fmt.Sprintf("menu.business.level%d", i), pkg.DirectoryAccessType)
		require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&menu).Error)
		parent = menu.ID
	}
	orphan := menuRegressionRecord("orphan", "missing", "orphan", pkg.MenuAccessType)
	a := menuRegressionRecord("a", "b", "a", pkg.DirectoryAccessType)
	b := menuRegressionRecord("b", "a", "b", pkg.DirectoryAccessType)
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&[]models.Menu{orphan, a, b}).Error)
	for _, handler := range []gin.HandlerFunc{(&Menu{}).List, (&Menu{}).Tree} {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/menus", nil)
		handler(ctx)
		require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
		require.Contains(t, recorder.Body.String(), `"id":"6"`)
		require.Contains(t, recorder.Body.String(), `"id":"orphan"`)
		require.Contains(t, recorder.Body.String(), `"id":"a"`)
	}
	projection := menuAuthorizeProjectionResponse(roleAuthorizationPrincipal(true))
	require.Equal(t, http.StatusOK, projection.Code, projection.Body.String())
	require.NotContains(t, projection.Body.String(), `"id":"orphan"`)
	require.NotContains(t, projection.Body.String(), `"id":"a"`)
}

func TestMenuRegisteredWriteGuardsAndConflictContract(t *testing.T) {
	db := setupRoleAuthorizationAPITest(t)
	root := menuRegressionRecord("root", "", "menu.business", pkg.DirectoryAccessType)
	page := menuRegressionRecord("page", "root", "menu.business.page", pkg.MenuAccessType)
	other := menuRegressionRecord("other", "", "menu.other", pkg.DirectoryAccessType)
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&[]models.Menu{root, page, other}).Error)
	require.NoError(t, db.Create(&models.CasbinRule{PType: "p", V0: "role-business", V1: "MENU", V2: "/page", V3: "GET"}).Error)
	oldAuth := response.AuthHandler
	response.AuthHandler = func(ctx *gin.Context) {
		if actor := ctx.GetHeader("Test-Actor"); actor != "" {
			ctx.Set(config.Cfg.Auth.IdentityKey, roleAuthorizationPrincipal(actor == "root"))
		}
		ctx.Next()
	}
	t.Cleanup(func() { response.AuthHandler = oldAuth })
	var controller *Menu
	for _, candidate := range response.Controllers {
		if menu, ok := candidate.(*Menu); ok {
			controller = menu
			break
		}
	}
	require.NotNil(t, controller)
	router := gin.New()
	router.POST("/menus", controller.GetAction(response.Control).Handler()...)
	router.PUT("/menus/:id", controller.GetAction(response.Control).Handler()...)
	router.DELETE("/menus/:id", controller.GetAction(response.Delete).Handler()...)
	for _, tc := range []struct {
		method, path, actor, body string
		status                    int
		code                      string
	}{
		{"PUT", "/menus/page", "", `{}`, 401, ""},
		{"PUT", "/menus/page", "delegated", `{}`, 403, ""},
		{"POST", "/menus", "root", `{"name":"orphan","path":"/orphan","type":"MENU","parentID":"missing"}`, 422, "MENU_HIERARCHY_INVALID"},
		{"PUT", "/menus/other", "root", `{"parentID":"other"}`, 422, "MENU_HIERARCHY_INVALID"},
		{"PUT", "/menus/page", "root", `{"parentID":"other"}`, 409, "MENU_AUTHORIZATION_IN_USE"},
		{"DELETE", "/menus/root", "root", ``, 409, "MENU_AUTHORIZATION_IN_USE"},
		{"PUT", "/menus/page", "root", `{"name":"renamed"}`, 200, ""},
		{"POST", "/menus", "root", `{"name":"new","path":"/new","type":"MENU","parentID":"other"}`, 201, ""},
	} {
		t.Run(tc.method+tc.path+tc.actor+tc.body, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, tc.path, bytes.NewBufferString(tc.body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Test-Actor", tc.actor)
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)
			require.Equal(t, tc.status, recorder.Code, recorder.Body.String())
			if tc.code != "" {
				require.Contains(t, recorder.Body.String(), tc.code)
			}
			if tc.code == "MENU_AUTHORIZATION_IN_USE" {
				require.Contains(t, recorder.Body.String(), "role-business")
			}
		})
	}
	var saved models.Menu
	require.NoError(t, db.First(&saved, "id = ?", page.ID).Error)
	require.Equal(t, root.ID, saved.ParentID)
	var policies int64
	require.NoError(t, db.Model(&models.CasbinRule{}).Count(&policies).Error)
	require.Equal(t, int64(1), policies)
}

func TestMenuLayoutNameKeepsNestedLocaleNamespace(t *testing.T) {
	menus := []*models.Menu{{Name: "menu.business.review0", Children: []*models.Menu{{Name: "menu.business.review0.detail"}, {Name: "自定义菜单"}, {Name: "Unknown.custom"}}}}
	normalizeMenuNameForLayout(menus)
	require.Equal(t, "business.review0", menus[0].Name)
	require.Equal(t, "business.review0.detail", menus[0].Children[0].Name)
	require.Equal(t, "自定义菜单", menus[0].Children[1].Name)
	require.Equal(t, "Unknown.custom", menus[0].Children[2].Name)
}

func TestMenuDeleteLegacyCycleTerminates(t *testing.T) {
	db := setupRoleAuthorizationAPITest(t)
	a := menuRegressionRecord("a", "b", "a", pkg.DirectoryAccessType)
	b := menuRegressionRecord("b", "a", "b", pkg.DirectoryAccessType)
	child := menuRegressionRecord("child", "b", "child", pkg.MenuAccessType)
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&[]models.Menu{a, b, child}).Error)
	oldAuth := response.AuthHandler
	response.AuthHandler = func(ctx *gin.Context) {
		ctx.Set(config.Cfg.Auth.IdentityKey, roleAuthorizationPrincipal(true))
		ctx.Next()
	}
	t.Cleanup(func() { response.AuthHandler = oldAuth })
	router := gin.New()
	for _, candidate := range response.Controllers {
		if menu, ok := candidate.(*Menu); ok {
			router.DELETE("/menus/:id", menu.GetAction(response.Delete).Handler()...)
			break
		}
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodDelete, "/menus/a", nil))
	require.Equal(t, http.StatusNoContent, recorder.Code, recorder.Body.String())
	var count int64
	require.NoError(t, db.Model(&models.Menu{}).Count(&count).Error)
	require.Zero(t, count)
}

// database/sql can retain a query context after its handler returns. Inspect
// statements too, so detecting pooled contexts does not depend on scheduling.
func TestMenuDatabaseContextsDoNotRetainPooledGinContext(t *testing.T) {
	db := setupRoleAuthorizationAPITest(t)
	root := menuRegressionRecord("root", "", "menu.business", pkg.DirectoryAccessType)
	page := menuRegressionRecord("page", root.ID, "menu.business.page", pkg.MenuAccessType)
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&[]models.Menu{root, page}).Error)
	require.NoError(t, db.Create(&models.CasbinRule{PType: "p", V0: "role-business", V1: "MENU", V2: page.Path, V3: "GET"}).Error)
	oldAuth := response.AuthHandler
	response.AuthHandler = func(ctx *gin.Context) {
		ctx.Set(config.Cfg.Auth.IdentityKey, roleAuthorizationPrincipal(true))
		ctx.Next()
	}
	t.Cleanup(func() { response.AuthHandler = oldAuth })
	var controller *Menu
	for _, candidate := range response.Controllers {
		if menu, ok := candidate.(*Menu); ok {
			controller = menu
			break
		}
	}
	require.NotNil(t, controller)
	var pooledContext *gin.Context
	queryCount := 0
	callback := "test:menu-stable-request-context"
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register(callback, func(tx *gorm.DB) {
		queryCount++
		if queryContext, ok := tx.Statement.Context.(*gin.Context); ok {
			require.NotSame(t, pooledContext, queryContext, "query must retain a request context or detached Gin copy")
		}
	}))
	t.Cleanup(func() { require.NoError(t, db.Callback().Query().Remove(callback)) })
	router := gin.New()
	router.Use(func(ctx *gin.Context) {
		pooledContext = ctx
		ctx.Set(config.Cfg.Auth.IdentityKey, roleAuthorizationPrincipal(true))
		ctx.Next()
	})
	router.GET("/menus", controller.List)
	router.GET("/menu/tree", controller.Tree)
	router.GET("/menu/authorize", controller.GetAuthorize)
	router.GET("/menu/api/:id", controller.GetAPI)
	router.POST("/menus", controller.GetAction(response.Control).Handler()...)
	router.PUT("/menus/:id", controller.GetAction(response.Control).Handler()...)
	router.DELETE("/menus/:id", controller.GetAction(response.Delete).Handler()...)
	for _, request := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/menus", "", http.StatusOK},
		{"GET", "/menu/tree", "", http.StatusOK},
		{"GET", "/menu/authorize", "", http.StatusOK},
		{"GET", "/menu/api/page", "", http.StatusOK},
		{"POST", "/menus", `{"name":"new","path":"/new","type":"MENU","parentID":"root"}`, http.StatusCreated},
		{"DELETE", "/menus/page", "", http.StatusConflict},
		{"PUT", "/menus/page", `{"name":"renamed"}`, http.StatusOK},
	} {
		before := queryCount
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(request.method, request.path, bytes.NewBufferString(request.body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, req)
		require.Equal(t, request.status, recorder.Code, recorder.Body.String())
		require.Greater(t, queryCount, before, "expected database queries for %s %s", request.method, request.path)
	}
}
