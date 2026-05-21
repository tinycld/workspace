package drive

import (
	"testing"

	"github.com/pocketbase/dbx"
	_ "modernc.org/sqlite"
)

// TestDriveItemNameTakenEmptyParent guards against a regression we shipped
// twice: a probe with parentID == "" must match root-level rows whose stored
// parent column is the empty string. Going through PocketBase's filter
// expression layer (FindFirstRecordByFilter with `{:parent}`) json-marshals
// the empty string into the literal two characters `""` and produces SQL of
// `parent = '""'`, which never matches stored `''` and lets duplicate root-
// level uploads slip past the dedup probe and collide on the unique index at
// INSERT time.
func TestDriveItemNameTakenEmptyParent(t *testing.T) {
	db, err := dbx.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()

	if _, err := db.NewQuery(`
		CREATE TABLE drive_items (
			id TEXT PRIMARY KEY,
			org TEXT NOT NULL,
			parent TEXT NOT NULL DEFAULT '',
			name TEXT NOT NULL
		)
	`).Execute(); err != nil {
		t.Fatalf("create table: %v", err)
	}

	if _, err := db.Insert("drive_items", dbx.Params{
		"id":     "row1",
		"org":    "org1",
		"parent": "",
		"name":   "report.pdf",
	}).Execute(); err != nil {
		t.Fatalf("insert root row: %v", err)
	}

	if _, err := db.Insert("drive_items", dbx.Params{
		"id":     "row2",
		"org":    "org1",
		"parent": "folder1",
		"name":   "child.pdf",
	}).Execute(); err != nil {
		t.Fatalf("insert child row: %v", err)
	}

	cases := []struct {
		label    string
		org      string
		parent   string
		name     string
		expected bool
	}{
		{"root collision", "org1", "", "report.pdf", true},
		{"root miss", "org1", "", "missing.pdf", false},
		{"child collision", "org1", "folder1", "child.pdf", true},
		{"wrong org no match", "org2", "", "report.pdf", false},
		{"wrong parent no match", "org1", "folder1", "report.pdf", false},
	}

	for _, tc := range cases {
		t.Run(tc.label, func(t *testing.T) {
			got, err := driveItemNameTakenDB(db, tc.org, tc.parent, tc.name)
			if err != nil {
				t.Fatalf("driveItemNameTakenDB: %v", err)
			}
			if got != tc.expected {
				t.Errorf("got %v, want %v", got, tc.expected)
			}
		})
	}
}

func TestSplitNameExt(t *testing.T) {
	cases := []struct {
		name     string
		wantBase string
		wantExt  string
	}{
		{"foo.pdf", "foo", ".pdf"},
		{"archive.tar.gz", "archive.tar", ".gz"},
		{"README", "README", ""},
		{".env", ".env", ""}, // leading dot — no extension separator
		{"", "", ""},
		{"a.", "a", "."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotBase, gotExt := splitNameExt(tc.name)
			if gotBase != tc.wantBase || gotExt != tc.wantExt {
				t.Errorf("splitNameExt(%q) = (%q, %q), want (%q, %q)",
					tc.name, gotBase, gotExt, tc.wantBase, tc.wantExt)
			}
		})
	}
}
