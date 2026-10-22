package models

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateManagedUsername(t *testing.T) {
	for _, username := range []string{"abc", "USER_123", strings.Repeat("a", 20)} {
		if err := ValidateManagedUsername(username); err != nil {
			t.Errorf("valid username %q: %v", username, err)
		}
	}
	for _, username := range []string{"", "ab", strings.Repeat("a", 21), "has-hyphen", "用户名", " abc", "abc\n"} {
		if err := ValidateManagedUsername(username); !errors.Is(err, ErrUsernameInvalid) {
			t.Errorf("invalid username %q: %v", username, err)
		}
	}
}
