package models

import (
	"errors"

	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
	"github.com/mss-boot-sys/mss-boot-admin/admin/pkg"
)

// ErrAdminLoginNotAllowed reports that an external identity is not on the
// configured Admin login allowlist (auth.adminLogin.allowlist).
var ErrAdminLoginNotAllowed = errors.New("admin login is not allowed for this identity")

// AdminLoginDeniedError carries only public identifiers (provider, subject id
// and login) so callers can write a diagnosable audit record without secrets.
type AdminLoginDeniedError struct {
	Provider pkg.LoginProvider
	Subject  string
	Login    string
}

func (e *AdminLoginDeniedError) Error() string { return ErrAdminLoginNotAllowed.Error() }

func (e *AdminLoginDeniedError) Is(target error) bool { return target == ErrAdminLoginNotAllowed }

// enforceAdminLoginAllowlist runs after the provider identity is resolved and
// before any account is provisioned or a token is issued.
func enforceAdminLoginAllowlist(provider pkg.LoginProvider, identity *UserOAuth2) error {
	policy := config.Cfg.Auth.AdminLogin
	if !policy.Enabled() {
		return nil
	}
	if identity == nil {
		return &AdminLoginDeniedError{Provider: provider}
	}
	login := identity.PreferredUsername
	if login == "" {
		login = identity.NickName
	}
	if policy.Allows(string(provider), identity.OpenID, login) {
		return nil
	}
	return &AdminLoginDeniedError{Provider: provider, Subject: identity.OpenID, Login: login}
}
