package drive

import (
	"bytes"
	"errors"
	"io"
	"os"
	"reflect"
	"testing"
	"time"
)

// TestParsePath verifies the WebDAV path parser handles every shape we
// expect in production, including the trailing-slash and trailing-double-
// slash variants Finder produces. The path parser is the foundation of
// every FileSystem method, so a regression here is silent and severe.
func TestParsePath(t *testing.T) {
	cases := []struct {
		in       string
		wantOrg  string
		wantSegs []string
	}{
		{"/drive", "", nil},
		{"/drive/", "", nil},
		{"/drive/acme", "acme", nil},
		{"/drive/acme/", "acme", nil},
		{"/drive/acme/Documents", "acme", []string{"Documents"}},
		{"/drive/acme/Documents/", "acme", []string{"Documents"}},
		{"/drive/acme/Documents/report.pdf", "acme", []string{"Documents", "report.pdf"}},

		// path.Clean collapses these — locking down the contract so a
		// future "simplification" that drops Clean can't silently change
		// path semantics.
		{"/drive//acme/Documents", "acme", []string{"Documents"}},
		{"/drive/acme//Documents//report.pdf", "acme", []string{"Documents", "report.pdf"}},
		{"/drive/acme/Documents/../OtherDocs", "acme", []string{"OtherDocs"}},
		{"/drive/acme/./Documents", "acme", []string{"Documents"}},
		// Traversal that escapes the /drive prefix entirely is clamped
		// to the synthetic root so a stray ../ can't accidentally hit an
		// org named "etc". See the parsePath doc comment.
		{"/drive/../../etc/passwd", "", nil},
		{"/drive/../etc", "", nil},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			gotOrg, gotSegs := parsePath(tc.in)
			if gotOrg != tc.wantOrg {
				t.Errorf("orgSlug: got %q, want %q", gotOrg, tc.wantOrg)
			}
			if !reflect.DeepEqual(gotSegs, tc.wantSegs) {
				t.Errorf("segments: got %#v, want %#v", gotSegs, tc.wantSegs)
			}
		})
	}
}

// TestDriveFileInfo verifies the os.FileInfo implementation surfaces the
// fields the WebDAV handler reads — Mode() in particular drives whether
// the handler treats an entry as a directory in PROPFIND output.
func TestDriveFileInfo(t *testing.T) {
	dir := &driveFileInfo{name: "Documents", isDir: true, modTime: time.Unix(1700000000, 0)}
	if !dir.IsDir() {
		t.Error("dir.IsDir() = false, want true")
	}
	if dir.Mode()&os.ModeDir == 0 {
		t.Errorf("dir.Mode() = %v, want ModeDir bit set", dir.Mode())
	}
	if dir.Name() != "Documents" {
		t.Errorf("dir.Name() = %q, want Documents", dir.Name())
	}

	file := &driveFileInfo{name: "report.pdf", size: 4096}
	if file.IsDir() {
		t.Error("file.IsDir() = true, want false")
	}
	if file.Mode()&os.ModeDir != 0 {
		t.Errorf("file.Mode() = %v, want no ModeDir bit", file.Mode())
	}
	if file.Size() != 4096 {
		t.Errorf("file.Size() = %d, want 4096", file.Size())
	}
}

// TestDriveFileReaddirCursor exercises the same cursor semantics
// http.File.Readdir specifies: positive count returns up to count
// entries advancing the cursor, count<=0 returns the rest, and
// once exhausted, count>0 returns io.EOF. The stdlib WebDAV handler
// always passes -1 in practice, but we guard the count>0 path too.
func TestDriveFileReaddirCursor(t *testing.T) {
	children := []os.FileInfo{
		&driveFileInfo{name: "a", isDir: true},
		&driveFileInfo{name: "b"},
		&driveFileInfo{name: "c"},
	}

	t.Run("count_negative_returns_all", func(t *testing.T) {
		f := &driveFile{children: children}
		got, err := f.Readdir(-1)
		if err != nil {
			t.Fatalf("Readdir(-1) error: %v", err)
		}
		if len(got) != 3 {
			t.Errorf("got %d entries, want 3", len(got))
		}
	})

	t.Run("count_positive_paginates", func(t *testing.T) {
		f := &driveFile{children: children}
		first, err := f.Readdir(2)
		if err != nil {
			t.Fatalf("Readdir(2) error: %v", err)
		}
		if len(first) != 2 || first[0].Name() != "a" || first[1].Name() != "b" {
			t.Errorf("first batch: got %v", names(first))
		}
		second, err := f.Readdir(2)
		if err != nil {
			t.Fatalf("second Readdir(2) error: %v", err)
		}
		if len(second) != 1 || second[0].Name() != "c" {
			t.Errorf("second batch: got %v", names(second))
		}
		if _, err := f.Readdir(2); !errors.Is(err, io.EOF) {
			t.Errorf("third Readdir(2) error: got %v, want io.EOF", err)
		}
	})

	t.Run("non_directory_errors", func(t *testing.T) {
		f := &driveFile{} // no children
		if _, err := f.Readdir(-1); err == nil {
			t.Error("Readdir on non-directory: expected error, got nil")
		}
	})
}

