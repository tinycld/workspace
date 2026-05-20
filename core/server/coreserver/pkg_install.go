package coreserver

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// ---------- types ----------

type installJob struct {
	ID        string
	Action    string // "install" or "uninstall"
	Slug      string
	NpmPkg    string
	Progress  int
	Step      string
	Status    string // "running", "success", "failed", "rolled_back"
	Error     string
	LogLines  []string
	Done      chan struct{}
	listeners []chan sseEvent
	mu        sync.Mutex
}

type sseEvent struct {
	Event string `json:"event"`
	Data  any    `json:"data"`
}

type progressData struct {
	Step     string `json:"step"`
	Progress int    `json:"progress"`
	Message  string `json:"message"`
}

type completeData struct {
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

// ---------- global state ----------

var (
	installMu   sync.Mutex
	currentJob  *installJob
)

// ---------- registration ----------

func RegisterPackageInstallEndpoints(app *pocketbase.PocketBase) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		g := e.Router.Group("/api/admin/packages")

		g.POST("/install", func(re *core.RequestEvent) error {
			return handleInstall(app, re)
		}).BindFunc(requireSuperuser)

		g.POST("/uninstall", func(re *core.RequestEvent) error {
			return handleUninstall(app, re)
		}).BindFunc(requireSuperuser)

		g.GET("/events/{jobId}", func(re *core.RequestEvent) error {
			return handleEvents(re)
		}).BindFunc(func(re *core.RequestEvent) error {
			return requireSuperuserOrToken(app, re)
		})

		g.GET("/status/{slug}", func(re *core.RequestEvent) error {
			return handleStatus(app, re)
		}).BindFunc(requireSuperuser)

		return e.Next()
	})
}

func requireSuperuser(re *core.RequestEvent) error {
	if !re.HasSuperuserAuth() {
		return re.ForbiddenError("Superuser access required", nil)
	}
	return re.Next()
}

// requireSuperuserOrToken allows SSE connections to authenticate via query param
// since browser EventSource does not support custom headers.
func requireSuperuserOrToken(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	// Try standard auth first
	if re.HasSuperuserAuth() {
		return re.Next()
	}

	// Fall back to query param token for SSE
	token := re.Request.URL.Query().Get("token")
	if token != "" {
		superusers, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
		if err == nil {
			record, err := app.FindAuthRecordByToken(token, superusers.Id)
			if err == nil && record != nil {
				return re.Next()
			}
		}
	}

	return re.ForbiddenError("Superuser access required", nil)
}

// ---------- handlers ----------

func handleInstall(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	var body struct {
		NpmPackage string `json:"npmPackage"`
	}
	if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil {
		return re.BadRequestError("Invalid request body", err)
	}

	if err := validateNpmPackageName(body.NpmPackage); err != nil {
		return re.BadRequestError(err.Error(), nil)
	}

	installMu.Lock()
	if currentJob != nil {
		info := map[string]any{
			"jobId":  currentJob.ID,
			"action": currentJob.Action,
			"slug":   currentJob.Slug,
			"status": currentJob.Status,
		}
		installMu.Unlock()
		return re.JSON(http.StatusConflict, map[string]any{
			"error":      "Another install operation is in progress",
			"currentJob": info,
		})
	}

	jobId := fmt.Sprintf("job_%d", time.Now().UnixMilli())
	job := &installJob{
		ID:     jobId,
		Action: "install",
		NpmPkg: body.NpmPackage,
		Status: "running",
		Done:   make(chan struct{}),
	}
	currentJob = job
	installMu.Unlock()

	go runInstallPipeline(app, job)

	return re.JSON(http.StatusAccepted, map[string]any{"jobId": jobId})
}

