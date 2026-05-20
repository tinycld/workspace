package coreserver

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

// parsedManifest represents the validated fields from a package manifest.ts
type parsedManifest struct {
	Name        string            `json:"name"`
	Slug        string            `json:"slug"`
	Version     string            `json:"version"`
	Description string            `json:"description"`
	Routes      *manifestRoutes   `json:"routes"`
	Nav         *manifestNav      `json:"nav"`
	Server      *manifestServer   `json:"server,omitempty"`
	HasServer   bool              `json:"-"`
	RawJSON     map[string]any    `json:"-"`
}

type manifestRoutes struct {
	Directory string `json:"directory"`
}

type manifestNav struct {
	Label string `json:"label"`
	Icon  string `json:"icon"`
	Order int    `json:"order,omitempty"`
}

type manifestServer struct {
	Package string `json:"package"`
	Module  string `json:"module"`
}

var slugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)
var npmPackagePattern = regexp.MustCompile(`^(@[a-z0-9-~][a-z0-9-._~]*/)?[a-z0-9-~][a-z0-9-._~]*$`)
var goModulePattern = regexp.MustCompile(`^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+(/[a-z0-9][a-z0-9_-]*)+$`)

// parseManifestViaNode safely parses a manifest.ts by shelling out to Node.
// It avoids eval() / new Function() — instead uses a targeted regex extraction.
func parseManifestViaNode(packageDir string) (*parsedManifest, error) {
	script := `
const fs = require('fs');
const vm = require('vm');
const dir = process.argv[1];

let content = '';
for (const ext of ['ts', 'js']) {
    const p = dir + '/manifest.' + ext;
    try { content = fs.readFileSync(p, 'utf-8'); break; } catch {}
}
if (!content) { console.error('No manifest found'); process.exit(1); }

// Extract the object literal from export default or const assignment
const m = content.match(/(?:export\s+default|module\.exports\s*=)\s*(\{[\s\S]*\})/) ||
          content.match(/(?:const|let|var)\s+\w+\s*=\s*(\{[\s\S]*\})\s*(?:;?\s*$)/m);
if (!m) { console.error('Could not parse manifest object'); process.exit(1); }

// Parse in a sandboxed context with no access to Node globals
try {
    const sandbox = Object.create(null);
    const obj = vm.runInNewContext('(' + m[1] + ')', sandbox, { timeout: 5000 });
    console.log(JSON.stringify(obj));
} catch (e) {
    console.error('Failed to evaluate manifest: ' + e.message);
    process.exit(1);
}
`
	cmd := exec.Command("node", "-e", script, packageDir)
	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("manifest parse failed: %s", string(exitErr.Stderr))
		}
		return nil, fmt.Errorf("failed to run node: %w", err)
	}

	var raw map[string]any
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, fmt.Errorf("invalid manifest JSON: %w", err)
	}

	var manifest parsedManifest
	if err := json.Unmarshal(out, &manifest); err != nil {
		return nil, fmt.Errorf("manifest structure invalid: %w", err)
	}
	manifest.RawJSON = raw
	manifest.HasServer = manifest.Server != nil

	return &manifest, nil
}

// validateManifest checks that a parsed manifest meets all requirements.
// If allowServer is false (Phase 2), packages with server fields are rejected.
func validateManifest(m *parsedManifest, allowServer bool, bundledSlugs map[string]bool) error {
	if m.Name == "" {
		return fmt.Errorf("manifest missing required field: name")
	}
	if m.Slug == "" {
		return fmt.Errorf("manifest missing required field: slug")
	}
	if !slugPattern.MatchString(m.Slug) {
		return fmt.Errorf("invalid slug %q: must match ^[a-z0-9][a-z0-9-]*$", m.Slug)
	}
	if m.Version == "" {
		return fmt.Errorf("manifest missing required field: version")
	}
	if m.Routes == nil || m.Routes.Directory == "" {
		return fmt.Errorf("manifest missing required field: routes.directory")
	}
	if m.Nav == nil {
		return fmt.Errorf("manifest missing required field: nav")
	}
	if m.Nav.Label == "" {
		return fmt.Errorf("manifest missing required field: nav.label")
	}
	if m.Nav.Icon == "" {
		return fmt.Errorf("manifest missing required field: nav.icon")
	}

	// Check for path traversal
	for _, dir := range []string{m.Routes.Directory} {
		if strings.Contains(dir, "..") {
			return fmt.Errorf("path traversal detected in directory: %s", dir)
		}
	}

	// Phase 2: reject packages with server components
	if !allowServer && m.HasServer {
		return fmt.Errorf("package %q has server components which require Phase 3 support", m.Slug)
	}

	// Validate server field if present
	if m.Server != nil {
		if m.Server.Module == "" {
			return fmt.Errorf("server.module is required when server field is present")
		}
		if m.Server.Package == "" {
			return fmt.Errorf("server.package is required when server field is present")
		}
		if strings.Contains(m.Server.Module, "..") {
			return fmt.Errorf("path traversal detected in server.module")
		}
		if strings.Contains(m.Server.Package, "..") {
			return fmt.Errorf("path traversal detected in server.package")
		}
		// Go module naming: must look like a Go import path
		if !goModulePattern.MatchString(m.Server.Module) {
			return fmt.Errorf("server.module %q doesn't look like a valid Go import path", m.Server.Module)
		}
	}

	// Check collision with bundled package slugs
	if bundledSlugs[m.Slug] {
		return fmt.Errorf("slug %q conflicts with a bundled package", m.Slug)
	}

	return nil
}

// validateNpmPackageName checks that a string looks like a valid npm package name.
func validateNpmPackageName(name string) error {
	if name == "" {
		return fmt.Errorf("npm package name is required")
	}
	if !npmPackagePattern.MatchString(name) {
		return fmt.Errorf("invalid npm package name: %s", name)
	}
	return nil
}

// isTrustedScope returns true if the package name starts with @tinycld/
func isTrustedScope(npmPackage string) bool {
	return strings.HasPrefix(npmPackage, "@tinycld/")
}
