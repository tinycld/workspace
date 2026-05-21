package mail

import (
	"crypto/tls"
	"fmt"
	"net"
	"os"
	"time"

	"github.com/emersion/go-smtp"
	"github.com/pocketbase/pocketbase"
	"golang.org/x/crypto/acme/autocert"
)

// StartSMTPServer reads configuration from environment variables, creates an
// SMTP submission server, starts listening, and returns a shutdown function.
//
// In production with TLS (via env vars or autocert), only an implicit TLS
// listener on :465 is started — no plain-text SMTP is exposed.
// In dev mode, a plain listener on :1587 is started with optional STARTTLS
// and an optional implicit TLS listener on :1465.
func StartSMTPServer(app *pocketbase.PocketBase, certManager *autocert.Manager) (func(), error) {
	if os.Getenv("SMTP_ENABLED") == "false" {
		app.Logger().Info("SMTP server disabled via SMTP_ENABLED=false")
		return func() {}, nil
	}

	tlsConfig, err := resolveTLSConfig("SMTP_TLS_CERT", "SMTP_TLS_KEY", "IMAP_TLS_CERT", "IMAP_TLS_KEY", certManager)
	if err != nil {
		return nil, err
	}

	// In production with TLS: only implicit TLS, no plain listener
	if !app.IsDev() && tlsConfig != nil {
		return startSMTPTLSOnly(app, tlsConfig)
	}

	// Dev mode: plain listener with optional STARTTLS + optional implicit TLS
	return startSMTPDev(app, tlsConfig)
}

func newSMTPServerInstance(app *pocketbase.PocketBase, tlsConfig *tls.Config, insecureAuth bool) *smtp.Server {
	domain := os.Getenv("SMTP_DOMAIN")
	if domain == "" {
		domain = "localhost"
	}

	backend := &smtpBackend{app: app}
	server := smtp.NewServer(backend)
	server.Domain = domain
	server.AllowInsecureAuth = insecureAuth
	server.MaxMessageBytes = 25 << 20
	server.EnableSMTPUTF8 = true
	server.ReadTimeout = 60 * time.Second
	server.WriteTimeout = 60 * time.Second
	if tlsConfig != nil {
		server.TLSConfig = tlsConfig
	}
	return server
}

func startSMTPTLSOnly(app *pocketbase.PocketBase, tlsConfig *tls.Config) (func(), error) {
	smtpsAddr := os.Getenv("SMTPS_ADDR")
	if smtpsAddr == "" {
		smtpsAddr = ":465"
	}

	server := newSMTPServerInstance(app, tlsConfig, false)
	server.Addr = smtpsAddr

	tlsLn, err := tls.Listen("tcp", smtpsAddr, tlsConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to listen on %s: %w", smtpsAddr, err)
	}
	app.Logger().Info("SMTPS server listening (implicit TLS, no plain listener)", "addr", smtpsAddr)
	go func() {
		if err := server.Serve(tlsLn); err != nil {
			app.Logger().Error("SMTPS server error", "addr", smtpsAddr, "error", err)
		}
	}()

	return func() {
		app.Logger().Info("Shutting down SMTP server")
		tlsLn.Close()
		server.Close()
	}, nil
}

func startSMTPDev(app *pocketbase.PocketBase, tlsConfig *tls.Config) (func(), error) {
	addr := os.Getenv("SMTP_ADDR")
	if addr == "" {
		addr = ":1587"
	}

	insecureAuth := os.Getenv("SMTP_INSECURE_AUTH") == "true" || app.IsDev()
	server := newSMTPServerInstance(app, tlsConfig, insecureAuth)
	server.Addr = addr

	plainLn, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("failed to listen on %s: %w", addr, err)
	}
	app.Logger().Info("SMTP server listening", "addr", addr, "starttls", tlsConfig != nil)
	go func() {
		if err := server.Serve(plainLn); err != nil {
			app.Logger().Error("SMTP server error", "addr", addr, "error", err)
		}
	}()

	var tlsLn net.Listener
	if tlsConfig != nil {
		smtpsAddr := os.Getenv("SMTPS_ADDR")
		if smtpsAddr == "" {
			smtpsAddr = ":1465"
		}
		tlsLn, err = tls.Listen("tcp", smtpsAddr, tlsConfig)
		if err != nil {
			plainLn.Close()
			return nil, fmt.Errorf("failed to listen on %s: %w", smtpsAddr, err)
		}
		app.Logger().Info("SMTPS server listening (implicit TLS)", "addr", smtpsAddr)
		go func() {
			if err := server.Serve(tlsLn); err != nil {
				app.Logger().Error("SMTPS server error", "addr", smtpsAddr, "error", err)
			}
		}()
	}

	return func() {
		app.Logger().Info("Shutting down SMTP server")
		plainLn.Close()
		if tlsLn != nil {
			tlsLn.Close()
		}
		server.Close()
	}, nil
}
