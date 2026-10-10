package generator

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/mss-boot-sys/mss-boot-admin/internal/mss/spec"
)

// Compile and execute the generated tests, not just their syntax: an empty
// type switch and an unused validation fixture both parse as valid Go.
func TestGeneratedServiceOptionalEventsAndPatterns(t *testing.T) {
	repository := findRepositoryRoot(t)
	for _, shape := range []struct {
		name        string
		events      bool
		pattern     bool
		noSearch    bool
		fieldType   string
		searchShape string
	}{
		{name: "neither"},
		{name: "events", events: true},
		{name: "pattern", pattern: true},
		{name: "both", events: true, pattern: true},
		{name: "no search", noSearch: true},
		{name: "only bool", fieldType: "bool"},
		{name: "only enum", fieldType: "enum"},
		{name: "shared search default", events: true, pattern: true, searchShape: "shared-default"},
		{name: "match through another search field", searchShape: "other-field"},
	} {
		t.Run(shape.name, func(t *testing.T) {
			root := t.TempDir()
			module := generatorTestModule()
			if shape.noSearch {
				module.Spec.Tests.E2E = false
				module.Spec.Entity.Fields[0].Searchable = false
			}
			if shape.fieldType != "" {
				module.Spec.Tests.E2E = false
				field := spec.FieldSpec{Name: "enabled", GoName: "Enabled", Column: "enabled", DisplayName: "Enabled", Type: shape.fieldType, Required: true, Filterable: true}
				if shape.fieldType == "enum" {
					field.EnumValues = []spec.EnumValue{{Value: "enabled", Label: "Enabled"}, {Value: "disabled", Label: "Disabled"}}
				}
				module.Spec.Entity.Fields = []spec.FieldSpec{field}
			}
			if shape.events {
				module.Spec.Events = []spec.EventSpec{{Name: "supplier.created", When: "created"}}
			}
			if shape.pattern {
				module.Spec.Entity.Fields[0].Validation.Pattern = "^[A-Z0-9_]+$"
			}
			if shape.events && shape.pattern {
				minimum, maximum := 2, 20
				module.Spec.Entity.Fields[0].Validation.MinLength = &minimum
				module.Spec.Entity.Fields[0].Validation.MaxLength = &maximum
			}
			switch shape.searchShape {
			case "shared-default":
				module.Spec.Tests.E2E = false
				reference := module.Spec.Entity.Fields[0]
				reference.Name, reference.GoName, reference.Column = "reference", "Reference", "reference"
				reference.Searchable = false
				module.Spec.Entity.Fields[0].Unique = false
				module.Spec.Entity.Fields[0].Default = "GENERAL"
				module.Spec.Entity.Fields[1].Default = nil
				module.Spec.Entity.Fields = append(module.Spec.Entity.Fields, reference)
			case "other-field":
				module.Spec.Entity.Fields = append(module.Spec.Entity.Fields, spec.FieldSpec{
					Name: "alias", GoName: "Alias", Column: "alias", DisplayName: "Alias",
					Type: "string", Required: true, Searchable: true, Default: "value_01",
					Validation: spec.ValidationSpec{Pattern: "^[a-z0-9_]+$"},
				})
			}
			if _, err := Generate(module, Options{Root: root, Write: true}); err != nil {
				t.Fatalf("generate: %v", err)
			}
			second, err := Generate(module, Options{Root: root, Write: true})
			if err != nil {
				t.Fatalf("second generation: %v", err)
			}
			for _, change := range second.Changes {
				if change.Action != ActionUnchanged {
					t.Fatalf("non-idempotent %s: %s", change.Path, change.Action)
				}
			}
			if _, err := Generate(module, Options{Root: root, Check: true}); err != nil {
				t.Fatalf("generated drift: %v", err)
			}

			// These replacements are confined to this disposable contributor test.
			// They do not change released dependency or CLI identities.
			mod, err := os.ReadFile(filepath.Join(repository, "admin", "go.mod"))
			if err != nil {
				t.Fatal(err)
			}
			mod = []byte(strings.Replace(string(mod), "module github.com/mss-boot-sys/mss-boot-admin/admin", "module example.test/generated-service", 1))
			mod = append(mod, []byte(fmt.Sprintf("\nrequire github.com/mss-boot-sys/mss-boot-admin/admin v1.3.9\nreplace github.com/mss-boot-sys/mss-boot-admin/admin => %q\nreplace github.com/mss-boot-sys/mss-boot-admin/mss-boot => %q\n", filepath.Join(repository, "admin"), filepath.Join(repository, "mss-boot")))...)
			if err := os.WriteFile(filepath.Join(root, "go.mod"), mod, 0o600); err != nil {
				t.Fatal(err)
			}
			sum, err := os.ReadFile(filepath.Join(repository, "admin", "go.sum"))
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, "go.sum"), sum, 0o600); err != nil {
				t.Fatal(err)
			}
			// A toolchain patch invalidates the compiler cache. Allow the first
			// fixture to compile the Admin dependency graph on a two-core runner,
			// while bounding the generated test binary separately below.
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
			defer cancel()
			command := exec.CommandContext(ctx, filepath.Join(runtime.GOROOT(), "bin", "go"), "test", "-timeout=2m", "-count=1", "./admin/modules/supplier")
			command.Dir = root
			command.Env = append(os.Environ(), "GOWORK=off", "GOFLAGS=-p=2", "GOMAXPROCS=2", "GOMEMLIMIT=2GiB")
			if output, err := command.CombinedOutput(); err != nil {
				t.Fatalf("generated service tests: %v (context: %v)\n%s", err, ctx.Err(), output)
			}
		})
	}
}
