package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	distribution "github.com/mss-boot-sys/mss-boot-admin"
	"github.com/mss-boot-sys/mss-boot-admin/internal/mss/blueprint"
	"github.com/mss-boot-sys/mss-boot-admin/internal/mss/buildinfo"
	"github.com/mss-boot-sys/mss-boot-admin/internal/mss/project"
	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

func TestGenerateApplicationUsesEmbeddedSourceInEmptyDirectory(t *testing.T) {
	originalDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	working := t.TempDir()
	if err := os.Chdir(working); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(originalDirectory) })

	setAppReleaseBuild(t)

	rootOverride := ""
	command := &cobra.Command{}
	plan, err := generateApplication(command, &rootOverride, "", blueprint.Options{
		Destination: "generated-admin",
		Application: blueprint.Application{
			Name:        "generated-admin",
			DisplayName: "Generated Administration",
			Module:      "github.com/acme/generated-admin",
			Repository:  "acme/generated-admin",
		},
		FrontendRegistryURL: appFrontendRegistry(t),
		Write:               true,
	})
	if err != nil {
		t.Fatalf("generateApplication() error = %v", err)
	}
	if plan.Identities.Foundation.Version != appDistribution(t).Frontend.Version || plan.Destination != filepath.Join(working, "generated-admin") {
		t.Fatalf("standalone application plan = %#v", plan)
	}
	if _, err := os.Stat(filepath.Join(working, "generated-admin", "README.md")); err != nil {
		t.Fatalf("generated README: %v", err)
	}
}

func TestGenerateApplicationDefaultsToEmbeddedSourceFromFoundationSubdirectory(t *testing.T) {
	originalDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	foundationSubdirectory := filepath.Clean(filepath.Join(originalDirectory, "..", "blueprint"))
	if err := os.Chdir(foundationSubdirectory); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(originalDirectory) })

	setAppReleaseBuild(t)
	rootOverride := ""
	destination := filepath.Join(t.TempDir(), "subdirectory-admin")
	plan, err := generateApplication(&cobra.Command{}, &rootOverride, "", blueprint.Options{
		Destination: destination,
		Application: blueprint.Application{
			Name:        "subdirectory-admin",
			DisplayName: "Subdirectory Administration",
			Module:      "github.com/acme/subdirectory-admin",
			Repository:  "acme/subdirectory-admin",
		},
		FrontendRegistryURL: appFrontendRegistry(t),
	})
	if err != nil {
		t.Fatalf("generateApplication() from Foundation subdirectory error = %v", err)
	}
	if plan.Identities.Foundation.Commit != strings.Repeat("a", 40) || plan.Identities.Foundation.Source != ".mss/release-policy.yaml" {
		t.Fatalf("subdirectory generation did not use embedded release identity: %#v", plan.Identities.Foundation)
	}
}

func appFrontendRegistry(t *testing.T) string {
	t.Helper()
	frontend := appDistribution(t).Frontend
	integrity := "sha512-" + strings.Repeat("A", 86) + "=="
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/"+frontend.Package+"/"+frontend.Version {
			http.NotFound(writer, request)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(
			writer,
			`{"name":%q,"version":%q,"dist":{"integrity":%q,"tarball":%q}}`,
			frontend.Package,
			frontend.Version,
			integrity,
			"http://"+request.Host+"/artifacts/app-admin-web-"+frontend.Version+".tgz",
		)
	}))
	t.Cleanup(server.Close)
	return server.URL
}

func setAppReleaseBuild(t *testing.T) {
	t.Helper()
	originalVersion, originalCommit, originalTimestamp := buildinfo.Version, buildinfo.Commit, buildinfo.Timestamp
	t.Cleanup(func() {
		buildinfo.Version, buildinfo.Commit, buildinfo.Timestamp = originalVersion, originalCommit, originalTimestamp
	})
	buildinfo.Version = appDistribution(t).Version
	buildinfo.Commit = strings.Repeat("a", 40)
	buildinfo.Timestamp = "2026-08-25T12:34:56Z"
}

// appDistribution keeps release-build and registry fixtures aligned with the
// same embedded contract used by the standalone application command.
func appDistribution(t *testing.T) project.DistributionSpec {
	t.Helper()
	data, err := distribution.EmbeddedFS().ReadFile(".mss/blueprints/management-system.yaml")
	if err != nil {
		t.Fatalf("read embedded distribution contract: %v", err)
	}
	var document blueprint.Document
	if err := yaml.Unmarshal(data, &document); err != nil {
		t.Fatalf("decode embedded distribution contract: %v", err)
	}
	if problems := document.Spec.Distribution.Validate(); len(problems) != 0 {
		t.Fatalf("invalid embedded distribution contract: %v", problems)
	}
	return document.Spec.Distribution
}
