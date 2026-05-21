package drive

import (
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/net/webdav"
)

// driveFile is the webdav.File implementation. A single struct serves
// three modes — read, write, directory — selected by which fields are
// populated. The handler always Stats first and never writes after a
// read or vice versa, so a discriminated union over presence of fields
// is sufficient and keeps allocation trivial.
type driveFile struct {
	fs   *DriveFileSystem
	info *driveFileInfo

	// Read mode (file)
	rdSeeker io.ReadSeekCloser
	tmpPath  string // non-empty when rdSeeker is a temp file we own

	// Write mode (file)
	wrBuf    *os.File
	wrName   string
	parentID string
	orgID    string
	userOrg  *core.Record
	existing *core.Record

	// Directory mode
	children []os.FileInfo
	cursor   int

	closed bool
}

var _ webdav.File = (*driveFile)(nil)

func (f *driveFile) Stat() (os.FileInfo, error) {
	if f.info == nil {
		return nil, os.ErrInvalid
	}
	return f.info, nil
}

func (f *driveFile) Read(p []byte) (int, error) {
	if f.rdSeeker == nil {
		// Directory or write-only file — readers shouldn't reach here.
		return 0, io.EOF
	}
	return f.rdSeeker.Read(p)
}

func (f *driveFile) Seek(offset int64, whence int) (int64, error) {
	if f.rdSeeker != nil {
		return f.rdSeeker.Seek(offset, whence)
	}
	if f.wrBuf != nil {
		return f.wrBuf.Seek(offset, whence)
	}
	return 0, errors.New("drive webdav: seek on non-seekable file handle")
}

func (f *driveFile) Write(p []byte) (int, error) {
	if f.wrBuf == nil {
		return 0, os.ErrPermission
	}
	return f.wrBuf.Write(p)
}

func (f *driveFile) Readdir(count int) ([]os.FileInfo, error) {
	if f.children == nil {
		return nil, errors.New("drive webdav: readdir on non-directory")
	}
	if f.cursor >= len(f.children) {
		if count <= 0 {
			return nil, nil
		}
		return nil, io.EOF
	}
	if count <= 0 {
		out := f.children[f.cursor:]
		f.cursor = len(f.children)
		return out, nil
	}
	end := min(f.cursor+count, len(f.children))
	out := f.children[f.cursor:end]
	f.cursor = end
	return out, nil
}

// Close finalizes whichever mode the driveFile is in. For write mode it
// runs the persistence path (the body of the old Create method); for
// read mode it cleans up the seekable reader and any temp file; for
// directory mode it's a no-op.
func (f *driveFile) Close() error {
	if f.closed {
		return nil
	}
	f.closed = true

	if f.rdSeeker != nil {
		err := f.rdSeeker.Close()
		if f.tmpPath != "" {
			_ = os.Remove(f.tmpPath)
		}
		return err
	}

	if f.wrBuf != nil {
		return f.persistWrite()
	}

	return nil
}

// persistWrite is the body of the old DriveFileSystem.Create method,
// re-shaped to run on Close. It owns one filesystem path at a time —
// either the original temp file or, after a successful rename, the
// renamed file — and the deferred cleanup always points at whichever
// one exists, so every failure path is leak-free.
//
// Why we rename: PocketBase's filesystem.NewFileFromPath derives the
// blob's storage Name from the source file's basename, and that Name
// is what the regular drive UI's single-file download endpoint serves
// as Content-Disposition filename. The temp file is named
// "tinycld-drive-XXXX", so we rename it to the user's intended
// filename in the same directory before handing it to NewFileFromPath.
func (f *driveFile) persistWrite() error {
	tmpPath := f.wrBuf.Name()
	owned := tmpPath
	defer func() {
		if owned != "" {
			_ = os.Remove(owned)
		}
	}()

	if err := f.wrBuf.Sync(); err != nil {
		_ = f.wrBuf.Close()
		return err
	}
	if err := f.wrBuf.Close(); err != nil {
		return err
	}

	stat, err := os.Stat(tmpPath)
	if err != nil {
		return err
	}
	newSize := stat.Size()

	uploadPath := tmpPath
	if renamed := filepath.Join(filepath.Dir(tmpPath), filepath.Base(f.wrName)); renamed != tmpPath {
		if err := os.Rename(tmpPath, renamed); err != nil {
			return err
		}
		owned = renamed
		uploadPath = renamed
	}

	if f.existing != nil {
		if err := checkWritePermission(f.fs.app, f.userOrg.Id, f.existing.Id); err != nil {
			return err
		}

		oldSize := int64(f.existing.GetInt("size"))
		if delta := newSize - oldSize; delta > 0 {
			if err := checkUserStorageQuotaWebDAV(f.fs.app, f.userOrg.Id, f.orgID, delta); err != nil {
				return err
			}
		}

		if f.existing.GetString("file") != "" {
			if err := snapshotCurrentFile(f.fs.app, f.existing, f.userOrg.Id, "upload", ""); err != nil {
				f.fs.app.Logger().Warn("WebDAV: version snapshot failed", "id", f.existing.Id, "error", err)
			}
		}

		if err := writeFileContentFromPath(f.fs.app, f.existing, uploadPath); err != nil {
			return err
		}
		f.info = recordToFileInfo(f.existing)
		return nil
	}

	// Create path: rely on the OnRecordCreate("drive_items") hook for
	// quota enforcement.
	collection, err := f.fs.app.FindCollectionByNameOrId("drive_items")
	if err != nil {
		return err
	}

	record := core.NewRecord(collection)
	record.Set("org", f.orgID)
	record.Set("name", f.wrName)
	record.Set("is_folder", false)
	record.Set("parent", f.parentID)
	record.Set("created_by", f.userOrg.Id)
	record.Set("mime_type", guessMimeType(f.wrName))

	// The OnRecordCreate("drive_items") hook in register.go creates the
	// owner drive_shares row in the same transaction; no follow-up call needed.
	if err := writeFileContentFromPath(f.fs.app, record, uploadPath); err != nil {
		return err
	}

	f.info = recordToFileInfo(record)
	return nil
}
