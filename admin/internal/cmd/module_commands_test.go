package cmd

import (
	"bytes"
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/spf13/cobra"
	"gorm.io/gorm"

	"github.com/mss-boot-sys/mss-boot-admin/admin/business"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/migration"
)

type commandModule struct {
	name     string
	id       migration.MigrationID
	commands []business.CommandFactory
}

func (m commandModule) Name() string { return m.name }

func (m commandModule) Register(registry *business.Registry) error {
	return registry.Register(business.Registration{
		Descriptor: business.Descriptor{Name: m.name, DisplayName: strings.ToUpper(m.name), Model: new(struct{})},
		Migrations: func(runner *migration.Migration) error {
			return runner.Register(m.id, func(*gorm.DB, string) error { return nil })
		},
		Readiness: func(context.Context, *gorm.DB) error { return nil },
		Routes: func(group *gin.RouterGroup, _ business.Runtime) error {
			group.GET("/"+m.name, func(c *gin.Context) { c.Status(http.StatusOK) })
			return nil
		},
		Commands: m.commands,
	})
}

func portalCommand(ran *[]string) business.CommandFactory {
	return func() *cobra.Command {
		root := &cobra.Command{Use: "portal", Short: "portal module"}
		root.AddCommand(&cobra.Command{Use: "install", RunE: func(cmd *cobra.Command, _ []string) error {
			*ran = append(*ran, "install")
			return nil
		}})
		return root
	}
}

func TestModuleCommandsMountUnderHostBinary(t *testing.T) {
	var ran []string
	registry, err := business.Compose(migration.New(), commandModule{name: "shop", id: "202610140301", commands: []business.CommandFactory{portalCommand(&ran)}})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ { // fresh tree per execution
		root := New(registry)
		root.SetOut(new(bytes.Buffer))
		root.SetArgs([]string{"portal", "install"})
		if err := root.ExecuteContext(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if len(ran) != 2 {
		t.Fatalf("ran = %v", ran)
	}
	names := []string{}
	for _, c := range New(registry).Commands() {
		names = append(names, c.Name())
	}
	for _, want := range []string{"server", "migrate", "portal"} {
		if !strings.Contains(strings.Join(names, ","), want) {
			t.Fatalf("command tree %v misses %s", names, want)
		}
	}
}

func TestNoModuleCommandsKeepsHostTree(t *testing.T) {
	registry, err := business.Compose(migration.New(), commandModule{name: "shop", id: "202610140301"})
	if err != nil {
		t.Fatal(err)
	}
	if got := len(New(registry).Commands()); got != len(New(nil).Commands()) {
		t.Fatalf("command count changed: %d", got)
	}
}

func TestModuleCommandsRejectUnsafeDeclarations(t *testing.T) {
	named := func(use string, aliases ...string) business.CommandFactory {
		return func() *cobra.Command { return &cobra.Command{Use: use, Aliases: aliases} }
	}
	cases := map[string][]business.CommandFactory{
		"reserved server":  {named("server")},
		"reserved migrate": {named("migrate")},
		"reserved help":    {named("help")},
		"alias shadowing":  {named("portal", "server")},
		"bad name":         {named("Portal")},
		"nil factory":      {nil},
		"nil command":      {func() *cobra.Command { return nil }},
		"duplicate":        {named("portal"), named("portal")},
	}
	for name, commands := range cases {
		if _, err := business.Compose(migration.New(), commandModule{name: "shop", id: "202610140301", commands: commands}); err == nil {
			t.Errorf("%s: expected registration error", name)
		}
	}
	_, err := business.Compose(migration.New(),
		commandModule{name: "shop", id: "202610140301", commands: []business.CommandFactory{named("portal")}},
		commandModule{name: "other", id: "202610140302", commands: []business.CommandFactory{named("portal")}},
	)
	if err == nil || !strings.Contains(err.Error(), "already registered") {
		t.Fatalf("cross-module duplicate: %v", err)
	}
}

func TestModuleCommandErrorsBlockHostCommands(t *testing.T) {
	unfrozen, err := business.NewRegistry(migration.New())
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	flaky := func() *cobra.Command {
		calls++
		if calls > 1 {
			return &cobra.Command{Use: "other"}
		}
		return &cobra.Command{Use: "portal"}
	}
	invalid, err := business.Compose(migration.New(), commandModule{name: "shop", id: "202610140301", commands: []business.CommandFactory{flaky}})
	if err != nil {
		t.Fatal(err)
	}
	for name, registry := range map[string]*business.Registry{"unfrozen": unfrozen, "invalid": invalid} {
		for _, sub := range []string{"server", "migrate"} {
			root := New(registry)
			root.SetOut(new(bytes.Buffer))
			root.SetErr(new(bytes.Buffer))
			root.SetArgs([]string{sub, "--help=false"})
			if err := root.ExecuteContext(context.Background()); err == nil || !strings.Contains(err.Error(), "business module commands") {
				t.Fatalf("%s/%s: expected loud failure, got %v", name, sub, err)
			}
		}
	}
}
