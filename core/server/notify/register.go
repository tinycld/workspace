package notify

import (
	"github.com/pocketbase/pocketbase"
)

// Register is retained as a no-op extension point. The notify package
// now exposes only the NotifyUser primitive; background polling lives
// in the package that owns the relevant collections (e.g. calendar,
// mail). Kept so callers (main.go) don't need to change shape.
func Register(_ *pocketbase.PocketBase) {}