func handleUninstall(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	var body struct {
		Slug string `json:"slug"`
	}
	if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil {
		return re.BadRequestError("Invalid request body", err)
	}

	if body.Slug == "" {
		return re.BadRequestError("slug is required", nil)
	}

	installMu.Lock()
	if currentJob != nil {
		info := map[string]any{
			"jobId":  currentJob.ID,
			"action": currentJob.Action,
			"slug":   currentJob.Slug,
			"status": currentJob.Status,
		}
		installMu.Unlock()
		return re.JSON(http.StatusConflict, map[string]any{
			"error":      "Another operation is in progress",
			"currentJob": info,
		})
	}

	jobId := fmt.Sprintf("job_%d", time.Now().UnixMilli())
	job := &installJob{
		ID:     jobId,
		Action: "uninstall",
		Slug:   body.Slug,
		Status: "running",
		Done:   make(chan struct{}),
	}
	currentJob = job
	installMu.Unlock()

	go runUninstallPipeline(app, job)

	return re.JSON(http.StatusAccepted, map[string]any{"jobId": jobId})
}

func handleEvents(re *core.RequestEvent) error {
	jobId := re.Request.PathValue("jobId")

	installMu.Lock()
	job := currentJob
	installMu.Unlock()

	if job == nil || job.ID != jobId {
		return re.NotFoundError("Job not found", nil)
	}

	// Set up SSE
	w := re.Response
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		return re.InternalServerError("Streaming not supported", nil)
	}

	ch := make(chan sseEvent, 64)
	job.mu.Lock()
	job.listeners = append(job.listeners, ch)
	// Send current state as initial event
	if job.Progress > 0 {
		ch <- sseEvent{Event: "progress", Data: progressData{
			Step:     job.Step,
			Progress: job.Progress,
			Message:  job.Step,
		}}
	}
	job.mu.Unlock()

	ctx := re.Request.Context()
	for {
		select {
		case <-ctx.Done():
			return nil
		case evt, ok := <-ch:
			if !ok {
				return nil
			}
			data, _ := json.Marshal(evt.Data)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", evt.Event, data)
			flusher.Flush()
			if evt.Event == "complete" {
				return nil
			}
		}
	}
}

func handleStatus(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	slug := re.Request.PathValue("slug")

	record, err := app.FindFirstRecordByFilter(
		"pkg_install_log",
		"pkg_slug = {:slug}",
		map[string]any{"slug": slug},
	)
	if err != nil {
		return re.NotFoundError("No install log found for this package", nil)
	}

	return re.JSON(http.StatusOK, map[string]any{
		"id":        record.Id,
		"action":    record.GetString("action"),
		"status":    record.GetString("status"),
		"error":     record.GetString("error"),
		"startedAt": record.GetString("started_at"),
		"completedAt": record.GetString("completed_at"),
	})
}

// ---------- install pipeline ----------

