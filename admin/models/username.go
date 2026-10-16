package models

import (
	"errors"
	"regexp"
)

var ErrUsernameInvalid = errors.New("username is invalid")

var usernamePattern = regexp.MustCompile(`^[A-Za-z0-9_]{3,20}$`)

// ValidateManagedUsername defines the write contract for administrator-managed
// identities. It does not rewrite existing or externally provisioned identities.
func ValidateManagedUsername(username string) error {
	if !usernamePattern.MatchString(username) {
		return ErrUsernameInvalid
	}
	return nil
}
