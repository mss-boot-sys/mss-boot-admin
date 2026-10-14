package config

import (
	"strings"
	"testing"
)

func TestAdminLoginDisabledByDefaultAllowsEveryone(t *testing.T) {
	var policy AdminLogin
	if policy.Enabled() {
		t.Fatal("zero-value admin login policy must be disabled")
	}
	if !policy.Allows("github", "1", "anyone") {
		t.Fatal("disabled policy must keep v1.4.0 behaviour")
	}
	if err := policy.Validate(); err != nil {
		t.Fatalf("zero value must validate: %v", err)
	}
}

func TestAdminLoginAllowsOnlyListedIdentities(t *testing.T) {
	policy := AdminLogin{Allowlist: []AdminLoginAllowEntry{
		{Provider: "github", ID: "42"},
		{Provider: "GitHub", ID: "43", Login: "label-only"},
		{Provider: "lark", ID: "ou_x"},
	}}
	if err := policy.Validate(); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		provider, id, login string
		want                bool
	}{
		{"github", "42", "renamed", true},
		{"github", "43", "anything", true},
		{"github", "44", "label-only", false},
		{"github", "", "label-only", false},
		{"github", "45", "intruder", false},
		{"github", "", "", false},
		{"lark", "42", "", false},
		{"lark", "ou_x", "", true},
		{"gitlab", "42", "", false},
	}
	for _, c := range cases {
		if got := policy.Allows(c.provider, c.id, c.login); got != c.want {
			t.Errorf("Allows(%q,%q,%q)=%v want %v", c.provider, c.id, c.login, got, c.want)
		}
	}
}

func TestAdminLoginValidateFailsClosed(t *testing.T) {
	bad := []AdminLogin{
		{Allowlist: []AdminLoginAllowEntry{{Provider: "gitlab", ID: "1"}}},
		{Allowlist: []AdminLoginAllowEntry{{Provider: "github"}}},
		{Allowlist: []AdminLoginAllowEntry{{Provider: "github", ID: "octocat"}}},
		{Allowlist: []AdminLoginAllowEntry{{Provider: "github", Login: "octocat"}}},
		{SecondFactor: "required"},
		{SecondFactor: "optional"},
		{SecondFactor: "sometimes"},
	}
	for index, policy := range bad {
		if err := policy.Validate(); err == nil {
			t.Errorf("case %d: expected validation error for %+v", index, policy)
		}
	}
	if err := (AdminLogin{SecondFactor: " OFF "}).Validate(); err != nil {
		t.Fatalf("off must validate: %v", err)
	}
}

func TestAdminLoginRejectsGithubLoginOnlyEntryWithClearError(t *testing.T) {
	err := AdminLogin{Allowlist: []AdminLoginAllowEntry{{Provider: "github", Login: "octocat"}}}.Validate()
	if err == nil || !strings.Contains(err.Error(), "numeric GitHub user id") || !strings.Contains(err.Error(), "never matched") {
		t.Fatalf("login-only github entry error = %v", err)
	}
}