func runInstallPipeline(app *pocketbase.PocketBase, job *installJob) {
	defer func() {
		installMu.Lock()
		currentJob = nil
		installMu.Unlock()
		close(job.Done)
	}()

	// Resolve paths
	serverDir := resolveServerDir()
	rootDir := filepath.Dir(serverDir)
	packagesDir := filepath.Join(rootDir, "packages")

	// Create install log record
	logRecord := createInstallLog(app, job, "install")

	var rollbackStack []func()
	rollback := func() {
		for i := len(rollbackStack) - 1; i >= 0; i-- {
			rollbackStack[i]()
		}
	}

	fail := func(step string, err error) {
		job.Status = "failed"
		job.Error = fmt.Sprintf("Failed at %s: %v", step, err)
		emitProgress(job, step, job.Progress, "FAILED: "+err.Error())
		emitComplete(job, "failed", job.Error)
		rollback()
		finalizeInstallLog(app, logRecord, "failed", job.Error, job.LogLines)
	}

	// Step 1: Validate npm package name (5%)
	emitProgress(job, "Validating package name", 5, "Checking "+job.NpmPkg)
	if err := validateNpmPackageName(job.NpmPkg); err != nil {
		fail("validate", err)
		return
	}
	if !isTrustedScope(job.NpmPkg) {
		emitProgress(job, "Security warning", 8, "Package is not in @tinycld/ scope — proceed with caution")
	}

	// Step 2: npm pack (20%)
	emitProgress(job, "Downloading package", 15, "Running npm pack "+job.NpmPkg)
	tmpDir, err := os.MkdirTemp("", "tinycld-pkg-*")
	if err != nil {
		fail("tmpdir", err)
		return
	}
	defer os.RemoveAll(tmpDir)

	packOut, err := runCmd(rootDir, "npm", "pack", job.NpmPkg, "--pack-destination", tmpDir)
	if err != nil {
		fail("npm pack", fmt.Errorf("%v: %s", err, packOut))
		return
	}
	emitProgress(job, "Downloaded package", 20, "Package downloaded")

	// Step 3: Untar and parse manifest (30%)
	emitProgress(job, "Parsing manifest", 25, "Extracting and validating manifest")
	tgzFiles, _ := filepath.Glob(filepath.Join(tmpDir, "*.tgz"))
	if len(tgzFiles) == 0 {
		fail("untar", fmt.Errorf("no .tgz file found after npm pack"))
		return
	}
	extractDir := filepath.Join(tmpDir, "extracted")
	_, err = runCmd(tmpDir, "tar", "xzf", tgzFiles[0], "-C", tmpDir)
	if err != nil {
		fail("untar", err)
		return
	}
	// npm pack extracts to a "package" subdirectory
	extractDir = filepath.Join(tmpDir, "package")
	if _, statErr := os.Stat(extractDir); statErr != nil {
		fail("untar", fmt.Errorf("extracted package directory not found"))
		return
	}

	manifest, err := parseManifestViaNode(extractDir)
	if err != nil {
		fail("parse manifest", err)
		return
	}
	job.Slug = manifest.Slug
	emitProgress(job, "Manifest parsed", 30, fmt.Sprintf("Package: %s (%s)", manifest.Name, manifest.Slug))

	// Step 4: Validate manifest (35%)
	emitProgress(job, "Validating manifest", 33, "Checking manifest requirements")
	bundledSlugs := getBundledSlugs(app)
	hasGoPrereqs := checkGoBuildPrereqs() == nil
	if err := validateManifest(manifest, hasGoPrereqs, bundledSlugs); err != nil {
		fail("validate manifest", err)
		return
	}
	emitProgress(job, "Manifest valid", 35, "All validation checks passed")

	// Step 5: Copy to packages/<slug>/ (40%)
	pkgDest := filepath.Join(packagesDir, manifest.Slug)
	emitProgress(job, "Installing files", 38, "Copying to "+pkgDest)
	if err := copyDir(extractDir, pkgDest); err != nil {
		fail("copy", err)
		return
	}
	rollbackStack = append(rollbackStack, func() {
		os.RemoveAll(pkgDest)
		log.Printf("pkg_install: rollback — removed %s", pkgDest)
	})
	emitProgress(job, "Files installed", 40, "Package files copied")

	// Step 6: Write installed-packages.json (45%)
	emitProgress(job, "Updating registry", 43, "Writing installed-packages.json")
	installedPath := filepath.Join(rootDir, "installed-packages.json")
	prevInstalled, _ := os.ReadFile(installedPath)
	if err := addInstalledPackage(installedPath, job.NpmPkg, manifest.Slug); err != nil {
		fail("write installed-packages.json", err)
		return
	}
	rollbackStack = append(rollbackStack, func() {
		if prevInstalled != nil {
			os.WriteFile(installedPath, prevInstalled, 0o644)
		} else {
			os.Remove(installedPath)
		}
		log.Printf("pkg_install: rollback — restored installed-packages.json")
	})
	emitProgress(job, "Registry updated", 45, "installed-packages.json written")

	// Step 7: npm install (55%)
	emitProgress(job, "Installing dependencies", 50, "Running npm install")
	npmOut, err := runCmd(rootDir, "npm", "install")
	if err != nil {
		fail("npm install", fmt.Errorf("%v: %s", err, npmOut))
		return
	}
	emitProgress(job, "Dependencies installed", 55, "npm install complete")

	// Step 8: Regenerate wiring (65%)
	emitProgress(job, "Generating wiring", 60, "Running package generation script")
	genOut, err := runCmd(rootDir, "npx", "tsx", "scripts/generate-packages.ts")
	if err != nil {
		fail("generate", fmt.Errorf("%v: %s", err, genOut))
		return
	}
	rollbackStack = append(rollbackStack, func() {
		// Re-run generation without the failed package
		runCmd(rootDir, "npx", "tsx", "scripts/generate-packages.ts")
		log.Printf("pkg_install: rollback — re-ran generation")
	})
	emitProgress(job, "Wiring generated", 65, "Package wiring regenerated")

	// Go package steps (Phase 3): build new binary, backup DB, swap
	if manifest.HasServer {
		emitProgress(job, "Updating Go modules", 67, "Running go mod tidy")
		tidyOut, tidyErr := runCmd(serverDir, "go", "mod", "tidy")
		if tidyErr != nil {
			fail("go mod tidy", fmt.Errorf("%v: %s", tidyErr, tidyOut))
			return
		}

		emitProgress(job, "Building server", 70, "Compiling new server binary")
		if buildErr := buildNewBinary(serverDir); buildErr != nil {
			fail("go build", buildErr)
			return
		}
		rollbackStack = append(rollbackStack, func() {
			os.Remove(filepath.Join(serverDir, "tinycld.new"))
			log.Printf("pkg_install: rollback — removed tinycld.new")
		})

		emitProgress(job, "Validating binary", 73, "Running binary health check")
		if valErr := validateBinary(filepath.Join(serverDir, "tinycld.new")); valErr != nil {
			fail("validate binary", valErr)
			return
		}

		emitProgress(job, "Backing up database", 75, "Creating SQLite backup")
		dbRollback, dbErr := backupDatabase(serverDir)
		if dbErr != nil {
			fail("database backup", dbErr)
			return
		}
		rollbackStack = append(rollbackStack, func() {
			if err := dbRollback(); err != nil {
				log.Printf("pkg_install: rollback — database restore failed: %v", err)
			}
		})

		emitProgress(job, "Swapping binary", 77, "Installing new server binary")
		binRollback, binErr := swapBinary(serverDir)
		if binErr != nil {
			fail("binary swap", binErr)
			return
		}
		rollbackStack = append(rollbackStack, func() {
			if err := binRollback(); err != nil {
				log.Printf("pkg_install: rollback — binary restore failed: %v", err)
			}
		})
	}

	// Run migrations (via new binary if Go package, otherwise current)
	emitProgress(job, "Running migrations", 80, "Applying database migrations")
	migrateBin := resolveServerBinary()
	if manifest.HasServer {
		migrateBin = filepath.Join(serverDir, binaryName)
	}
	migrateOut, err := runCmd(serverDir, migrateBin, "migrate")
	if err != nil {
		fail("migrate", fmt.Errorf("%v: %s", err, migrateOut))
		return
	}
	emitProgress(job, "Migrations applied", 83, "Database migrations complete")

	// Rebuild web bundle
	emitProgress(job, "Building web app", 85, "Running expo export")
	buildOut, err := runCmd(rootDir, "npx", "expo", "export", "--platform", "web")
	if err != nil {
		fail("build", fmt.Errorf("%v: %s", err, buildOut))
		return
	}
	emitProgress(job, "Web app built", 88, "Web bundle rebuilt")

	// Copy dist to public
	emitProgress(job, "Deploying assets", 90, "Copying build output to public/")
	publicDir := filepath.Join(rootDir, "public")
	distDir := filepath.Join(rootDir, "dist", "client")

	// Backup current public
	publicBackup := filepath.Join(tmpDir, "public-backup")
	copyDir(publicDir, publicBackup)
	rollbackStack = append(rollbackStack, func() {
		os.RemoveAll(publicDir)
		copyDir(publicBackup, publicDir)
		log.Printf("pkg_install: rollback — restored public/")
	})

	if err := copyDir(distDir, publicDir); err != nil {
		fail("deploy", err)
		return
	}

	// Rename index.html to app.html for SPA fallback
	indexPath := filepath.Join(publicDir, "index.html")
	appPath := filepath.Join(publicDir, "app.html")
	if _, statErr := os.Stat(indexPath); statErr == nil {
		os.Rename(indexPath, appPath)
	}
	emitProgress(job, "Assets deployed", 92, "Public assets updated")

	// Update pkg_registry
	emitProgress(job, "Updating database", 95, "Updating package registry")
	manifestJSON, _ := json.Marshal(manifest.RawJSON)
	if err := upsertPkgRegistry(app, manifest, job.NpmPkg, manifestJSON); err != nil {
		fail("registry update", err)
		return
	}
	emitProgress(job, "Database updated", 97, "Package registry updated")

	// Request restart
	emitProgress(job, "Requesting restart", 99, "Signaling server restart")
	job.Status = "success"
	finalizeInstallLog(app, logRecord, "success", "", job.LogLines)
	emitComplete(job, "success", "")

	// Allow SSE events to flush to clients before process exit
	time.Sleep(2 * time.Second)
	requestRestart(serverDir)
}

