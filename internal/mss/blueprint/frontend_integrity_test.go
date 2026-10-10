package blueprint

import (
	"context"
	"crypto/sha512"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResolveFrontendPackageUsesExactLoopbackMetadata(t *testing.T) {
	t.Setenv("NODE_AUTH_TOKEN", "must-not-reach-fixtures")
	integrity := testFrontendIntegrity("candidate-tarball")
	tarball := "https://packages.example.test/artifacts/admin-web-1.3.3-frozen.tgz"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			t.Errorf("metadata method = %s", request.Method)
		}
		if request.URL.Path != "/@mss-boot-sys/admin-web/1.3.3" {
			t.Errorf("metadata path = %q", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "" {
			t.Error("metadata request unexpectedly forwarded credentials")
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(
			writer,
			`{"name":"@mss-boot-sys/admin-web","version":"1.3.3","dist":{"integrity":%q,"tarball":%q}}`,
			integrity,
			tarball,
		)
	}))
	t.Cleanup(server.Close)

	got, err := resolveFrontendPackage(context.Background(), server.URL, "@mss-boot-sys/admin-web", "1.3.3")
	if err != nil {
		t.Fatalf("resolveFrontendPackage() error = %v", err)
	}
	if got.Integrity != integrity || got.Tarball != tarball {
		t.Fatalf("resolveFrontendPackage() = %#v, want integrity %q and tarball %q", got, integrity, tarball)
	}
}

func TestResolveFrontendPackageFailsClosed(t *testing.T) {
	validIntegrity := testFrontendIntegrity("candidate-tarball")
	validTarball := "https://packages.example.test/artifacts/admin-web-1.3.3-frozen.tgz"
	for _, test := range []struct {
		name     string
		metadata string
		status   int
		want     string
	}{
		{name: "missing version", metadata: fmt.Sprintf(`{"name":"@mss-boot-sys/admin-web","dist":{"integrity":%q,"tarball":%q}}`, validIntegrity, validTarball), status: http.StatusOK, want: "identity mismatch"},
		{name: "wrong package", metadata: fmt.Sprintf(`{"name":"other","version":"1.3.3","dist":{"integrity":%q,"tarball":%q}}`, validIntegrity, validTarball), status: http.StatusOK, want: "identity mismatch"},
		{name: "missing integrity", metadata: fmt.Sprintf(`{"name":"@mss-boot-sys/admin-web","version":"1.3.3","dist":{"tarball":%q}}`, validTarball), status: http.StatusOK, want: "sha512 SRI"},
		{name: "invalid integrity", metadata: fmt.Sprintf(`{"name":"@mss-boot-sys/admin-web","version":"1.3.3","dist":{"integrity":"sha512-short","tarball":%q}}`, validTarball), status: http.StatusOK, want: "sha512 SRI"},
		{name: "missing tarball", metadata: fmt.Sprintf(`{"name":"@mss-boot-sys/admin-web","version":"1.3.3","dist":{"integrity":%q}}`, validIntegrity), status: http.StatusOK, want: "absolute stable URL"},
		{name: "malformed metadata", metadata: `{`, status: http.StatusOK, want: "decode npm metadata"},
		{name: "not found", metadata: `{}`, status: http.StatusNotFound, want: "HTTP 404"},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(test.status)
				_, _ = writer.Write([]byte(test.metadata))
			}))
			t.Cleanup(server.Close)
			_, err := resolveFrontendPackage(context.Background(), server.URL, "@mss-boot-sys/admin-web", "1.3.3")
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("resolveFrontendPackage() error = %v, want %q", err, test.want)
			}
		})
	}
}

func TestResolveFrontendPackageRejectsUnsafeTarballURLs(t *testing.T) {
	integrity := testFrontendIntegrity("candidate-tarball")
	for _, test := range []struct {
		name    string
		tarball string
		want    string
	}{
		{name: "relative", tarball: "/artifacts/admin-web.tgz", want: "absolute stable URL"},
		{name: "invalid scheme", tarball: "ftp://packages.example.test/admin-web.tgz", want: "must use HTTPS"},
		{name: "non loopback HTTP", tarball: "http://packages.example.test/admin-web.tgz", want: "explicit loopback"},
		{name: "userinfo", tarball: "https://token@packages.example.test/admin-web.tgz", want: "credentials"},
		{name: "query", tarball: "https://packages.example.test/admin-web.tgz?token=secret", want: "query or fragment"},
		{name: "fragment", tarball: "https://packages.example.test/admin-web.tgz#fragment", want: "query or fragment"},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				_, _ = fmt.Fprintf(
					writer,
					`{"name":"@mss-boot-sys/admin-web","version":"1.3.3","dist":{"integrity":%q,"tarball":%q}}`,
					integrity,
					test.tarball,
				)
			}))
			t.Cleanup(server.Close)
			_, err := resolveFrontendPackage(context.Background(), server.URL, "@mss-boot-sys/admin-web", "1.3.3")
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("resolveFrontendPackage() error = %v, want %q", err, test.want)
			}
		})
	}
}

