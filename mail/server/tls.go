package mail

import (
	"crypto/tls"
	"fmt"
	"os"

	"golang.org/x/crypto/acme/autocert"
)

// loadTLSConfig loads a TLS certificate from the given environment variable names.
// It tries the primary env vars first, then the fallback env vars.
// Returns (nil, nil) if no cert paths are configured — TLS is optional in dev.
func loadTLSConfig(certEnv, keyEnv, fallbackCertEnv, fallbackKeyEnv string) (*tls.Config, error) {
	certPath := os.Getenv(certEnv)
	keyPath := os.Getenv(keyEnv)
	if certPath == "" && fallbackCertEnv != "" {
		certPath = os.Getenv(fallbackCertEnv)
	}
	if keyPath == "" && fallbackKeyEnv != "" {
		keyPath = os.Getenv(fallbackKeyEnv)
	}
	if certPath == "" || keyPath == "" {
		return nil, nil
	}

	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load TLS cert (%s/%s): %w", certEnv, keyEnv, err)
	}

	return hardenedTLSConfig(&tls.Config{
		Certificates: []tls.Certificate{cert},
	}), nil
}

// hardenedTLSConfig applies hardened TLS settings to the given config.
var hardenedCipherSuites = []uint16{
	tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
	tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
	tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
	tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
	tls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256,
	tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256,
}

func hardenedTLSConfig(cfg *tls.Config) *tls.Config {
	cfg.MinVersion = tls.VersionTLS12
	cfg.CipherSuites = hardenedCipherSuites
	return cfg
}

// tlsConfigFromCertManager creates a hardened TLS config using the autocert manager.
func tlsConfigFromCertManager(certManager *autocert.Manager) *tls.Config {
	return hardenedTLSConfig(&tls.Config{
		GetCertificate: certManager.GetCertificate,
	})
}

// resolveTLSConfig returns a TLS config using the first available source:
// (1) cert/key files from environment variables, (2) autocert manager, (3) nil.
func resolveTLSConfig(certEnv, keyEnv, fallbackCertEnv, fallbackKeyEnv string, certManager *autocert.Manager) (*tls.Config, error) {
	cfg, err := loadTLSConfig(certEnv, keyEnv, fallbackCertEnv, fallbackKeyEnv)
	if err != nil {
		return nil, err
	}
	if cfg != nil {
		return cfg, nil
	}
	if certManager != nil {
		return tlsConfigFromCertManager(certManager), nil
	}
	return nil, nil
}