// ---------- uninstall pipeline ----------

func runUninstallPipeline(app *pocketbase.PocketBase, job *installJob) {
	defer func() {
		installMu.Lock()
		currentJob = nil
		installMu.Unlock()
		close(job.Done)
	}()

	serverDir := resolveServerDir()
	rootDir := filepath.Dir(serverDir)
	packagesDir := filepath.Join(rootDir, "packages")

	logRecord := createInstallLog(app, job, "uninstall")

	fail := func(step string, err error) {
		job.Status = "failed"
		job.Error = fmt.Sprintf("Failed at %s: %v", step, err)
		emitProgress(job, step, job.Progress, "FAILED: "+err.Error())
		emitComplete(job, "failed", job.Error)
		finalizeInstallLog(app, logRecord, "failed", job.Error, job.LogLines)
	}

	// Step 1: Verify package exists and is not bundled
	emitProgress(job, "Verifying package", 10, "Checking "+job.Slug)
	record, err := app.FindFirstRecordByFilter(
		"pkg_registry",
		"slug = {:slug}",
		map[string]any{"slug": job.Slug},
	)
	if err != nil {
		fail("verify", fmt.Errorf("package %s not found in registry", job.Slug))
		return
	}
	if record.GetString("status") == "bundled" {
		fail("verify", fmt.Errorf("cannot uninstall bundled package %s", job.Slug))
		return
	}

	// Step 2: Remove package directory
	emitProgress(job, "Removing files", 25, "Removing package directory")
	pkgDir := filepath.Join(packagesDir, job.Slug)
	if err := os.RemoveAll(pkgDir); err != nil {
		fail("remove", err)
		return
	}
	emitProgress(job, "Files removed", 30, "Package directory removed")

	// Step 3: Update installed-packages.json
	emitProgress(job, "Updating registry", 40, "Updating installed-packages.json")
	installedPath := filepath.Join(rootDir, "installed-packages.json")
	if err := removeInstalledPackage(installedPath, job.Slug); err != nil {
		fail("write installed-packages.json", err)
		return
	}
	emitProgress(job, "Registry updated", 45, "installed-packages.json updated")

	// Step 4: Regenerate wiring
	emitProgress(job, "Regenerating wiring", 55, "Running package generation script")
	genOut, err := runCmd(rootDir, "npx", "tsx", "scripts/generate-packages.ts")
	if err != nil {
		fail("generate", fmt.Errorf("%v: %s", err, genOut))
		return
	}
	emitProgress(job, "Wiring regenerated", 65, "Package wiring regenerated")

	// Step 5: Rebuild web bundle
	emitProgress(job, "Building web app", 75, "Running expo export")
	buildOut, err := runCmd(rootDir, "npx", "expo", "export", "--platform", "web")
	if err != nil {
		fail("build", fmt.Errorf("%v: %s", err, buildOut))
		return
	}
	emitProgress(job, "Web app built", 85, "Web bundle rebuilt")

	// Step 6: Deploy and update
	emitProgress(job, "Deploying assets", 88, "Copying build output to public/")
	publicDir := filepath.Join(rootDir, "public")
	distDir := filepath.Join(rootDir, "dist", "client")
	if err := copyDir(distDir, publicDir); err != nil {
		fail("deploy", err)
		return
	}
	indexPath := filepath.Join(publicDir, "index.html")
	appPath := filepath.Join(publicDir, "app.html")
	if _, statErr := os.Stat(indexPath); statErr == nil {
		os.Rename(indexPath, appPath)
	}

	// Step 7: Update pkg_registry to disabled
	emitProgress(job, "Updating database", 93, "Marking package as disabled")
	record.Set("status", "disabled")
	if err := app.Save(record); err != nil {
		fail("registry update", err)
		return
	}

	emitProgress(job, "Complete", 98, "Package uninstalled")
	job.Status = "success"
	finalizeInstallLog(app, logRecord, "success", "", job.LogLines)
	emitComplete(job, "success", "")

	// Allow SSE events to flush to clients before process exit
	time.Sleep(2 * time.Second)
	requestRestart(serverDir)
}

