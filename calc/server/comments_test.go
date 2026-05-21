package calc

import (
	"bytes"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

// TestFormatThreadForXlsxSingleRoot: a single-comment thread renders as
// "Author (Date): Body" with the root author as the excelize attribution.
func TestFormatThreadForXlsxSingleRoot(t *testing.T) {
	thread := commentThread{
		root: CommentRow{
			ID:         "root",
			AuthorName: "Alice",
			Body:       "First note",
			Created:    time.Date(2026, 5, 10, 10, 0, 0, 0, time.UTC),
		},
	}
	author, text := formatThreadForXlsx(thread)
	if author != "Alice" {
		t.Errorf("author: want %q, got %q", "Alice", author)
	}
	if got, want := text, "Alice (2026-05-10): First note"; got != want {
		t.Errorf("text: want %q, got %q", want, got)
	}
}

// TestFormatThreadForXlsxWithReplies: replies join with em-dash bullets
// in created order; attribution flips to the most recent replier (Sheets'
// "last replier" parity).
func TestFormatThreadForXlsxWithReplies(t *testing.T) {
	thread := commentThread{
		root: CommentRow{
			ID:         "root",
			AuthorName: "Alice",
			Body:       "Question?",
			Created:    time.Date(2026, 5, 10, 10, 0, 0, 0, time.UTC),
		},
		replies: []CommentRow{
			{
				ID:         "r1",
				AuthorName: "Bob",
				Body:       "Answer",
				Created:    time.Date(2026, 5, 10, 10, 5, 0, 0, time.UTC),
			},
			{
				ID:         "r2",
				AuthorName: "Carol",
				Body:       "Follow-up",
				Created:    time.Date(2026, 5, 10, 10, 10, 0, 0, time.UTC),
			},
		},
	}
	author, text := formatThreadForXlsx(thread)
	if author != "Carol" {
		t.Errorf("author: want last replier %q, got %q", "Carol", author)
	}
	if !strings.Contains(text, "Alice (2026-05-10): Question?") {
		t.Errorf("missing root line in: %q", text)
	}
	if !strings.Contains(text, "— Bob: Answer") {
		t.Errorf("missing first reply in: %q", text)
	}
	if !strings.Contains(text, "— Carol: Follow-up") {
		t.Errorf("missing second reply in: %q", text)
	}
	if strings.Contains(text, "[resolved") {
		t.Errorf("unexpected resolved footer in unresolved thread: %q", text)
	}
}

// TestFormatThreadForXlsxResolved: a resolved thread appends the
// "[resolved <date>]" footer so Excel users see the status.
func TestFormatThreadForXlsxResolved(t *testing.T) {
	thread := commentThread{
		root: CommentRow{
			ID:         "root",
			AuthorName: "Alice",
			Body:       "Done",
			Created:    time.Date(2026, 5, 10, 10, 0, 0, 0, time.UTC),
			ResolvedAt: time.Date(2026, 5, 10, 12, 0, 0, 0, time.UTC),
			IsResolved: true,
		},
	}
	_, text := formatThreadForXlsx(thread)
	if !strings.HasSuffix(text, "[resolved 2026-05-10]") {
		t.Errorf("expected [resolved …] footer at end, got %q", text)
	}
}

// TestBuildThreadsForCellOrdering: roots come back in created order;
// replies attach to the right root by ID; orphan replies are dropped.
func TestBuildThreadsForCellOrdering(t *testing.T) {
	rows := []CommentRow{
		{ID: "rootB", Created: time.Date(2026, 5, 10, 11, 0, 0, 0, time.UTC)},
		{ID: "rootA", Created: time.Date(2026, 5, 10, 10, 0, 0, 0, time.UTC)},
		{
			ID:       "reply",
			ParentID: "rootA",
			Created:  time.Date(2026, 5, 10, 10, 1, 0, 0, time.UTC),
		},
		{
			ID:       "orphan",
			ParentID: "missing",
			Created:  time.Date(2026, 5, 10, 10, 30, 0, 0, time.UTC),
		},
	}
	threads := buildThreadsForCell(rows)
	if len(threads) != 2 {
		t.Fatalf("threads: want 2, got %d", len(threads))
	}
	if threads[0].root.ID != "rootA" || threads[1].root.ID != "rootB" {
		t.Errorf("thread order: want [rootA, rootB], got [%s, %s]", threads[0].root.ID, threads[1].root.ID)
	}
	if len(threads[0].replies) != 1 || threads[0].replies[0].ID != "reply" {
		t.Errorf("rootA replies: want [reply], got %+v", threads[0].replies)
	}
}

// TestApplyCommentsToFileRoundTrip: build an xlsx with no comments,
// apply two threads on different cells, re-open the result with
// excelize and confirm GetComments returns the expected entries.
func TestApplyCommentsToFileRoundTrip(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer func() { _ = f.Close() }()

	rows := []CommentRow{
		{
			ID:         "root1",
			SheetID:    "sheet1",
			Row:        2,
			Col:        2,
			AuthorName: "Alice",
			Body:       "First",
			Created:    time.Date(2026, 5, 10, 10, 0, 0, 0, time.UTC),
		},
		{
			ID:         "root2",
			SheetID:    "sheet1",
			Row:        4,
			Col:        4,
			AuthorName: "Bob",
			Body:       "Second",
			Created:    time.Date(2026, 5, 10, 11, 0, 0, 0, time.UTC),
		},
	}
	sheetNameByID := map[string]string{"sheet1": "People"}

	if err := applyCommentsToFile(f, rows, sheetNameByID); err != nil {
		t.Fatalf("applyCommentsToFile: %v", err)
	}

	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("write: %v", err)
	}

	rt, err := excelize.OpenReader(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatalf("re-open: %v", err)
	}
	defer func() { _ = rt.Close() }()
	got, err := rt.GetComments("People")
	if err != nil {
		t.Fatalf("GetComments: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("comments: want 2, got %d", len(got))
	}
	// excelize iterates in workbook order; keys are cell refs.
	cells := map[string]excelize.Comment{}
	for _, c := range got {
		cells[c.Cell] = c
	}
	if _, ok := cells["B2"]; !ok {
		t.Errorf("missing comment on B2: %+v", got)
	}
	if _, ok := cells["D4"]; !ok {
		t.Errorf("missing comment on D4: %+v", got)
	}
	if !strings.Contains(cells["B2"].Text, "First") {
		t.Errorf("B2 text missing body: %q", cells["B2"].Text)
	}
	if cells["D4"].Author != "Bob" {
		t.Errorf("D4 author: want %q, got %q", "Bob", cells["D4"].Author)
	}
}

// TestApplyCommentsToFileSkipsUnknownSheet: a comment targeting a sheet
// id we couldn't resolve is silently skipped — the rest of the save
// still proceeds. Better than aborting persistence over an orphan.
func TestApplyCommentsToFileSkipsUnknownSheet(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer func() { _ = f.Close() }()
	rows := []CommentRow{
		{
			ID:         "orphan",
			SheetID:    "unknown",
			Row:        1,
			Col:        1,
			AuthorName: "Alice",
			Body:       "stranded",
			Created:    time.Date(2026, 5, 10, 10, 0, 0, 0, time.UTC),
		},
	}
	if err := applyCommentsToFile(f, rows, map[string]string{}); err != nil {
		t.Fatalf("applyCommentsToFile should not error on unknown sheet: %v", err)
	}
}

// TestSerializerWritesComments: end-to-end through serializeSnapshotToXLSX
// — the saved bytes carry the comment as a classic xlsx note.
func TestSerializerWritesComments(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}
	comments := []CommentRow{
		{
			ID:         "root",
			SheetID:    "sheet1",
			Row:        3,
			Col:        3,
			AuthorName: "Alice",
			Body:       "Note here",
			Created:    time.Date(2026, 5, 10, 10, 0, 0, 0, time.UTC),
		},
	}
	out, err := serializeSnapshotToXLSX(original, snap, comments)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	rt, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("re-open: %v", err)
	}
	defer func() { _ = rt.Close() }()
	got, err := rt.GetComments("People")
	if err != nil {
		t.Fatalf("GetComments: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("comments: want 1, got %d", len(got))
	}
	if !strings.Contains(got[0].Text, "Note here") {
		t.Errorf("comment text missing body: %q", got[0].Text)
	}
}
