package drive

import (
	"bytes"
	"io"
	"os"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// seekableMemoryThreshold caps the size below which file reads are buffered
// in memory. Above this threshold, openSeekableContent spills to a temp
// file. The threshold is small enough that we can hold many concurrent
// in-flight downloads without OOM, large enough that typical office
// documents avoid the temp-file detour.
const seekableMemoryThreshold = 32 * 1024 * 1024 // 32 MiB

// readFileContent returns a ReadCloser for the file blob attached to a drive_items record.
// The caller must close the returned reader.
func readFileContent(app *pocketbase.PocketBase, record *core.Record) (io.ReadCloser, error) {
	filename := record.GetString("file")
	if filename == "" {
		return io.NopCloser(&emptyReader{}), nil
	}

	fsys, err := app.NewFilesystem()
	if err != nil {
		return nil, err
	}

	key := record.BaseFilesPath() + "/" + filename
	reader, err := fsys.GetReader(key)
	if err != nil {
		fsys.Close()
		return nil, err
	}

	return &fsClosingReader{reader: reader, fsys: fsys}, nil
}

// writeFileContentFromPath stores the file at path as a PocketBase file
// on the record, and saves. Used by the WebDAV write path so large
// uploads accumulated in a temp file don't have to be re-buffered in
// RAM. The caller owns path: this function does not rename, move, or
// remove it on either success or failure.
func writeFileContentFromPath(app *pocketbase.PocketBase, record *core.Record, path string) error {
	f, err := filesystem.NewFileFromPath(path)
	if err != nil {
		return err
	}

	record.Set("file", f)
	record.Set("size", f.Size)

	return app.Save(record)
}

// openSeekableContent returns a seekable reader over a record's file blob.
// For files at or below seekableMemoryThreshold the content is buffered
// fully in memory; larger files spill to a temp file whose path is
// returned so the caller can clean it up after Close. The returned
// reader is self-contained — the underlying gocloud blob reader and
// PocketBase filesystem session are closed before this function returns.
func openSeekableContent(app *pocketbase.PocketBase, record *core.Record) (rdr io.ReadSeekCloser, tmpPath string, err error) {
	filename := record.GetString("file")
	if filename == "" {
		return &nopReadSeekCloser{ReadSeeker: bytes.NewReader(nil)}, "", nil
	}

	fsys, err := app.NewFilesystem()
	if err != nil {
		return nil, "", err
	}
	defer fsys.Close()

	key := record.BaseFilesPath() + "/" + filename
	src, err := fsys.GetReader(key)
	if err != nil {
		return nil, "", err
	}
	defer src.Close()

	size := record.GetInt("size")
	if size <= seekableMemoryThreshold {
		buf, err := io.ReadAll(src)
		if err != nil {
			return nil, "", err
		}
		return &nopReadSeekCloser{ReadSeeker: bytes.NewReader(buf)}, "", nil
	}

	tmp, err := os.CreateTemp("", "tinycld-drive-*")
	if err != nil {
		return nil, "", err
	}
	if _, err := io.Copy(tmp, src); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
		return nil, "", err
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
		return nil, "", err
	}
	return tmp, tmp.Name(), nil
}

// nopReadSeekCloser wraps an io.ReadSeeker (e.g. *bytes.Reader) with a
// no-op Close, satisfying io.ReadSeekCloser.
type nopReadSeekCloser struct {
	io.ReadSeeker
}

func (nopReadSeekCloser) Close() error { return nil }

// fsClosingReader wraps an io.ReadCloser and closes the filesystem when the reader is closed.
type fsClosingReader struct {
	reader io.ReadCloser
	fsys   *filesystem.System
}

func (r *fsClosingReader) Read(p []byte) (int, error) {
	return r.reader.Read(p)
}

func (r *fsClosingReader) Close() error {
	err := r.reader.Close()
	r.fsys.Close()
	return err
}

type emptyReader struct{}

func (r *emptyReader) Read(_ []byte) (int, error) {
	return 0, io.EOF
}
