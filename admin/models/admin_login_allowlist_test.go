package models

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
	"github.com/mss-boot-sys/mss-boot-admin/admin/pkg"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/enum"
	"github.com/stretchr/testify/require"
)

func withAdminLoginPolicy(t *testing.T, policy config.AdminLogin) {
	t.Helper()
	previous := config.Cfg.Auth.AdminLogin
	config.Cfg.Auth.AdminLogin = policy
	t.Cleanup(func() { config.Cfg.Auth.AdminLogin = previous })
}

func githubUserServer(t *testing.T, body string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/user" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return server
}

var allowlistRegistrationConfig = githubTestAppConfig{
	"security:githubEnabled":   "true",
	"security:registerEnabled": "true",
}

// Acceptance (v1.5.0 C1): a GitHub account outside a non-empty allowlist is
// denied before provisioning, even when public registration is enabled.
func TestAdminLoginAllowlistDeniesUnlistedGithubAccountWithoutProvisioning(t *testing.T) {
	database := setupGithubVerifyTest(t, allowlistRegistrationConfig)
	withAdminLoginPolicy(t, config.AdminLogin{Allowlist: []config.AdminLoginAllowEntry{{Provider: "github", ID: "1"}}})
	server := githubUserServer(t, `{"id":42,"login":"intruder"}`)

	login := &UserLogin{Provider: pkg.GithubLoginProvider, Password: "provider-token-secret"}
	ok, verifier, err := login.Verify(newGithubVerifyContext(server.URL))
	require.ErrorIs(t, err, ErrAdminLoginNotAllowed)
	require.False(t, ok)
	require.Nil(t, verifier)
	require.NotContains(t, err.Error(), "provider-token-secret")
	var denied *AdminLoginDeniedError
	require.True(t, errors.As(err, &denied))
	require.Equal(t, "42", denied.Subject)
	require.Equal(t, "intruder", denied.Login)
	requireGithubRegistrationCount(t, database, 0, 0)
}

func TestAdminLoginAllowlistDeniesAlreadyProvisionedUnlistedAccount(t *testing.T) {
	database := setupGithubVerifyTest(t, allowlistRegistrationConfig)
	server := githubUserServer(t, `{"id":42,"login":"former-user"}`)
	// Provision while the allowlist is disabled (v1.4.0 behaviour).
	first := &UserLogin{Provider: pkg.GithubLoginProvider, Password: "token"}
	ok, _, err := first.Verify(newGithubVerifyContext(server.URL))
	require.NoError(t, err)
	require.True(t, ok)
	requireGithubRegistrationCount(t, database, 1, 1)

	withAdminLoginPolicy(t, config.AdminLogin{Allowlist: []config.AdminLoginAllowEntry{{Provider: "github", Login: "someone-else"}}})
	again := &UserLogin{Provider: pkg.GithubLoginProvider, Password: "token"}
	ok, verifier, err := again.Verify(newGithubVerifyContext(server.URL))
	require.ErrorIs(t, err, ErrAdminLoginNotAllowed)
	require.False(t, ok)
	require.Nil(t, verifier)
	requireGithubRegistrationCount(t, database, 1, 1)
}

func TestAdminLoginAllowlistAdmitsListedGithubAccount(t *testing.T) {
	for name, entry := range map[string]config.AdminLoginAllowEntry{
		"by id":    {Provider: "github", ID: "42"},
		"by login": {Provider: "github", Login: "OctoCat"},
	} {
		t.Run(name, func(t *testing.T) {
			database := setupGithubVerifyTest(t, allowlistRegistrationConfig)
			withAdminLoginPolicy(t, config.AdminLogin{Allowlist: []config.AdminLoginAllowEntry{entry}})
			server := githubUserServer(t, `{"id":42,"login":"octocat"}`)
			login := &UserLogin{Provider: pkg.GithubLoginProvider, Password: "token"}
			ok, verifier, err := login.Verify(newGithubVerifyContext(server.URL))
			require.NoError(t, err)
			require.True(t, ok)
			require.NotNil(t, verifier)
			requireGithubRegistrationCount(t, database, 1, 1)
		})
	}
}

func TestAdminLoginAllowlistDisabledKeepsV140Registration(t *testing.T) {
	database := setupGithubVerifyTest(t, allowlistRegistrationConfig)
	withAdminLoginPolicy(t, config.AdminLogin{})
	server := githubUserServer(t, `{"id":42,"login":"anyone"}`)
	login := &UserLogin{Provider: pkg.GithubLoginProvider, Password: "token"}
	ok, _, err := login.Verify(newGithubVerifyContext(server.URL))
	require.NoError(t, err)
	require.True(t, ok)
	requireGithubRegistrationCount(t, database, 1, 1)
}

// Root recovery: local username/password sign-in is never governed by the
// external-identity allowlist.
func TestAdminLoginAllowlistDoesNotAffectRootLocalLogin(t *testing.T) {
	database := setupGithubVerifyTest(t, allowlistRegistrationConfig)
	withAdminLoginPolicy(t, config.AdminLogin{Allowlist: []config.AdminLoginAllowEntry{{Provider: "github", ID: "1"}}})
	rootRole := &Role{Name: "root", Root: true, Status: enum.Enabled}
	require.NoError(t, database.Create(rootRole).Error)
	root := &User{UserLogin: UserLogin{
		Username: "root-admin",
		Password: "root-local-password",
		RoleID:   rootRole.ID,
		Status:   enum.Enabled,
	}}
	require.NoError(t, database.Create(root).Error)

	login := &UserLogin{Username: "root-admin", Password: "root-local-password"}
	ok, verifier, err := login.Verify(newGithubVerifyContext("http://127.0.0.1:1"))
	require.NoError(t, err)
	require.True(t, ok)
	require.NotNil(t, verifier)
	require.Equal(t, root.ID, verifier.GetUserID())
}