func TestValidFrontendTarballURLAllowsHTTPSAndExplicitLoopbackHTTP(t *testing.T) {
	for _, value := range []string{
		"https://packages.example.test/artifacts/admin-web.tgz",
		"http://localhost:4873/artifacts/admin-web.tgz",
		"http://127.0.0.1:4873/artifacts/admin-web.tgz",
		"http://[::1]:4873/artifacts/admin-web.tgz",
	} {
		if got, err := validFrontendTarballURL(value); err != nil || got != value {
			t.Fatalf("validFrontendTarballURL(%q) = %q, %v", value, got, err)
		}
	}
}

func TestResolveFrontendPackageRejectsOversizedMetadata(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(strings.Repeat("x", maxFrontendMetadataBytes+1)))
	}))
	t.Cleanup(server.Close)
	if _, err := resolveFrontendPackage(context.Background(), server.URL, "@mss-boot-sys/admin-web", "1.3.3"); err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("oversized metadata error = %v", err)
	}
}

func TestResolveFrontendPackageRejectsRedirectAndNonLoopbackOverride(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, "https://registry.npmjs.org/", http.StatusFound)
	}))
	t.Cleanup(server.Close)
	if _, err := resolveFrontendPackage(context.Background(), server.URL, "@mss-boot-sys/admin-web", "1.3.3"); err == nil || !strings.Contains(err.Error(), "redirects are not allowed") {
		t.Fatalf("redirect error = %v", err)
	}
	if _, err := resolveFrontendPackage(context.Background(), "http://example.com", "@mss-boot-sys/admin-web", "1.3.3"); err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("non-loopback override error = %v", err)
	}
	if _, err := resolveFrontendPackage(context.Background(), "http://token@example.com", "@mss-boot-sys/admin-web", "1.3.3"); err == nil || !strings.Contains(err.Error(), "credentials") {
		t.Fatalf("credential-bearing override error = %v", err)
	}
	if _, err := resolveFrontendPackage(context.Background(), "http://127.0.0.1/registry", "@mss-boot-sys/admin-web", "1.3.3"); err == nil || !strings.Contains(err.Error(), "a path") {
		t.Fatalf("path-bearing override error = %v", err)
	}
	if _, err := resolveFrontendPackage(context.Background(), "http://127.0.0.1?token=secret", "@mss-boot-sys/admin-web", "1.3.3"); err == nil || !strings.Contains(err.Error(), "query") {
		t.Fatalf("query-bearing override error = %v", err)
	}
}

func TestResolveFrontendPackageForSourceSkipsTemplatesWithoutTokens(t *testing.T) {
	got, err := resolveFrontendPackageForSource(context.Background(), "http://example.com", nil, []blueprintSourceFile{{Data: []byte("no frontend package tokens")}})
	if err != nil || got != (frontendPackageResolution{}) {
		t.Fatalf("resolveFrontendPackageForSource() = %#v, %v", got, err)
	}
}

func TestResolveFrontendPackageForSourceRequiresTarballAndIntegrityTogether(t *testing.T) {
	for _, token := range []string{frontendIntegrityToken, frontendTarballToken} {
		_, err := resolveFrontendPackageForSource(context.Background(), "http://example.com", nil, []blueprintSourceFile{{Data: []byte(token)}})
		if err == nil || !strings.Contains(err.Error(), "tarball and integrity together") {
			t.Fatalf("single frontend package token %q error = %v", token, err)
		}
	}
}

func testFrontendIntegrity(content string) string {
	digest := sha512.Sum512([]byte(content))
	return "sha512-" + base64.StdEncoding.EncodeToString(digest[:])
}

type frontendRoundTripFunc func(*http.Request) (*http.Response, error)

