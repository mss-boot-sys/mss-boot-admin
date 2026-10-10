package blueprint

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

const (
	defaultFrontendRegistryURL = "https://npm.pkg.github.com"
	frontendIntegrityToken     = "__MSS_DISTRIBUTION_FRONTEND_INTEGRITY__"
	frontendTarballToken       = "__MSS_DISTRIBUTION_FRONTEND_TARBALL__"
	maxFrontendMetadataBytes   = 1 << 20
)

var frontendPackageNamePattern = regexp.MustCompile(`^@[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*$`)

type frontendPackageResolution struct {
	Integrity string
	Tarball   string
}

type frontendRegistryMetadata struct {
	Name     string                              `json:"name"`
	Version  string                              `json:"version"`
	Versions map[string]frontendRegistryMetadata `json:"versions"`
	Dist     struct {
		Integrity string `json:"integrity"`
		Tarball   string `json:"tarball"`
	} `json:"dist"`
}

// resolveFrontendPackageForSource resolves the immutable npm tarball URL and
// SRI only when a selected application template actually consumes them. Exact
// npm versions are immutable, so both values become part of the generated
// snapshot and subsequent three-way upgrade baseline.
func resolveFrontendPackageForSource(
	ctx context.Context,
	registryURL string,
	blueprint *Document,
	sourceFiles []blueprintSourceFile,
) (frontendPackageResolution, error) {
	needsIntegrity := false
	needsTarball := false
	for _, sourceFile := range sourceFiles {
		text := string(sourceFile.Data)
		needsIntegrity = needsIntegrity || strings.Contains(text, frontendIntegrityToken)
		needsTarball = needsTarball || strings.Contains(text, frontendTarballToken)
	}
	if !needsIntegrity && !needsTarball {
		return frontendPackageResolution{}, nil
	}
	if !needsIntegrity || !needsTarball {
		return frontendPackageResolution{}, errors.New("application template must consume frontend tarball and integrity together")
	}
	if blueprint == nil {
		return frontendPackageResolution{}, errors.New("application blueprint is required to resolve frontend package")
	}
	frontend := blueprint.Spec.Distribution.Frontend
	resolved, err := resolveFrontendPackage(ctx, registryURL, frontend.Package, frontend.Version)
	if err != nil {
		return frontendPackageResolution{}, fmt.Errorf("resolve frozen frontend %s@%s: %w", frontend.Package, frontend.Version, err)
	}
	return resolved, nil
}

func resolveFrontendPackage(ctx context.Context, registryURL, packageName, version string) (frontendPackageResolution, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	endpoint, err := frontendMetadataEndpoint(registryURL, packageName, version)
	if err != nil {
		return frontendPackageResolution{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return frontendPackageResolution{}, fmt.Errorf("create npm metadata request: %w", err)
	}
	if request.URL.Scheme == "https" && request.URL.Host == "npm.pkg.github.com" {
		token := strings.TrimSpace(os.Getenv("NODE_AUTH_TOKEN"))
		if token == "" {
			return frontendPackageResolution{}, errors.New("NODE_AUTH_TOKEN with GitHub Packages read access is required")
		}
		if strings.ContainsAny(token, " \t\r\n") {
			return frontendPackageResolution{}, errors.New("NODE_AUTH_TOKEN must be a single token")
		}
		request.Header.Set("Authorization", "Bearer "+token)
	}
	request.Header.Set("Accept", "application/vnd.npm.install-v1+json, application/json")
	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return errors.New("npm metadata redirects are not allowed")
		},
	}
	response, err := client.Do(request)
	if err != nil {
		var requestError *url.Error
		if errors.As(err, &requestError) {
			// Do not include a server-controlled redirect URL in diagnostics.
			err = requestError.Err
		}
		return frontendPackageResolution{}, fmt.Errorf("fetch exact npm metadata: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return frontendPackageResolution{}, fmt.Errorf("npm registry returned HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxFrontendMetadataBytes+1))
	if err != nil {
		return frontendPackageResolution{}, fmt.Errorf("read npm metadata: %w", err)
	}
	if len(data) > maxFrontendMetadataBytes {
		return frontendPackageResolution{}, fmt.Errorf("npm metadata exceeds %d bytes", maxFrontendMetadataBytes)
	}
	var metadata frontendRegistryMetadata
	if err := json.Unmarshal(data, &metadata); err != nil {
		return frontendPackageResolution{}, fmt.Errorf("decode npm metadata: %w", err)
	}
	if request.URL.Host == "npm.pkg.github.com" {
		// Use the same package metadata endpoint as npm, then select the exact
		// immutable version. Do not use dist-tags or assume the npmjs-specific
		// package/version endpoint is available in GitHub Packages.
		if metadata.Name != packageName {
			return frontendPackageResolution{}, errors.New("npm package metadata identity mismatch")
		}
		exact, exists := metadata.Versions[version]
		if !exists {
			return frontendPackageResolution{}, errors.New("exact frontend version is absent from GitHub Packages metadata")
		}
		metadata = exact
	}
	if metadata.Name != packageName || metadata.Version != version {
		return frontendPackageResolution{}, fmt.Errorf(
			"npm metadata identity mismatch: requested %s@%s, received %s@%s",
			packageName,
			version,
			metadata.Name,
			metadata.Version,
		)
	}
	if !validFrontendIntegrity(metadata.Dist.Integrity) {
		return frontendPackageResolution{}, errors.New("npm metadata dist.integrity must be one exact sha512 SRI")
	}
	tarball, err := validFrontendTarballURL(metadata.Dist.Tarball)
	if err != nil {
		return frontendPackageResolution{}, fmt.Errorf("npm metadata dist.tarball: %w", err)
	}
	if request.URL.Host == "npm.pkg.github.com" {
		resolvedURL, _ := url.Parse(tarball)
		if resolvedURL.Scheme != "https" || resolvedURL.Host != "npm.pkg.github.com" {
			return frontendPackageResolution{}, errors.New("GitHub Packages tarball must use https://npm.pkg.github.com")
		}
	}
	return frontendPackageResolution{Integrity: metadata.Dist.Integrity, Tarball: tarball}, nil
}

