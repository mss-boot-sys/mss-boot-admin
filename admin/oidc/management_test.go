package oidc

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/casbin/casbin/v2"
	casbinmodel "github.com/casbin/casbin/v2/model"
	gormadapter "github.com/casbin/gorm-adapter/v3"
	"github.com/mss-boot-io/mss-boot-admin/admin/middleware"
	"github.com/mss-boot-io/mss-boot-admin/admin/models"
	"github.com/mss-boot-io/mss-boot-admin/admin/service"
	"github.com/mss-boot-io/mss-boot-admin/mss-boot/pkg/config/gormdb"
	"github.com/stretchr/testify/require"
)

func TestManagementPermissionsSecretsAndCAS(t *testing.T) {
	f := setup(t)
	f.login()
	require.NoError(t, f.db.AutoMigrate(&models.ConfigRevision{}))
	adapter, err := gormadapter.NewAdapterByDBUseTableName(f.db, "mss_boot", "casbin_rule")
	require.NoError(t, err)
	model, err := casbinmodel.NewModelFromString(`[request_definition]
r = sub, tp, obj, act
[policy_definition]
p = sub, tp, obj, act
[policy_effect]
e = some(where (p.eft == allow))
[matchers]
m = r.sub == p.sub && r.tp == p.tp && keyMatch(r.obj, p.obj) && regexMatch(r.act, p.act)
`)
	require.NoError(t, err)
	enforcer, err := casbin.NewSyncedEnforcer(model, adapter)
	require.NoError(t, err)
	old, oldPolicies := gormdb.Enforcer, service.AuthorizationPolicies
	gormdb.Enforcer = enforcer
	service.AuthorizationPolicies = service.NewAuthorizationPolicyService()
	t.Cleanup(func() { gormdb.Enforcer = old; service.AuthorizationPolicies = oldPolicies })
	f.p.MountManagement(f.router.Group("/admin/api", middleware.EnforceBrowserCSRF()))
	headers := map[string]string{"Content-Type": "application/json", "Origin": "https://id.example.test"}
	for _, cookie := range f.cookies {
		if cookie.Name == middleware.BrowserCSRFCookieName {
			headers[middleware.BrowserCSRFHeaderName] = cookie.Value
		}
	}
	for _, route := range ManagementRoutes {
		path := "/admin/api" + strings.ReplaceAll(route.Path, ":id", f.client.ID)
		// Ordinary SSO access never implies management authority.
		require.Equal(t, 403, f.call(route.Method, path, "{}", headers, f.cookies).Code, route.Path)
		require.Equal(t, 401, f.call(route.Method, path, "{}", headers, nil).Code, route.Path)
		_, err = enforcer.AddPolicy(f.user.RoleID, "API", "/admin/api"+route.Path, route.Method)
		require.NoError(t, err)
	}
	// Optional claim and role lists may be omitted by an API caller; responses
	// must still preserve the array contract used by management and consent UI.
	input := ClientInput{Name: "Second cluster", Enabled: true, RedirectURIs: []string{"https://second.example.test:8006"}, Scopes: []string{"openid"}, UserIDs: []string{f.user.ID}}
	body, _ := json.Marshal(input)
	created := f.call(http.MethodPost, "/admin/api/sso/clients", string(body), headers, f.cookies)
	require.Equal(t, 201, created.Code)
	data := bodyJSON(t, created)["data"].(map[string]any)
	createdClient := data["client"].(map[string]any)
	require.Equal(t, []any{}, createdClient["claims"])
	require.Equal(t, []any{}, createdClient["roleIDs"])
	secret := data["secret"].(string)
	require.NotEmpty(t, secret)
	id := data["client"].(map[string]any)["id"].(string)
	list := f.call("GET", "/admin/api/sso/clients", "", nil, f.cookies)
	require.Equal(t, 200, list.Code)
	require.NotContains(t, list.Body.String(), secret)
	require.NotContains(t, list.Body.String(), digest(secret))
	require.NotContains(t, list.Body.String(), "secret")
	var row models.OIDCClient
	require.NoError(t, f.db.First(&row, "id = ?", id).Error)
	require.True(t, digest(secret) == row.SecretHash)
	path := "/admin/api/sso/clients/" + id + "/rotate-secret"
	rotated := f.call("POST", path, `{"revision":1}`, headers, f.cookies)
	require.Equal(t, 200, rotated.Code)
	require.NotContains(t, rotated.Body.String(), secret)
	require.Equal(t, 409, f.call("POST", path, `{"revision":1}`, headers, f.cookies).Code)
	require.NoError(t, f.db.First(&row, "id = ?", id).Error)
	require.False(t, digest(secret) == row.SecretHash)
	input.Revision = 2
	input.Enabled = false
	body, _ = json.Marshal(input)
	require.Equal(t, 200, f.call("PUT", "/admin/api/sso/clients/"+id, string(body), headers, f.cookies).Code)
	require.NoError(t, f.db.First(&row, "id = ?", id).Error)
	require.False(t, row.Enabled)
	logs := f.call("GET", "/admin/api/sso/audit", "", nil, f.cookies)
	require.Equal(t, 200, logs.Code)
	require.NotContains(t, logs.Body.String(), secret)
	// Method-specific read grants cannot mutate or rotate secrets.
	_, err = enforcer.RemovePolicy(f.user.RoleID, "API", "/admin/api/sso/clients/:id/rotate-secret", "POST")
	require.NoError(t, err)
	require.Equal(t, 403, f.call("POST", path, `{"revision":3}`, headers, f.cookies).Code)
}
