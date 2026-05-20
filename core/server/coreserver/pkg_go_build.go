package coreserver

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
)

// checkGoBuildPrereqs verifies that Go and gcc are available on PATH.
func checkGoBuildPrereqs() error {
	for _, tool := range []string{"go", "gcc"} {
		if _, err := exec.LookPath(tool); err != nil {
			return fmt.Errorf("%s not found on PATH: %w", tool, err)
		}
	}
	return nil
}

// buildNewBinary compiles a new server binary at serverDir/tinycld.new.
func buildNewBinary(serverDir string) error {
	cmd := exec.Command("go", "build", "-o", "tinycld.new", ".")
	cmd.Dir = serverDir
	cmd.Env = append(os.Environ(), "CGO_ENABLED=1")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("go build failed: %v\n%s", err, out)
	}
	log.Printf("pkg_go_build: built tinycld.new in %s", serverDir)
	return nil
}

// validateBinary runs the new binary with --help to verify it starts.
func validateBinary(binaryPath string) error {
	cmd := exec.Command(binaryPath, "--help")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("binary validation failed: %v\n%s", err, out)
	}
	return nil
}

// backupDatabase creates a consistent SQLite backup using VACUUM INTO.
// Returns a rollback function that restores the backup.
func backupDatabase(serverDir string) (rollbackFn func() error, err error) {
	dbPath := filepath.Join(serverDir, "pb_data", "data.db")
	backupPath := filepath.Join(serverDir, "pb_data", "data.db.backup")

	// Use sqlite3 VACUUM INTO for a consistent snapshot
	cmd := exec.Command("sqlite3", dbPath, fmt.Sprintf("VACUUM INTO '%s';", backupPath))
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("database backup failed: %v\n%s", err, out)
	}

	log.Printf("pkg_go_build: database backed up to %s", backupPath)

	rollbackFn = func() error {
		log.Printf("pkg_go_build: restoring database from backup")
		// Use cp for streaming copy to avoid loading entire DB into memory
		cmd := exec.Command("cp", backupPath, dbPath)
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("failed to restore backup: %v\n%s", err, out)
		}
		os.Remove(backupPath)
		return nil
	}

	return rollbackFn, nil
}

// swapBinary atomically swaps the current binary with the new one.
// Returns a rollback function that reverses the swap. Uses the configured
// `binaryName` (set via Options.BinaryName at Register time) to locate
// the binary; the new and previous copies have `.new` and `.prev`
// suffixes.
func swapBinary(serverDir string) (rollbackFn func() error, err error) {
	currentPath := filepath.Join(serverDir, binaryName)
	prevPath := filepath.Join(serverDir, binaryName+".prev")
	newPath := filepath.Join(serverDir, binaryName+".new")

	// <binary> → <binary>.prev
	if err := os.Rename(currentPath, prevPath); err != nil {
		return nil, fmt.Errorf("failed to move current binary to .prev: %w", err)
	}

	// <binary>.new → <binary>
	if err := os.Rename(newPath, currentPath); err != nil {
		// Try to restore
		os.Rename(prevPath, currentPath)
		return nil, fmt.Errorf("failed to move new binary into place: %w", err)
	}

	log.Printf("pkg_go_build: binary swap complete (prev saved as %s.prev)", binaryName)

	rollbackFn = func() error {
		log.Printf("pkg_go_build: rolling back binary swap")
		failedPath := filepath.Join(serverDir, "tinycld.failed")
		os.Rename(currentPath, failedPath)
		return os.Rename(prevPath, currentPath)
	}

	return rollbackFn, nil
}
