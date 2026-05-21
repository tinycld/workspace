package calc

import (
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/xuri/excelize/v2"
)

// CommentRow is the projection of one calc_comments PB row that the
// xlsx serializer needs. Decoupled from a *core.Record so the
// formatting helpers stay unit-testable without spinning up PB.
//
// Created is parsed once at load time to a time.Time so the formatter
// renders ISO timestamps in a stable, locale-free way.
type CommentRow struct {
	ID         string
	SheetID    string
	Row        int
	Col        int
	ParentID   string
	Body       string
	ResolvedAt time.Time
	IsResolved bool
	AuthorName string
	Created    time.Time
}

// LoadCommentsFn returns the comment rows for one workbook (drive_item)
// in created order. Plumbed into the SaveCoordinator at construction so
// the production binding can talk to PB while tests inject a fake.
type LoadCommentsFn func(driveItemID string) ([]CommentRow, error)

// MakeProductionLoadComments returns a LoadCommentsFn backed by PB.
// Loads every comment row for the given drive_item ordered by created
// (ascending) so the thread builder sees roots before replies.
func MakeProductionLoadComments(app core.App) LoadCommentsFn {
	return func(driveItemID string) ([]CommentRow, error) {
		records, err := app.FindRecordsByFilter(
			"calc_comments",
			"drive_item = {:item}",
			"+created",
			0,
			0,
			map[string]any{"item": driveItemID},
		)
		if err != nil {
			return nil, fmt.Errorf("calc: load comments for %s: %w", driveItemID, err)
		}
		rows := make([]CommentRow, 0, len(records))
		for _, r := range records {
			rows = append(rows, commentRowFromRecord(r))
		}
		return rows, nil
	}
}

// commentRowFromRecord projects one PB record into a CommentRow.
// Defensive about empty / missing date strings — PB returns empty
// types.DateTime for unset autodate / date fields.
func commentRowFromRecord(r *core.Record) CommentRow {
	created := r.GetDateTime("created").Time()
	resolvedAt := r.GetDateTime("resolved_at").Time()
	row := CommentRow{
		ID:         r.Id,
		SheetID:    r.GetString("sheet_id"),
		Row:        r.GetInt("row"),
		Col:        r.GetInt("col"),
		ParentID:   r.GetString("parent_comment"),
		Body:       r.GetString("body"),
		AuthorName: r.GetString("author_name"),
		Created:    created,
	}
	if !resolvedAt.IsZero() {
		row.ResolvedAt = resolvedAt
		row.IsResolved = true
	}
	return row
}

// applyCommentsToFile groups rows by (sheetID, row, col), renders each
// thread to a single excelize.Comment via formatThreadForXlsx, and
// stamps it on the workbook. sheetNameByID resolves a snapshot sheet
// id to the name excelize knows it as (post-rename) — the same map the
// serializer already builds.
//
// Threads with no resolvable sheet name are skipped rather than failing
// the whole save. A row that lives on a sheet the snapshot didn't list
// (e.g. an orphan comment after a sheet delete) is more recoverable
// than aborting persistence over it.
func applyCommentsToFile(
	f *excelize.File,
	rows []CommentRow,
	sheetNameByID map[string]string,
) error {
	if len(rows) == 0 {
		return nil
	}
	type cellKey struct {
		sheetID string
		row     int
		col     int
	}
	grouped := make(map[cellKey][]CommentRow)
	keys := make([]cellKey, 0)
	for _, r := range rows {
		k := cellKey{sheetID: r.SheetID, row: r.Row, col: r.Col}
		if _, ok := grouped[k]; !ok {
			keys = append(keys, k)
		}
		grouped[k] = append(grouped[k], r)
	}
	// Iterate in a stable order so xlsx bytes are reproducible across
	// saves (helps diffing during development; excelize itself is not
	// sensitive to insertion order, but our tests are).
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].sheetID != keys[j].sheetID {
			return keys[i].sheetID < keys[j].sheetID
		}
		if keys[i].row != keys[j].row {
			return keys[i].row < keys[j].row
		}
		return keys[i].col < keys[j].col
	})

	for _, k := range keys {
		sheetName, ok := sheetNameByID[k.sheetID]
		if !ok {
			continue
		}
		threads := buildThreadsForCell(grouped[k])
		for _, thread := range threads {
			author, text := formatThreadForXlsx(thread)
			ref, err := excelize.CoordinatesToCellName(k.col, k.row)
			if err != nil {
				return fmt.Errorf("calc: cell coords (%d,%d) for comment: %w", k.col, k.row, err)
			}
			if err := f.AddComment(sheetName, excelize.Comment{
				Cell:   ref,
				Author: author,
				Text:   text,
			}); err != nil {
				return fmt.Errorf("calc: add comment at %s!%s: %w", sheetName, ref, err)
			}
		}
	}
	return nil
}