func validFrontendTarballURL(value string) (string, error) {
	if value == "" || value != strings.TrimSpace(value) || strings.ContainsAny(value, "\r\n\t") {
		return "", errors.New("must be one absolute stable URL")
	}
	tarball, err := url.Parse(value)
	if err != nil || !tarball.IsAbs() || tarball.Opaque != "" || tarball.Hostname() == "" || tarball.Path == "" {
		return "", errors.New("must be one absolute stable URL")
	}
	if tarball.User != nil {
		return "", errors.New("must not contain credentials")
	}
	if tarball.RawQuery != "" || tarball.Fragment != "" {
		return "", errors.New("must not contain a query or fragment")
	}
	switch tarball.Scheme {
	case "https":
		return tarball.String(), nil
	case "http":
		if loopbackRegistryHost(tarball.Hostname()) {
			return tarball.String(), nil
		}
		return "", errors.New("HTTP is allowed only for an explicit loopback fixture")
	default:
		return "", errors.New("must use HTTPS outside an explicit loopback fixture")
	}
}

func frontendMetadataEndpoint(registryURL, packageName, version string) (string, error) {
	packageName = strings.TrimSpace(packageName)
	version = strings.TrimSpace(version)
	if !frontendPackageNamePattern.MatchString(packageName) || !validSemanticVersion(version) {
		return "", errors.New("exact npm package and version are required")
	}
	registryURL = strings.TrimSpace(registryURL)
	if registryURL == "" {
		registryURL = defaultFrontendRegistryURL
	}
	registry, err := url.Parse(registryURL)
	if err != nil {
		return "", errors.New("invalid npm registry URL")
	}
	if registry.User != nil || registry.RawQuery != "" || registry.Fragment != "" ||
		(registry.Path != "" && registry.Path != "/") {
		return "", errors.New("npm registry URL must not contain credentials, query, fragment, or a path")
	}
	if registry.Scheme == "https" && registry.Host == "npm.pkg.github.com" {
		// Only this exact host may receive the process-scoped package token.
	} else if registry.Scheme != "http" || !loopbackRegistryHost(registry.Hostname()) {
		return "", errors.New("contributor npm registry override must be an explicit loopback HTTP endpoint")
	}
	registry.Path = "/" + packageName
	registry.RawPath = "/" + url.PathEscape(packageName)
	if registry.Host != "npm.pkg.github.com" {
		registry.Path += "/" + version
		registry.RawPath += "/" + url.PathEscape(version)
	}
	return registry.String(), nil
}

func loopbackRegistryHost(host string) bool {
	if strings.EqualFold(strings.TrimSpace(host), "localhost") {
		return true
	}
	address := net.ParseIP(host)
	return address != nil && address.IsLoopback()
}

func validFrontendIntegrity(value string) bool {
	if !strings.HasPrefix(value, "sha512-") || strings.ContainsAny(value, " \t\r\n") {
		return false
	}
	digest, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, "sha512-"))
	return err == nil && len(digest) == 64
}
