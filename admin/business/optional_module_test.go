package business

import (
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/migration"
	migrationmodels "github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/migration/models"
	"gorm.io/gorm"
)

// disabledModule mirrors the map dev failure: imported, switched off by
// configuration, and registering nothing.
type disabledModule struct {
	name       string
	registered *bool
}

func (module disabledModule) Name() string  { return module.name }
func (module disabledModule) Enabled() bool { return false }
func (module disabledModule) Register(*Registry) error {
	*module.registered = true
	return nil
}

type enabledEmptyModule struct{ name string }

func (module enabledEmptyModule) Name() string             { return module.name }
func (module enabledEmptyModule) Enabled() bool            { return true }
func (module enabledEmptyModule) Register(*Registry) error { return nil }

func TestDisabledOptionalModuleIsSkippedAndMigrateSucceeds(t *testing.T) {
	core := migration.New()
	registerCalled := false
	business := validTestModule("supplier", "20261015100000")
	registry, err := Compose(core, disabledModule{name: "portal", registered: &registerCalled}, business)
	if err != nil {
		t.Fatalf("compose with disabled module: %v", err)
	}
	if registerCalled {
		t.Fatal("disabled module Register must not be called")
	}
	if got := registry.SkippedModules(); len(got) != 1 || got[0] != "portal" {
		t.Fatalf("skipped modules = %v, want [portal]", got)
	}
	for _, descriptor := range registry.Descriptors() {
		if descriptor.Name == "portal" {
			t.Fatal("disabled module must not contribute a descriptor")
		}
	}
	phases, err := registry.MigrationPhaseRunners()
	if err != nil {
		t.Fatalf("migration phases: %v", err)
	}
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&migrationmodels.Migration{}); err != nil {
		t.Fatalf("create migration ledger: %v", err)
	}
	for _, runner := range []*migration.Migration{phases.Core, phases.Business} {
		runner.SetDb(db)
		runner.SetModel(&migrationmodels.Migration{})
		if err := runner.MigrateContext(t.Context()); err != nil {
			t.Fatalf("migrate with disabled module: %v", err)
		}
	}
	// The identity stays reserved, so a duplicate is still rejected.
	if _, err := Compose(core, disabledModule{name: "portal", registered: &registerCalled}, disabledModule{name: "portal", registered: &registerCalled}); err == nil {
		t.Fatal("duplicate disabled module must still be rejected")
	}
}

func TestEnabledModuleWithoutRegistrationStillFails(t *testing.T) {
	if _, err := Compose(migration.New(), enabledEmptyModule{name: "portal"}); err == nil ||
		!strings.Contains(err.Error(), "did not provide a registration") {
		t.Fatalf("enabled empty module error = %v", err)
	}
}

func TestModuleWithoutTablesDefaultsToAlwaysReady(t *testing.T) {
	module := validTestModule("viewer", "")
	module.registration.Migrations = nil
	module.registration.Readiness = nil
	registry, err := Compose(migration.New(), module)
	if err != nil {
		t.Fatalf("compose module without tables: %v", err)
	}
	if len(registry.entries) != 1 || registry.entries[0].readiness == nil {
		t.Fatal("module without tables must get a default readiness check")
	}
	if err := registry.entries[0].readiness(t.Context(), nil); err != nil {
		t.Fatalf("default readiness = %v, want ready", err)
	}

	withTables := validTestModule("supplier", "20261015100001")
	withTables.registration.Readiness = nil
	if _, err := Compose(migration.New(), withTables); err == nil ||
		!strings.Contains(err.Error(), "readiness check is required") {
		t.Fatalf("module with migrations and no readiness error = %v", err)
	}
}

type callbackModule struct {
	name    string
	enabled func() bool
}

func (module callbackModule) Name() string             { return module.name }
func (module callbackModule) Enabled() bool            { return module.enabled() }
func (module callbackModule) Register(*Registry) error { return nil }

func TestEnabledReadingRegistryDoesNotDeadlock(t *testing.T) {
	registry, err := NewRegistry(migration.New())
	if err != nil {
		t.Fatalf("new registry: %v", err)
	}
	done := make(chan error, 1)
	go func() {
		done <- registry.Add(callbackModule{name: "portal", enabled: func() bool {
			_ = registry.SkippedModules()
			_ = registry.Descriptors()
			return false
		}})
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("add module reading registry in Enabled: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Enabled reading the registry deadlocked Add")
	}
	if got := registry.SkippedModules(); len(got) != 1 || got[0] != "portal" {
		t.Fatalf("skipped modules = %v, want [portal]", got)
	}
}

func TestEnabledPanicReturnsErrorAndRegistryStaysUsable(t *testing.T) {
	registry, err := NewRegistry(migration.New())
	if err != nil {
		t.Fatalf("new registry: %v", err)
	}
	err = registry.Add(callbackModule{name: "portal", enabled: func() bool { panic("boom") }})
	if err == nil || !strings.Contains(err.Error(), "Enabled panicked") {
		t.Fatalf("panicking Enabled error = %v", err)
	}
	done := make(chan error, 1)
	go func() { done <- registry.Add(validTestModule("supplier", "20261015100002")) }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("registry unusable after Enabled panic: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("registry deadlocked after Enabled panic")
	}
	if len(registry.SkippedModules()) != 0 {
		t.Fatal("panicking module must not be recorded as skipped")
	}
}
