package coreserver

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/jsvm"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"github.com/pocketbase/pocketbase/tools/hook"

	"tinycld.org/core/notify"
	"tinycld.org/core/realtime"
)

// Options configure the core server's registered plugins, flags, and wiring.
// A runnable `main` package builds this struct and calls Register(app, opts).
type Options struct {
	// HTTP server
	PublicDir    string
	FallbackFile string

	// ReleasesDir is the directory containing per-deploy web bundle state.
	// On a deployed image it lives on the persistent volume and contains:
	//   - <id>/             one dir per retained release, holding app.html
	//                       + release-id.txt
	//   - current           symlink → <id> for the active release
	//   - _static/          cross-release asset pool (filled by entrypoint)
	// Used by the asset-pool handlers, /api/version, and the SPA fallback.
	// When empty or missing on disk the server falls back to the legacy
	// single-PublicDir behavior used in dev.
	ReleasesDir string

	// Schema generation
	TypesDir string

	// JS hooks / migrations plugins
	HooksDir      string
	HooksWatch    bool
	HooksPoolSize int
	MigrationsDir string
	Automigrate   bool

	// BinaryName is the file name of the running app binary (without
	// directory). Used by package install/upgrade flows to locate the
	// existing binary for migrate-and-swap operations. Defaults to
	// `filepath.Base(os.Args[0])` when empty.
	BinaryName string

	// RegisterExtras is called after core's own registrations. Use it to inject
	// code that lives outside this package — in particular, the generator's
	// `registerPackageExtensions(app)` which wires sibling package servers.
	RegisterExtras func(app *pocketbase.PocketBase)
}

// binaryName holds the resolved app binary name (set by Register()).
// Package-internal helpers in pkg_install.go and pkg_go_build.go read it to
// locate the running binary on disk. Default `tinycld` matches the original
// app; production callers should set Options.BinaryName.
var binaryName = "tinycld"

// Register configures a pocketbase.PocketBase app with all of core's
// server-side behavior: jsvm, migratecmd, notifications, invites, audit,
// package management, setup bootstrap, account deletion, schema generation,
// and static file serving.
//
// Callers provide the `app` (so they can build it with their own Sentry/env
// setup) and Options. Run `app.Start()` after this returns.
func Register(app *pocketbase.PocketBase, opts Options) {
	if opts.BinaryName != "" {
		binaryName = opts.BinaryName
	} else if len(os.Args) > 0 {
		// Fall back to the running executable's basename. Strips ".test"
		// in test contexts so package-install code paths still see a
		// production-shaped name (purely cosmetic).
		base := filepath.Base(os.Args[0])
		if base != "" && base != "." && base != "/" {
			binaryName = base
		}
	}

	registerFlags(app, &opts)

	// Parse CLI args so flag-backed fields are populated before we register
	// plugins that read them (jsvm, migratecmd).
	_ = app.RootCmd.ParseFlags(os.Args[1:])

	// Sentry must register first so its router middleware sees every route.
	// Middleware bound after a route is added does not apply retroactively.
	RegisterSentry(app)

	jsvm.MustRegister(app, jsvm.Config{
		MigrationsDir: opts.MigrationsDir,
		HooksDir:      opts.HooksDir,
		HooksWatch:    opts.HooksWatch,
		HooksPoolSize: opts.HooksPoolSize,
	})

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		TemplateLang: migratecmd.TemplateLangJS,
		Automigrate:  opts.Automigrate,
		Dir:          opts.MigrationsDir,
	})

	if opts.RegisterExtras != nil {
		opts.RegisterExtras(app)
	}

	notify.Register(app)
	notify.RegisterCommentMentionHooks(app)
	realtime.Register(app, realtime.Options{})
	RegisterInviteEndpoint(app)
	RegisterInviteLinkEndpoints(app)
	RegisterInviteLifecycle(app)
	RegisterAuditHooks(app)
	RegisterOrgPkgEnabledHooks(app)
	RegisterPackageInstallEndpoints(app)
	RegisterSetupBootstrap(app)
	RegisterAccountDelete(app)
	RegisterDemoStart(app)
	RegisterDemoLead(app)
	RegisterDemoReset(app)
	RegisterUsersFieldGuard(app)
	RegisterUsersDemoAuditHook(app)

	registerSchemaHooks(app, opts.TypesDir)
	registerDavCorsBypass(app)
	registerStaticServe(app, opts)
}

