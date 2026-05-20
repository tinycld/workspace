package coreserver

import (
	"os"
	"strings"
)

// LoadEnvFile reads a .env file from the working directory (or parent) and
// sets any variables that are not already present in the environment.
func LoadEnvFile() {
	envPath := ".env"
	if _, err := os.Stat(envPath); os.IsNotExist(err) {
		envPath = "../.env"
		if _, err := os.Stat(envPath); os.IsNotExist(err) {
			return
		}
	}

	data, err := os.ReadFile(envPath)
	if err != nil {
		return
	}

	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'')) {
			val = val[1 : len(val)-1]
		}
		if _, exists := os.LookupEnv(key); !exists {
			os.Setenv(key, val)
		}
	}
}

// GetEnvironment returns the runtime environment name ("development" or
// "production") derived from the ENVIRONMENT env var or the --dev flag.
func GetEnvironment() string {
	if env := os.Getenv("ENVIRONMENT"); env != "" {
		return env
	}
	for _, arg := range os.Args {
		if arg == "--dev" {
			return "development"
		}
	}
	return "production"
}

// HasFlag returns true when an arg like --name or --name=value is present.
func HasFlag(name string) bool {
	for _, arg := range os.Args[1:] {
		if arg == name || strings.HasPrefix(arg, name+"=") {
			return true
		}
	}
	return false
}

// HasSubcommand returns true when an arg matches a positional subcommand.
func HasSubcommand(name string) bool {
	for _, arg := range os.Args[1:] {
		if !strings.HasPrefix(arg, "-") && arg == name {
			return true
		}
	}
	return false
}

// HasDomainArgs returns true when positional arguments follow the "serve"
// subcommand (e.g. "./tinycld serve mail.example.com"). These are domain
// names that PocketBase uses for autocert TLS provisioning.
func HasDomainArgs() bool {
	return len(DomainArgs()) > 0
}

// DomainArgs returns positional arguments that follow the "serve" subcommand
// — the domain list used for autocert TLS provisioning.
func DomainArgs() []string {
	var domains []string
	foundServe := false
	for _, arg := range os.Args[1:] {
		if arg == "serve" {
			foundServe = true
			continue
		}
		if !foundServe {
			continue
		}
		if !strings.HasPrefix(arg, "-") {
			domains = append(domains, arg)
		}
	}
	return domains
}
