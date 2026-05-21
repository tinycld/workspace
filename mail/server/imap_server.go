package mail

import (
	"crypto/tls"
	"fmt"
	"net"
	"os"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapserver"
	"github.com/pocketbase/pocketbase"
	"golang.org/x/crypto/acme/autocert"
)

// StartIMAPServer reads configuration from environment variables, creates an
// IMAP server, starts listening, and returns a shutdown function.
//
// In production with TLS (via env vars or autocert), only an implicit TLS
// listener on :993 is started — no plain-text IMAP is exposed.
// In dev mode, a plain listener on :1143 is started with optional STARTTLS
// and an optional implicit TLS listener on :1993.
func StartIMAPServer(app *pocketbase.PocketBase, certManager *autocert.Manager) (func(), error) {
	if os.Getenv("IMAP_ENABLED") == "false" {
		app.Logger().Info("IMAP server disabled via IMAP_ENABLED=false")
		return func() {}, nil
	}

	tlsConfig, err := resolveTLSConfig("IMAP_TLS_CERT", "IMAP_TLS_KEY", "", "", certManager)
	if err != nil {
		return nil, err
	}

	// In production with TLS: only implicit TLS, no plain listener
	if !app.IsDev() && tlsConfig != nil {
		return startIMAPTLSOnly(app, tlsConfig)
	}

	// Dev mode: plain listener with optional STARTTLS + optional implicit TLS
	return startIMAPDev(app, tlsConfig)
}

func startIMAPTLSOnly(app *pocketbase.PocketBase, tlsConfig *tls.Config) (func(), error) {
	imapsAddr := os.Getenv("IMAPS_ADDR")
	if imapsAddr == "" {
		imapsAddr = ":993"
	}

	server := newIMAPServerInstance(app, tlsConfig, false)

	tlsLn, err := tls.Listen("tcp", imapsAddr, tlsConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to listen on %s: %w", imapsAddr, err)
	}
	app.Logger().Info("IMAPS server listening (implicit TLS, no plain listener)", "addr", imapsAddr)
	go func() {
		if err := server.Serve(tlsLn); err != nil {
			app.Logger().Error("IMAPS server error", "addr", imapsAddr, "error", err)
		}
	}()

	return func() {
		app.Logger().Info("Shutting down IMAP server")
		tlsLn.Close()
		server.Close()
	}, nil
}

func startIMAPDev(app *pocketbase.PocketBase, tlsConfig *tls.Config) (func(), error) {
	addr := os.Getenv("IMAP_ADDR")
	if addr == "" {
		addr = ":1143"
	}

	insecureAuth := os.Getenv("IMAP_INSECURE_AUTH") == "true" || app.IsDev()
	server := newIMAPServerInstance(app, tlsConfig, insecureAuth)

	plainLn, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("failed to listen on %s: %w", addr, err)
	}
	app.Logger().Info("IMAP server listening", "addr", addr, "starttls", tlsConfig != nil)
	go func() {
		if err := server.Serve(plainLn); err != nil {
			app.Logger().Error("IMAP server error", "addr", addr, "error", err)
		}
	}()

	var tlsLn net.Listener
	if tlsConfig != nil {
		imapsAddr := os.Getenv("IMAPS_ADDR")
		if imapsAddr == "" {
			imapsAddr = ":1993"
		}
		tlsLn, err = tls.Listen("tcp", imapsAddr, tlsConfig)
		if err != nil {
			plainLn.Close()
			return nil, fmt.Errorf("failed to listen on %s: %w", imapsAddr, err)
		}
		app.Logger().Info("IMAPS server listening (implicit TLS)", "addr", imapsAddr)
		go func() {
			if err := server.Serve(tlsLn); err != nil {
				app.Logger().Error("IMAPS server error", "addr", imapsAddr, "error", err)
			}
		}()
	}

	return func() {
		app.Logger().Info("Shutting down IMAP server")
		plainLn.Close()
		if tlsLn != nil {
			tlsLn.Close()
		}
		server.Close()
	}, nil
}

func newIMAPServerInstance(app *pocketbase.PocketBase, tlsConfig *tls.Config, insecureAuth bool) *imapserver.Server {
	return imapserver.New(&imapserver.Options{
		NewSession: func(conn *imapserver.Conn) (imapserver.Session, *imapserver.GreetingData, error) {
			sess := newIMAPSession(app)
			return sess, nil, nil
		},
		Caps: imap.CapSet{
			imap.CapIMAP4rev1:   {},
			imap.CapIMAP4rev2:   {},
			imap.CapSpecialUse:  {},
			imap.CapMove:        {},
			imap.CapIdle:        {},
			imap.CapLiteralPlus: {},
		},
		TLSConfig:    tlsConfig,
		InsecureAuth: insecureAuth,
	})
}
