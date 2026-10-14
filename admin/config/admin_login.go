package config

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// Supported external identity providers for the Admin login allowlist. Local
// username/password and email-code sign-in are not governed by the allowlist,
// so the root account can always recover access with its local credentials.
const (
	AdminLoginProviderGithub = "github"
	AdminLoginProviderLark   = "lark"
)

// Second-factor policies. v1.5.0 only ships the configuration hook; TOTP is
// delivered separately, so any value other than off is rejected at startup.
const (
	AdminSecondFactorOff      = "off"
	AdminSecondFactorOptional = "optional"
	AdminSecondFactorRequired = "required"
)

// AdminLogin is the Admin sign-in policy for external identity providers.
//
//	auth:
//	  adminLogin:
//	    allowlist:
//	      - provider: github
//	        id: "583231"        # numeric GitHub user id (required, immutable)
//	        login: octocat      # optional label only, never used for matching
//	    secondFactor: off
//
// An empty allowlist disables the restriction (v1.4.0 behaviour). A non-empty
// allowlist denies every external identity that is not listed, before any
// account is provisioned, regardless of security:registerEnabled.
type AdminLogin struct {
	Allowlist    []AdminLoginAllowEntry `yaml:"allowlist" json:"allowlist"`
	SecondFactor string                 `yaml:"secondFactor" json:"secondFactor"`
	// RateLimit bounds sign-in attempts per client IP. Zero disables it.
	RateLimit AdminLoginRateLimit `yaml:"rateLimit" json:"rateLimit"`
}

// AdminLoginRateLimit allows Limit sign-in attempts per client IP per Window
// on the password login and OAuth callback endpoints. The built-in store is
// process-local; multi-replica deployments need a shared keyedlimit store.
type AdminLoginRateLimit struct {
	Limit  int           `yaml:"limit" json:"limit"`
	Window time.Duration `yaml:"window" json:"window"`
}

// Enabled reports whether login rate limiting is configured.
func (r AdminLoginRateLimit) Enabled() bool {
	return r.Limit != 0 || r.Window != 0
}

// AdminLoginAllowEntry matches one external identity.
//
// GitHub entries match ONLY by the immutable numeric user id; Login is an
// optional human-readable label and is never used for matching, because
// GitHub logins can be renamed and re-registered by someone else. Ids are
// never resolved over the network at startup. Lark entries match by open id
// and/or login (both must match when both are set).
type AdminLoginAllowEntry struct {
	Provider string `yaml:"provider" json:"provider"`
	ID       string `yaml:"id" json:"id"`
	Login    string `yaml:"login" json:"login"`
}

// Enabled reports whether the allowlist restricts external sign-in.
func (a AdminLogin) Enabled() bool {
	return len(a.Allowlist) > 0
}

// Allows reports whether the external identity may sign in to Admin. It always
// returns true when the allowlist is disabled.
func (a AdminLogin) Allows(provider, id, login string) bool {
	if !a.Enabled() {
		return true
	}
	provider = strings.ToLower(strings.TrimSpace(provider))
	id = strings.TrimSpace(id)
	login = strings.TrimSpace(login)
	for _, entry := range a.Allowlist {
		if strings.ToLower(strings.TrimSpace(entry.Provider)) != provider {
			continue
		}
		wantID := strings.TrimSpace(entry.ID)
		wantLogin := strings.TrimSpace(entry.Login)
		if provider == AdminLoginProviderGithub {
			if wantID != "" && id == wantID {
				return true
			}
			continue
		}
		if wantID != "" && (id == "" || wantID != id) {
			continue
		}
		if wantLogin != "" && (login == "" || !strings.EqualFold(wantLogin, login)) {
			continue
		}
		if wantID == "" && wantLogin == "" {
			continue
		}
		return true
	}
	return false
}

// SecondFactorPolicy returns the normalized second-factor policy.
func (a AdminLogin) SecondFactorPolicy() string {
	value := strings.ToLower(strings.TrimSpace(a.SecondFactor))
	if value == "" {
		return AdminSecondFactorOff
	}
	return value
}

// Validate fails closed on malformed allowlist entries so a typo cannot
// silently lock out or open up Admin sign-in.
func (a AdminLogin) Validate() error {
	switch a.SecondFactorPolicy() {
	case AdminSecondFactorOff:
	case AdminSecondFactorOptional, AdminSecondFactorRequired:
		return errors.New("auth.adminLogin.secondFactor: only \"off\" is supported in this release; TOTP ships separately")
	default:
		return fmt.Errorf("auth.adminLogin.secondFactor must be off, optional or required, got %q", a.SecondFactor)
	}
	if a.RateLimit.Enabled() && (a.RateLimit.Limit <= 0 || a.RateLimit.Window <= 0) {
		return errors.New("auth.adminLogin.rateLimit requires a positive limit and window")
	}
	for index, entry := range a.Allowlist {
		provider := strings.ToLower(strings.TrimSpace(entry.Provider))
		if provider != AdminLoginProviderGithub && provider != AdminLoginProviderLark {
			return fmt.Errorf("auth.adminLogin.allowlist[%d].provider must be github or lark", index)
		}
		id := strings.TrimSpace(entry.ID)
		if id == "" && strings.TrimSpace(entry.Login) == "" {
			return fmt.Errorf("auth.adminLogin.allowlist[%d] requires id or login", index)
		}
		if provider == AdminLoginProviderGithub {
			if id == "" {
				return fmt.Errorf("auth.adminLogin.allowlist[%d]: github entries must set id to the numeric GitHub user id (login %q is only a label and is never matched; look the id up via https://api.github.com/users/<login>)", index, strings.TrimSpace(entry.Login))
			}
			if strings.Trim(id, "0123456789") != "" {
				return fmt.Errorf("auth.adminLogin.allowlist[%d].id must be the numeric GitHub user id", index)
			}
		}
	}
	return nil
}
