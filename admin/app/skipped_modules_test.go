package app

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"

	"github.com/mss-boot-sys/mss-boot-admin/admin/business"
	"github.com/mss-boot-sys/mss-boot-admin/mss-boot/pkg/migration"
)

type disabledTestModule struct{ name string }

func (module disabledTestModule) Name() string                      { return module.name }
func (module disabledTestModule) Enabled() bool                     { return false }
func (module disabledTestModule) Register(*business.Registry) error { return nil }

func TestLogSkippedModules(t *testing.T) {
	var output bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&output, &slog.HandlerOptions{Level: slog.LevelInfo}))

	empty, err := business.Compose(migration.New())
	if err != nil {
		t.Fatalf("compose empty registry: %v", err)
	}
	logSkippedModules(logger, empty)
	if output.Len() != 0 {
		t.Fatalf("logged with no skipped modules: %q", output.String())
	}

	registry, err := business.Compose(migration.New(), disabledTestModule{name: "portal"}, disabledTestModule{name: "map"})
	if err != nil {
		t.Fatalf("compose registry: %v", err)
	}
	logSkippedModules(logger, registry)
	line := output.String()
	if strings.Count(line, "\n") != 1 || !strings.Contains(line, "level=INFO") ||
		!strings.Contains(line, "modules=portal,map") {
		t.Fatalf("skipped modules log = %q", line)
	}
}