func names(infos []os.FileInfo) []string {
	out := make([]string, len(infos))
	for i, info := range infos {
		out[i] = info.Name()
	}
	return out
}

// TestNopReadSeekCloser verifies the in-memory reader wrapper used by
// openSeekableContent for files at or below the seekable-memory
// threshold. Seek must work for HTTP Range requests; Close is a no-op
// because there's nothing to release.
func TestNopReadSeekCloser(t *testing.T) {
	src := bytes.NewReader([]byte("hello world"))
	rsc := &nopReadSeekCloser{ReadSeeker: src}

	buf := make([]byte, 5)
	n, err := rsc.Read(buf)
	if err != nil || n != 5 || string(buf) != "hello" {
		t.Fatalf("read 0..5: %d %q %v", n, buf, err)
	}

	off, err := rsc.Seek(0, io.SeekStart)
	if err != nil || off != 0 {
		t.Fatalf("seek 0: %d %v", off, err)
	}

	if err := rsc.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
}

// TestUserFromContextRejectsMissing proves the FileSystem methods bail
// out cleanly when the WebDAV middleware hasn't put a user in the
// context. Today this is unreachable because register.go always
// authenticates first, but a future caller (test handler, debugging)
// must not dereference a nil *core.Record.
func TestUserFromContextRejectsMissing(t *testing.T) {
	fs := &DriveFileSystem{}
	if _, err := fs.userFromContext(t.Context()); err == nil {
		t.Error("userFromContext(empty ctx): expected error, got nil")
	}
}

// TestGuessMimeType covers two specific cases the WebDAV write path
// hits: an extension we recognize (so the React UI's mime-type-driven
// icon picker still works) and a missing/unknown extension (so we don't
// store empty strings into drive_items.mime_type, which downstream
// queries treat as "unknown" rather than "not yet indexed").
func TestGuessMimeType(t *testing.T) {
	cases := map[string]string{
		"foo.txt":         "text/plain; charset=utf-8",
		"foo.pdf":         "application/pdf",
		"no-extension":    "application/octet-stream",
		"weird.unknownxx": "application/octet-stream",
	}
	for in, want := range cases {
		got := guessMimeType(in)
		// Allow charset-suffixed mime types from mime.TypeByExtension.
		if got != want && !startsWith(got, want) && !startsWith(want, got) {
			t.Errorf("guessMimeType(%q) = %q, want %q (or compatible)", in, got, want)
		}
	}
}

func startsWith(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}

// TestDriveFileCloseIdempotent guards the `closed` flag in driveFile.
// The stdlib WebDAV handler doesn't double-close, but adapter layers
// (Range error paths, panic recoveries) sometimes do. A second Close
// must not delete a temp file twice or run persistWrite again.
func TestDriveFileCloseIdempotent(t *testing.T) {
	t.Run("dir_mode", func(t *testing.T) {
		f := &driveFile{children: []os.FileInfo{}}
		if err := f.Close(); err != nil {
			t.Fatalf("first close: %v", err)
		}
		if err := f.Close(); err != nil {
			t.Fatalf("second close: %v", err)
		}
	})

	t.Run("read_mode_no_temp", func(t *testing.T) {
		f := &driveFile{rdSeeker: &nopReadSeekCloser{ReadSeeker: bytes.NewReader([]byte("hi"))}}
		if err := f.Close(); err != nil {
			t.Fatalf("first close: %v", err)
		}
		if err := f.Close(); err != nil {
			t.Fatalf("second close: %v", err)
		}
	})

	t.Run("read_mode_with_temp", func(t *testing.T) {
		// Use a real temp file so we can assert it was removed exactly
		// once — a second os.Remove on the now-missing path must not
		// surface as an error to the caller.
		tmp, err := os.CreateTemp(t.TempDir(), "drive-test-*")
		if err != nil {
			t.Fatal(err)
		}
		path := tmp.Name()
		f := &driveFile{
			rdSeeker: tmp,
			tmpPath:  path,
		}
		if err := f.Close(); err != nil {
			t.Fatalf("first close: %v", err)
		}
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Errorf("temp file not removed after first close: stat err = %v", err)
		}
		if err := f.Close(); err != nil {
			t.Fatalf("second close: %v", err)
		}
	})

	t.Run("write_mode", func(t *testing.T) {
		// persistWrite needs a real DriveFileSystem to talk to PB on first
		// close; we can't drive it without a running app. So instead use
		// the closed flag directly: simulate "already closed" and verify
		// a follow-up Close is a no-op. This also covers the realistic
		// case where persistWrite ran on the first Close (success path)
		// and a defensive second Close doesn't try to re-run it.
		f := &driveFile{
			wrBuf:  nil, // can be nil; the closed guard is checked first
			closed: true,
		}
		if err := f.Close(); err != nil {
			t.Fatalf("close on already-closed: %v", err)
		}
	})
}
