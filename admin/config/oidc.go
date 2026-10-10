package config

import (
	"errors"
	"net/url"
	"strings"
)

// OIDC is an opt-in core authentication capability. The wrapping key is read
// from the named environment variable, never exposed by configuration APIs.
type OIDC struct {
	Enabled             bool   `yaml:"enabled" json:"enabled"`
	Issuer              string `yaml:"issuer" json:"issuer"`
	KeyEncryptionKeyEnv string `yaml:"keyEncryptionKeyEnv" json:"keyEncryptionKeyEnv"`
}

func (o OIDC) Validate(auth Auth, applicationOrigin string) error {
	if !o.Enabled {
		return nil
	}
	u, err := url.Parse(o.Issuer)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.RawPath != "" || u.Path != "/admin/api/oidc" {
		return errors.New("oidc.issuer must be an exact HTTPS origin followed by /admin/api/oidc")
	}
	if strings.TrimSuffix(applicationOrigin, "/") != "https://"+u.Host {
		return errors.New("OIDC requires the application and issuer on the same HTTPS origin")
	}
	if !auth.BrowserSession.Secure || strings.EqualFold(auth.BrowserSession.SameSite, "strict") {
		return errors.New("OIDC requires Secure SameSite Lax browser sessions")
	}
	return nil
}