// registerDavCorsBypass wraps PocketBase's default CORS middleware so that
// requests under /caldav, /carddav, and /drive skip CORS entirely.
//
// Why: the default middleware always returns 204 for OPTIONS requests
// (including non-browser DAV clients like macOS Finder that send no Origin
// header). The 204 has no DAV: or Allow: headers, so Finder concludes the
// endpoint is not a DAV server and aborts with a generic "problem connecting
// to the server" dialog. CORS is irrelevant for these protocols — clients
// are not browsers — so we let DAV requests bypass CORS and reach the
// underlying handler, which sets the correct DAV class advertisement.
func registerDavCorsBypass(app *pocketbase.PocketBase) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		for _, mw := range e.Router.Middlewares {
			if mw.Id != apis.DefaultCorsMiddlewareId {
				continue
			}
			original := mw.Func
			mw.Func = func(re *core.RequestEvent) error {
				if isDavPath(re.Request.URL.Path) {
					return re.Next()
				}
				return original(re)
			}
			break
		}
		return e.Next()
	})
}

func isDavPath(path string) bool {
	return strings.HasPrefix(path, "/caldav") ||
		strings.HasPrefix(path, "/carddav") ||
		strings.HasPrefix(path, "/drive") ||
		strings.HasPrefix(path, "/.well-known/caldav") ||
		strings.HasPrefix(path, "/.well-known/carddav") ||
		strings.HasPrefix(path, "/.well-known/webdav")
}

// registerFlags binds the persistent CLI flags shared by every tinycld server.
// Option fields are used as defaults; the user can override via --flag.
func registerFlags(app *pocketbase.PocketBase, opts *Options) {
	f := app.RootCmd.PersistentFlags()
	f.StringVar(&opts.HooksDir, "hooksDir", opts.HooksDir, "the directory with the JS app hooks")
	f.BoolVar(&opts.HooksWatch, "hooksWatch", opts.HooksWatch,
		"auto restart the app on pb_hooks file change; it has no effect on Windows")
	f.IntVar(&opts.HooksPoolSize, "hooksPool", opts.HooksPoolSize,
		"the total prewarm goja.Runtime instances for the JS app hooks execution")
	f.StringVar(&opts.MigrationsDir, "migrationsDir", opts.MigrationsDir,
		"the directory with the user defined migrations")
	f.BoolVar(&opts.Automigrate, "automigrate", opts.Automigrate, "enable/disable auto migrations")
	f.StringVar(&opts.PublicDir, "publicDir", opts.PublicDir, "the directory to serve static files")
	f.StringVar(&opts.FallbackFile, "fallbackFile", opts.FallbackFile,
		"fallback to this file on missing static path for SPA routes")
	f.StringVar(&opts.ReleasesDir, "releasesDir", opts.ReleasesDir,
		"the directory containing per-release web bundle subdirectories")
	f.StringVar(&opts.TypesDir, "typesDir", opts.TypesDir,
		"the directory to write generated TypeScript schema files")
}

func registerSchemaHooks(app *pocketbase.PocketBase, typesDir string) {
	app.OnCollectionCreateRequest().BindFunc(func(e *core.CollectionRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		GenerateSchemas(e.App, typesDir)
		return nil
	})

	app.OnCollectionUpdateRequest().BindFunc(func(e *core.CollectionRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		GenerateSchemas(e.App, typesDir)
		return nil
	})

	app.OnCollectionDeleteRequest().BindFunc(func(e *core.CollectionRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		GenerateSchemas(e.App, typesDir)
		return nil
	})
}

func registerStaticServe(app *pocketbase.PocketBase, opts Options) {
	app.OnServe().Bind(&hook.Handler[*core.ServeEvent]{
		Func: func(e *core.ServeEvent) error {
			GenerateSchemas(e.App, opts.TypesDir)
			SyncBundledPackages(e.App)

			// Per-route asset handlers, registered before the catch-all so
			// the asset prefixes win. Both paths read from the cross-release
			// asset pool the entrypoint maintains under
			// <releasesDir>/_static/. _expo/static/ filenames are fully
			// content-hashed (immutable), while /assets/ contains a few
			// stable names like app-icon.png so a shorter max-age applies.
			if opts.ReleasesDir != "" {
				e.Router.GET("/_expo/static/{path...}", PoolAssets(opts.ReleasesDir, "_expo/static", "public, max-age=31536000, immutable"))
				e.Router.GET("/assets/{path...}", PoolAssets(opts.ReleasesDir, "assets", "public, max-age=300"))
				e.Router.GET("/api/version", VersionHandler(opts.ReleasesDir))
			}

			if !e.Router.HasRoute(http.MethodGet, "/{path...}") {
				if opts.ReleasesDir != "" {
					e.Router.Any("/{path...}", StaticWithDynamicFallback(opts.PublicDir, opts.ReleasesDir))
				} else {
					e.Router.Any("/{path...}", StaticWithFallback(opts.PublicDir, opts.FallbackFile))
				}
			}

			return e.Next()
		},
		Priority: 999,
	})
}
