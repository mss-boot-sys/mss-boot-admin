package config

import "testing"

func TestOIDCRequiresStableHTTPSAndCompatibleCookiePolicy(t *testing.T) {
	good := OIDC{Enabled: true, Issuer: "https://id.example.test/admin/api/oidc"}
	auth := Auth{BrowserSession: BrowserSession{Secure: true, SameSite: "lax"}}
	if err := good.Validate(auth, "https://id.example.test"); err != nil {
		t.Fatal(err)
	}
	for _, issuer := range []string{"http://id.example.test/admin/api/oidc", "https://id.example.test/oidc", "https://id.example.test/admin/api/oidc/", "https://id.example.test/admin/api/oidc?x=1", "https://other.example.test/admin/api/oidc", "https://user@id.example.test/admin/api/oidc"} {
		cfg := good
		cfg.Issuer = issuer
		if cfg.Validate(auth, "https://id.example.test") == nil {
			t.Errorf("accepted invalid issuer %s", issuer)
		}
	}
	auth.BrowserSession.SameSite = "strict"
	if good.Validate(auth, "https://id.example.test") == nil {
		t.Fatal("accepted strict cookies")
	}
	auth.BrowserSession.SameSite = "lax"
	auth.BrowserSession.Secure = false
	if good.Validate(auth, "https://id.example.test") == nil {
		t.Fatal("accepted insecure cookies")
	}
	if err := (OIDC{}).Validate(Auth{}, ""); err != nil {
		t.Fatal("disabled provider changed default behavior")
	}
}