func (f frontendRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestResolveFrontendPackageAuthenticatesOnlyGitHubPackages(t *testing.T) {
	t.Setenv("NODE_AUTH_TOKEN", "test-process-token")
	original := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = original })
	tarball := "https://npm.pkg.github.com/download/@mss-boot-sys/admin-web/1.3.9/frozen"
	requests := 0
	http.DefaultTransport = frontendRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		if request.URL.String() != "https://npm.pkg.github.com/@mss-boot-sys%2Fadmin-web" || request.Header.Get("Authorization") != "Bearer test-process-token" {
			t.Fatal("GitHub Packages request did not use the exact registry, package and process token")
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(fmt.Sprintf(
			`{"name":"@mss-boot-sys/admin-web","dist-tags":{"latest":"2.0.0"},"versions":{"1.3.9":{"name":"@mss-boot-sys/admin-web","version":"1.3.9","dist":{"integrity":%q,"tarball":%q}}}}`, testFrontendIntegrity("published-package"), tarball,
		)))}, nil
	})
	for _, registry := range []string{"", "https://npm.pkg.github.com", "https://npm.pkg.github.com/"} {
		resolved, err := resolveFrontendPackage(context.Background(), registry, "@mss-boot-sys/admin-web", "1.3.9")
		if err != nil || resolved.Tarball != tarball {
			t.Fatalf("resolve official registry: %#v, %v", resolved, err)
		}
	}
	if requests != 3 {
		t.Fatalf("requests = %d", requests)
	}
	tarball = "https://npm.pkg.github.com.attacker.test/package.tgz"
	if _, err := resolveFrontendPackage(context.Background(), "", "@mss-boot-sys/admin-web", "1.3.9"); err == nil || !strings.Contains(err.Error(), "tarball must use") {
		t.Fatalf("cross-host tarball accepted: %v", err)
	}
}

func TestFrontendMetadataRejectsUnsafeIdentityAndRegistry(t *testing.T) {
	for _, registry := range []string{
		"https://registry.npmjs.org", "https://npm.pkg.github.com:444", "http://npm.pkg.github.com",
		"https://npm.pkg.github.com.attacker.test", "https://npm.pkg.github.com/path", "https://token@npm.pkg.github.com",
	} {
		if _, err := frontendMetadataEndpoint(registry, "@mss-boot-sys/admin-web", "1.3.9"); err == nil {
			t.Fatalf("unsafe registry accepted: %s", registry)
		}
	}
	for _, pkg := range []string{"@mss-boot-sys/admin-web/../../secret", "@mss-boot-sys/admin-web?token=x", "@mss-boot-sys%2Fadmin-web", "../secret"} {
		if _, err := frontendMetadataEndpoint("", pkg, "1.3.9"); err == nil {
			t.Fatalf("unsafe package accepted: %s", pkg)
		}
	}
	for _, version := range []string{"latest", "1.3.9/../../secret", "1.3.9?token=x"} {
		if _, err := frontendMetadataEndpoint("", "@mss-boot-sys/admin-web", version); err == nil {
			t.Fatalf("non-exact version accepted: %s", version)
		}
	}
}

func TestFrontendMetadataRequiresProcessTokenWithoutLoggingIt(t *testing.T) {
	for _, token := range []string{"", "invalid token", "invalid\ntoken"} {
		t.Setenv("NODE_AUTH_TOKEN", token)
		_, err := resolveFrontendPackage(context.Background(), "", "@mss-boot-sys/admin-web", "1.3.9")
		if err == nil || !strings.Contains(err.Error(), "NODE_AUTH_TOKEN") || (token != "" && strings.Contains(err.Error(), token)) {
			t.Fatal("invalid or missing package token was not rejected without exposing its value")
		}
	}
}

func TestAuthenticatedFrontendMetadataDoesNotFollowRedirects(t *testing.T) {
	t.Setenv("NODE_AUTH_TOKEN", "test-process-token")
	original := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = original })
	requests := 0
	http.DefaultTransport = frontendRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		if request.URL.Host != "npm.pkg.github.com" {
			t.Fatal("package token request followed a redirect to a different host")
		}
		return &http.Response{StatusCode: http.StatusFound, Header: http.Header{"Location": {"https://other.example/package"}}, Body: io.NopCloser(strings.NewReader(""))}, nil
	})
	_, err := resolveFrontendPackage(context.Background(), "", "@mss-boot-sys/admin-web", "1.3.9")
	if err == nil || !strings.Contains(err.Error(), "redirects are not allowed") || requests != 1 || strings.Contains(err.Error(), "test-process-token") {
		t.Fatalf("redirect must fail without another request or token exposure; requests=%d, error=%v", requests, err)
	}
}
