package oidc

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/mss-boot-sys/mss-boot-admin/admin/models"
	"github.com/stretchr/testify/require"
)

func TestAuthorizationACRPreferences(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		for _, tc := range []struct {
			name, value string
			present     bool
		}{
			{name: "omitted"},
			{name: "empty", present: true},
			{name: "single", value: "urn:mss:password", present: true},
			{name: "unknown", value: "urn:example:unknown", present: true},
			{name: "multiple", value: "urn:example:mfa urn:mss:password urn:example:unknown", present: true},
		} {
			t.Run(method+"/"+tc.name, func(t *testing.T) {
				f := setup(t)
				f.login()
				v, verifier := f.authValues()
				if tc.present {
					v.Set("acr_values", tc.value)
				}
				path, body := basePath+"/authorize?"+v.Encode(), ""
				if method == http.MethodPost {
					path, body = basePath+"/authorize", v.Encode()
				}
				w := f.call(method, path, body, map[string]string{"Content-Type": "application/x-www-form-urlencoded"}, f.cookies)
				require.Equal(t, http.StatusFound, w.Code)
				q := queryLocation(t, w)
				require.Empty(t, q.Get("error"), "voluntary ACR preferences must not reject an otherwise valid login")
				require.Equal(t, v.Get("state"), q.Get("state"))
				require.NotEmpty(t, q.Get("code"))
				token := f.exchange(q.Get("code"), verifier, nil, f.secret)
				require.Equal(t, http.StatusOK, token.Code)
				claims := f.verifyIDToken(bodyJSON(t, token)["id_token"].(string))
				require.Equal(t, v.Get("nonce"), claims["nonce"])
				var session models.UserSession
				require.NoError(t, f.db.Where("user_id = ?", f.user.ID).Take(&session).Error)
				require.Equal(t, float64(session.LoginAt.Unix()), claims["auth_time"])
				require.NotContains(t, claims, "acr", "requested classes are preferences, not verified authentication facts")
				require.NotContains(t, claims, "amr", "accepting a preference does not establish MFA")
			})
		}
	}
}

func TestAuthorizationACRPreferencesKeepUnsupportedRequestsRejected(t *testing.T) {
	f := setup(t)
	f.login()
	for _, tc := range []struct{ name, key, value string }{
		{"essential ACR value", "claims", `{"id_token":{"acr":{"essential":true,"value":"urn:example:mfa"}}}`},
		{"essential ACR values", "claims", `{"id_token":{"acr":{"essential":true,"values":["urn:example:mfa","urn:mss:password"]}}}`},
		{"other claims", "claims", `{"id_token":{"email":null}}`},
		{"ID token hint", "id_token_hint", "unsupported-hint"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v, _ := f.authValues()
			v.Set("acr_values", "urn:mss:password")
			v.Set(tc.key, tc.value)
			w := f.authorize(v)
			require.Equal(t, http.StatusFound, w.Code)
			q := queryLocation(t, w)
			require.Equal(t, "invalid_request", q.Get("error"))
			require.Empty(t, q.Get("code"))
		})
	}
	meta := bodyJSON(t, f.call(http.MethodGet, basePath+"/.well-known/openid-configuration", "", nil, nil))
	require.Equal(t, false, meta["claims_parameter_supported"])
	require.NotContains(t, meta, "acr_values_supported")
	require.NotContains(t, meta["claims_supported"], "acr")
}

func TestAuthorizationACRPreferencesKeepSessionAndGrantChecks(t *testing.T) {
	for _, name := range []string{"no session", "expired max age", "removed grant", "force login"} {
		t.Run(name, func(t *testing.T) {
			f := setup(t)
			if name != "no session" {
				f.login()
			}
			v, verifier := f.authValues()
			v.Set("acr_values", "urn:example:mfa urn:mss:password")
			v.Set("prompt", "none")
			expected := "login_required"
			switch name {
			case "expired max age":
				require.NoError(t, f.db.Model(&models.UserSession{}).Where("user_id = ?", f.user.ID).Update("login_at", time.Now().Add(-time.Hour)).Error)
				v.Set("max_age", "60")
			case "removed grant":
				require.NoError(t, f.db.Model(&f.client).Update("user_ids", "[]").Error)
				expected = "access_denied"
			case "force login":
				v.Set("prompt", "login")
			}
			w := f.authorize(v)
			require.Equal(t, http.StatusFound, w.Code)
			q := queryLocation(t, w)
			if name != "force login" {
				require.Equal(t, expected, q.Get("error"))
				require.Empty(t, q.Get("code"))
				return
			}
			require.Contains(t, w.Header().Get("Location"), "/user/login?")
			f.login()
			cookies := append(append([]*http.Cookie{}, f.cookies...), w.Result().Cookies()...)
			resumed := f.call(http.MethodGet, q.Get("redirect"), "", nil, cookies)
			code := queryLocation(t, resumed).Get("code")
			require.NotEmpty(t, code)
			token := f.exchange(code, verifier, nil, f.secret)
			require.Equal(t, http.StatusOK, token.Code)
			require.NotContains(t, f.verifyIDToken(bodyJSON(t, token)["id_token"].(string)), "acr")
		})
	}
}

func TestAuthorizationACRPreferencesKeepParameterChecks(t *testing.T) {
	f := setup(t)
	f.login()
	for _, tc := range []struct {
		name    string
		changes url.Values
		local   bool
	}{
		{"duplicate ACR parameter", url.Values{"acr_values": {"urn:mss:password", "urn:example:mfa"}}, true},
		{"oversized ACR parameter", url.Values{"acr_values": {strings.Repeat("a", 4097)}}, true},
		{"unregistered redirect", url.Values{"redirect_uri": {"https://unregistered.example.test"}}, true},
		{"empty nonce", url.Values{"nonce": {""}}, false},
		{"plain PKCE", url.Values{"code_challenge_method": {"plain"}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v, _ := f.authValues()
			v.Set("acr_values", "urn:mss:password")
			for key, values := range tc.changes {
				v[key] = values
			}
			w := f.authorize(v)
			if tc.local {
				require.Equal(t, http.StatusBadRequest, w.Code)
				require.Empty(t, w.Header().Get("Location"))
				require.Equal(t, "invalid_request", bodyJSON(t, w)["error"])
				return
			}
			require.Equal(t, "invalid_request", queryLocation(t, w).Get("error"))
			require.Empty(t, queryLocation(t, w).Get("code"))
		})
	}
}
