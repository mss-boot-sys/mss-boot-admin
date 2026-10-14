package router

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/mss-boot-sys/mss-boot-admin/admin/config"
)

// The v1.5.0 baseline snapshot (P1) freezes the Admin HTTP surface so later
// security changes (login allowlist, token audience, surfaces) can prove they
// did not add, remove or reclassify an existing route by accident. An
// intentional change must regenerate the golden files in the same PR:
//
//	MSS_UPDATE_BASELINE=1 go test ./router -run TestAdminBaselineSnapshot
//
// and the diff of admin/router/testdata/baseline/ is then part of review.
const baselineUpdateEnv = "MSS_UPDATE_BASELINE"

func TestAdminBaselineSnapshotRoutes(t *testing.T) {
	previousMode := config.Cfg.Application.Mode
	previousGinMode := gin.Mode()
	t.Cleanup(func() {
		config.Cfg.Application.Mode = previousMode
		gin.SetMode(previousGinMode)
	})

	for _, mode := range []config.Mode{config.ModeProd, config.ModeDev} {
		t.Run(string(mode), func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			config.Cfg.Application.Mode = mode
			engine := gin.New()
			InitRouter(engine.Group("/admin"))

			lines := make([]string, 0, len(engine.Routes()))
			for _, route := range engine.Routes() {
				lines = append(lines, route.Method+" "+route.Path)
			}
			sort.Strings(lines)
			assertBaseline(t, fmt.Sprintf("routes-%s.txt", mode), strings.Join(lines, "\n")+"\n")
		})
	}
}

func TestAdminBaselineSnapshotSecurityContract(t *testing.T) {
	contracts := CustomRouteContracts()
	sort.Slice(contracts, func(i, j int) bool {
		if contracts[i].Path != contracts[j].Path {
			return contracts[i].Path < contracts[j].Path
		}
		return contracts[i].Method < contracts[j].Method
	})
	payload, err := json.MarshalIndent(contracts, "", "  ")
	if err != nil {
		t.Fatalf("marshal security contract: %v", err)
	}
	assertBaseline(t, "security-route-contract.json", string(payload)+"\n")
}

func assertBaseline(t *testing.T, name, got string) {
	t.Helper()
	path := filepath.Join("testdata", "baseline", name)
	if os.Getenv(baselineUpdateEnv) == "1" {
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatalf("write baseline %s: %v", path, err)
		}
		return
	}
	wantBytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read baseline %s: %v (run with %s=1 to create it)", path, err, baselineUpdateEnv)
	}
	want := string(wantBytes)
	if got == want {
		return
	}
	t.Fatalf("Admin baseline snapshot %s drifted; if intentional, regenerate with %s=1 and review the diff.\n%s",
		path, baselineUpdateEnv, lineDiff(want, got))
}

func lineDiff(want, got string) string {
	wantSet := map[string]bool{}
	for _, line := range strings.Split(want, "\n") {
		wantSet[line] = true
	}
	gotSet := map[string]bool{}
	for _, line := range strings.Split(got, "\n") {
		gotSet[line] = true
	}
	var out []string
	for _, line := range strings.Split(want, "\n") {
		if !gotSet[line] {
			out = append(out, "- "+line)
		}
	}
	for _, line := range strings.Split(got, "\n") {
		if !wantSet[line] {
			out = append(out, "+ "+line)
		}
	}
	if len(out) == 0 {
		return "(ordering or duplicate-line change)"
	}
	return strings.Join(out, "\n")
}