// ---------- SSE helpers ----------

func emitProgress(job *installJob, step string, progress int, message string) {
	job.mu.Lock()
	defer job.mu.Unlock()
	job.Step = step
	job.Progress = progress
	job.LogLines = append(job.LogLines, fmt.Sprintf("[%d%%] %s: %s", progress, step, message))

	evt := sseEvent{
		Event: "progress",
		Data: progressData{
			Step:     step,
			Progress: progress,
			Message:  message,
		},
	}
	for _, ch := range job.listeners {
		select {
		case ch <- evt:
		default:
		}
	}
}

func emitComplete(job *installJob, status string, errMsg string) {
	job.mu.Lock()
	defer job.mu.Unlock()

	evt := sseEvent{
		Event: "complete",
		Data: completeData{
			Status: status,
			Error:  errMsg,
		},
	}
	for _, ch := range job.listeners {
		select {
		case ch <- evt:
		default:
		}
	}
}

// ---------- install log helpers ----------

func createInstallLog(app core.App, job *installJob, action string) *core.Record {
	collection, err := app.FindCollectionByNameOrId("pkg_install_log")
	if err != nil {
		log.Printf("pkg_install: failed to find pkg_install_log collection: %v", err)
		return nil
	}

	record := core.NewRecord(collection)
	record.Set("action", action)
	record.Set("pkg_slug", job.Slug)
	record.Set("npm_package", job.NpmPkg)
	record.Set("status", "running")
	record.Set("started_at", time.Now().UTC().Format("2006-01-02 15:04:05.000Z"))

	if err := app.Save(record); err != nil {
		log.Printf("pkg_install: failed to create install log: %v", err)
		return nil
	}

	return record
}

