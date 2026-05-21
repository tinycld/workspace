package drive

import (
	"os"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// driveFileInfo is the os.FileInfo implementation returned by Stat and
// from Readdir on directories. The backing record (when non-nil) is
// returned via Sys() so internal callers can downcast without re-querying
// PocketBase.
type driveFileInfo struct {
	name    string
	size    int64
	modTime time.Time
	isDir   bool
	record  *core.Record
}

func (i *driveFileInfo) Name() string       { return i.name }
func (i *driveFileInfo) Size() int64        { return i.size }
func (i *driveFileInfo) ModTime() time.Time { return i.modTime }
func (i *driveFileInfo) IsDir() bool        { return i.isDir }
func (i *driveFileInfo) Sys() any {
	if i.record == nil {
		return nil
	}
	return i.record
}

func (i *driveFileInfo) Mode() os.FileMode {
	if i.isDir {
		return os.ModeDir | 0o755
	}
	return 0o644
}