// commentThread is the server-side counterpart to the TS Thread shape.
// Built lazily per cell — applyCommentsToFile pays no cost for cells
// without comments.
type commentThread struct {
	root    CommentRow
	replies []CommentRow
}

// buildThreadsForCell groups one cell's rows into root + reply chains,
// in created order. Orphan replies (parent missing among the cell's
// rows) are dropped — same fail-soft contract as the TS buildThreads.
func buildThreadsForCell(rowsForCell []CommentRow) []commentThread {
	sorted := slices.Clone(rowsForCell)
	sort.SliceStable(sorted, func(i, j int) bool {
		if !sorted[i].Created.Equal(sorted[j].Created) {
			return sorted[i].Created.Before(sorted[j].Created)
		}
		return sorted[i].ID < sorted[j].ID
	})
	threads := make(map[string]*commentThread)
	order := make([]string, 0)
	for _, r := range sorted {
		if r.ParentID != "" {
			continue
		}
		threads[r.ID] = &commentThread{root: r}
		order = append(order, r.ID)
	}
	for _, r := range sorted {
		if r.ParentID == "" {
			continue
		}
		t, ok := threads[r.ParentID]
		if !ok {
			continue
		}
		t.replies = append(t.replies, r)
	}
	out := make([]commentThread, 0, len(order))
	for _, id := range order {
		out = append(out, *threads[id])
	}
	return out
}

// formatThreadForXlsx renders a thread to the (Author, Text) pair
// excelize.AddComment expects. Author is the most-recent commenter (the
// reply author, falling back to the root author for a reply-less
// thread) — matches Sheets' "last replier" attribution when the file
// is opened in Excel.
//
// Text format:
//
//	<root.AuthorName> (<root.Created>): <root.Body>
//	— <reply1.AuthorName>: <reply1.Body>
//	— <reply2.AuthorName>: <reply2.Body>
//	[resolved <ResolvedAt>]
//
// The resolved footer is appended only when the thread is marked
// resolved on the root.
func formatThreadForXlsx(thread commentThread) (string, string) {
	var sb strings.Builder
	rootCreated := formatTime(thread.root.Created)
	sb.WriteString(thread.root.AuthorName)
	if rootCreated != "" {
		sb.WriteString(" (")
		sb.WriteString(rootCreated)
		sb.WriteString(")")
	}
	sb.WriteString(": ")
	sb.WriteString(thread.root.Body)

	for _, reply := range thread.replies {
		sb.WriteString("\n— ")
		sb.WriteString(reply.AuthorName)
		sb.WriteString(": ")
		sb.WriteString(reply.Body)
	}

	if thread.root.IsResolved {
		sb.WriteString("\n[resolved ")
		sb.WriteString(formatTime(thread.root.ResolvedAt))
		sb.WriteString("]")
	}

	author := thread.root.AuthorName
	if n := len(thread.replies); n > 0 {
		author = thread.replies[n-1].AuthorName
	}
	return author, sb.String()
}

// formatTime renders a time.Time as an ISO date (YYYY-MM-DD). Empty
// when zero so the formatter doesn't emit "(0001-01-01)" for legacy
// rows with missing timestamps.
func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format("2006-01-02")
}