func finalizeInstallLog(app core.App, record *core.Record, status string, errMsg string, logLines []string) {
	if record == nil {
		return
	}

	record.Set("status", status)
	record.Set("error", errMsg)
	record.Set("log", strings.Join(logLines, "\n"))
	record.Set("completed_at", time.Now().UTC().Format("2006-01-02 15:04:05.000Z"))

	if err := app.Save(record); err != nil {
		log.Printf("pkg_install: failed to finalize install log: %v", err)
	}
}

// ---------- installed-packages.json helpers ----------

type installedPkgEntry struct {
	NpmPackage  string `json:"npmPackage"`
	Slug        string `json:"slug"`
	InstalledAt string `json:"installedAt"`
}

func readInstalledPackages(path string) ([]installedPkgEntry, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var entries []installedPkgEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

func writeInstalledPackages(path string, entries []installedPkgEntry) error {
	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func addInstalledPackage(path, npmPkg, slug string) error {
	entries, err := readInstalledPackages(path)
	if err != nil {
		return err
	}

	// Dedup
	for _, e := range entries {
		if e.Slug == slug {
			return nil
		}
	}

	entries = append(entries, installedPkgEntry{
		NpmPackage:  npmPkg,
		Slug:        slug,
		InstalledAt: time.Now().UTC().Format(time.RFC3339),
	})

	return writeInstalledPackages(path, entries)
}

func removeInstalledPackage(path, slug string) error {
	entries, err := readInstalledPackages(path)
	if err != nil {
		return err
	}

	var filtered []installedPkgEntry
	for _, e := range entries {
		if e.Slug != slug {
			filtered = append(filtered, e)
		}
	}

	if len(filtered) == 0 {
		return os.Remove(path)
	}
	return writeInstalledPackages(path, filtered)
}

// ---------- pkg_registry helpers ----------

func upsertPkgRegistry(app core.App, m *parsedManifest, npmPkg string, manifestJSON []byte) error {
	existing, err := app.FindFirstRecordByFilter(
		"pkg_registry",
		"slug = {:slug}",
		map[string]any{"slug": m.Slug},
	)

	if err == nil {
		// Update existing
		existing.Set("name", m.Name)
		existing.Set("version", m.Version)
		existing.Set("npm_package", npmPkg)
		existing.Set("description", m.Description)
		existing.Set("icon", m.Nav.Icon)
		existing.Set("has_server", m.HasServer)
		existing.Set("status", "installed")
		existing.Set("manifest_json", json.RawMessage(manifestJSON))
		return app.Save(existing)
	}

	// Create new
	collection, err := app.FindCollectionByNameOrId("pkg_registry")
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Set("name", m.Name)
	record.Set("slug", m.Slug)
	record.Set("version", m.Version)
	record.Set("npm_package", npmPkg)
	record.Set("description", m.Description)
	record.Set("icon", m.Nav.Icon)
	record.Set("has_server", m.HasServer)
	record.Set("status", "installed")
	record.Set("manifest_json", json.RawMessage(manifestJSON))
	record.Set("nav_order", m.Nav.Order)
	return app.Save(record)
}

func getBundledSlugs(app core.App) map[string]bool {
	slugs := make(map[string]bool)
	records, err := app.FindRecordsByFilter(
		"pkg_registry",
		"status = 'bundled'",
		"",
		0,
		0,
	)
	if err != nil {
		return slugs
	}
	for _, r := range records {
		slugs[r.GetString("slug")] = true
	}
	return slugs
}

// ---------- utility helpers ----------

func runCmd(dir string, name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func copyDir(src, dst string) error {
	_, err := runCmd(".", "cp", "-a", src+"/.", dst+"/")
	return err
}

func resolveServerDir() string {
	ex, err := os.Executable()
	if err != nil {
		return "./server"
	}
	dir := filepath.Dir(ex)
	// If running from a temp dir (go run), use ./server
	if strings.HasPrefix(dir, os.TempDir()) {
		return filepath.Join(".", "server")
	}
	return dir
}

func resolveServerBinary() string {
	ex, err := os.Executable()
	if err != nil {
		return "./" + binaryName
	}
	if strings.HasPrefix(ex, os.TempDir()) {
		return "go"
	}
	return ex
}

