// Package render emits a sanitized HTML content fragment for one
// xlsx workbook. The fragment carries only `tinycld-calc*` classes
// and is safe to inline directly inside a <body> (preview iframe or
// print envelope). All page-layout concerns (paper size, margins,
// print headers/footers) live in client-side CSS — this package is
// content-only.
//
// Entry point: RenderHTML(wb, opts). The shared sanitizer from
// tinycld.org/core/render runs after the renderer emits so any
// future stray HTML in imported cell strings is stripped before the
// response is written.
package render

import (
	"errors"
	"fmt"
	"strings"

	coreRender "tinycld.org/core/render"
)

// ErrBadRequest classifies render errors caused by malformed caller
// input (bad range, unknown sheet, unsupported scope). The HTTP
// handler maps errors-that-wrap-ErrBadRequest to 400 and everything
// else to 500.
//
// Renderer-internal failures (sanitizer crash, internal data
// corruption) deliberately do NOT wrap this — they should surface as
// 500 so the operator notices.
var ErrBadRequest = errors.New("render: bad request")

// bad wraps a caller-input error so the HTTP handler can detect it
// via errors.Is(err, ErrBadRequest). Internal helpers should use
// this for any error that's the caller's fault.
func bad(format string, args ...interface{}) error {
	return fmt.Errorf("%w: "+format, append([]interface{}{ErrBadRequest}, args...)...)
}

// sanitizeAllowlist is calc's policy for the shared sanitizer. The
// tag set is narrow on purpose: calc only ever emits a spreadsheet-
// shaped fragment (<section>/<article>/<h2>/<table>/<thead>/<tbody>/
// <tr>/<th>/<td>/<img>/<colgroup>/<col>). The class allowlist binds
// to the project's "tinycld-" CSS namespace; calc does not emit
// hyperlinks so the mailto flag stays off.
var sanitizeAllowlist = coreRender.Allowlist{
	Tags: map[string]struct{}{
		"section":  {},
		"article":  {},
		"h2":       {},
		"table":    {},
		"thead":    {},
		"tbody":    {},
		"tr":       {},
		"th":       {},
		"td":       {},
		"img":      {},
		"colgroup": {},
		"col":      {},
	},
	// `class` and `style` are universally permitted by the sanitizer
	// — they're filtered by filterClasses / sanitizeStyle on the way
	// out. The per-tag entries below cover the remaining structural
	// attributes (colspan / rowspan / img dimensions / col span).
	Attrs: map[string]map[string]struct{}{
		"img": {
			"src": {}, "alt": {}, "width": {}, "height": {}, "loading": {}, "decoding": {},
		},
		"th":       {"colspan": {}, "rowspan": {}, "scope": {}},
		"td":       {"colspan": {}, "rowspan": {}},
		"col":      {"span": {}},
		"colgroup": {"span": {}},
	},
	ClassPrefix: "tinycld-",
}

// Workbook is the renderer's input model. It mirrors Workbook
// but lives in this package to avoid a calc → render → calc import
// cycle. The HTTP handler in api.go converts the calc model into a
// Workbook before calling RenderHTML.
//
// Keeping the type local also means future renderer changes don't
// require touching the calc package's wire model — the conversion
// shim absorbs the boundary.
type Workbook struct {
	Sheets []Worksheet
}

type Worksheet struct {
	Name   string
	Hidden bool
	Cells  map[string]Cell
	// Merges carries the merged-cell rectangles applied to this sheet.
	// Anchor coordinates are 1-based; spans are inclusive. Empty when
	// the sheet has no merges. writeGrid emits colspan / rowspan on
	// the top-left cell of each rectangle and suppresses the cells
	// inside it.
	Merges []MergeRange
	// ColWidths is a sparse map of 1-based column number → CSS pixel
	// width. Columns not present in the map render at the table's
	// default width. Surfaced as <colgroup><col style="width:Npx">
	// at the top of the grid so print and preview honor the source
	// xlsx's column sizing.
	ColWidths map[int]int
}

// MergeRange mirrors calc's MergeRangeDTO (one rectangle: anchor +
// spans). Lives in the render package so the renderer doesn't depend
// on the calc package's wire types.
type MergeRange struct {
	AnchorRow int
	AnchorCol int
	RowSpan   int
	ColSpan   int
}

// Cell is a value + style pair keyed by "row:col" in the parent
// Worksheet's Cells map. Display is the formatted text shown in the
// cell (a formula cell carries its cached value here, not the formula
// text). Style is optional; nil = use renderer defaults.
type Cell struct {
	Display string
	Style   *CellStyle
}

// CellStyle mirrors calc.CellStyle's render-relevant subset. Every
// field is a pointer so absence is distinguishable from "explicit
// false / empty". The HTTP handler shim copies the calc types onto
// this shape one-to-one.
type CellStyle struct {
	Font      *CellFont
	Fill      *CellFill
	Alignment *CellAlignment
	Borders   *CellBorders
}

type CellFont struct {
	Bold      *bool
	Italic    *bool
	Underline *bool
	Strike    *bool
	// Size is the font size in points (xlsx stores half-pt increments).
	// Nil means "use the workbook default"; pre-write the CSS default
	// rather than emitting a per-cell override.
	Size *float64
	// Name is the font family (e.g. "Calibri", "Arial"). Nil means "use
	// the workbook default".
	Name *string
	// Color is a CSS color literal — typically "#RRGGBB" but tolerated
	// as 3/4/8-digit hex or rgb()/rgba(). Value validation lives in
	// cell.go::isSafeColorAttr, applied before the value is emitted on
	// the data-color attribute.
	Color *string
}

type CellFill struct {
	FgColor *string
	BgColor *string
}

type CellAlignment struct {
	Horizontal *string
	Vertical   *string
	WrapText   *bool
}

type CellBorders struct {
	Top, Right, Bottom, Left *CellBorderEdge
}

// CellBorderEdge carries the painted-edge bit. IsClear=true means
// "explicit clear — do not paint anything"; otherwise Style/Color
// drive the rendering (the renderer maps Style to a presence-style
// class and lets the CSS choose the actual visual treatment).
type CellBorderEdge struct {
	Style   *string
	Color   *string
	IsClear bool
}

// RendererVersion is bumped whenever the emitted HTML structure or
// class names change. ETags include this constant so cached previews
// invalidate cleanly across deploys.
const RendererVersion = "v1"

// Scope picks which sheets in the workbook get rendered.
//
//   - ScopeAll: every visible sheet (default).
//   - ScopeSelection: only the sheet identified by Sheet, with the
//     A1 range constraint (if Range is set).
type Scope string

const (
	ScopeAll       Scope = "all"
	ScopeSelection Scope = "selection"
)

// ImageMode selects how image references are surfaced.
//
//   - ImageURL: <img src> points at a drive file URL with the
//     caller's auth token. Used by previews. Image extraction is a
//     future enhancement — current calc renderer emits cell text only,
//     so this is a no-op for now but the signature is reserved.
//   - ImageEmbed: image bytes are inlined as data: URIs. Required
//     by native print.
type ImageMode string

const (
	ImageURL   ImageMode = "url"
	ImageEmbed ImageMode = "embed"
)

// RenderOpts is the request-level customization the HTTP handler
// passes through after parsing query parameters.
type RenderOpts struct {
	// Sheet is the sheet ID or name to render (used with ScopeSelection).
	// Empty falls back to all visible sheets.
	Sheet string
	// Range is an A1-style range string ("B2:D10") to clip to. Empty
	// = full used range of the chosen sheet(s).
	Range string
	// Scope = ScopeAll or ScopeSelection. Empty defaults to ScopeAll.
	Scope Scope
	// Images is the image transport mode for any image references in
	// the source workbook. Defaults to ImageURL.
	Images ImageMode
}

// RenderHTML walks the parsed workbook and emits a content fragment.
// The fragment is sanitized before return — callers don't need to
// re-sanitize.
//
// Output shape:
//
//	<section class="tinycld-calc">
//	    <article class="tinycld-calc-sheet">
//	        <h2 class="tinycld-calc-sheet-title">…</h2>      [only when multi-sheet]
//	        <table class="tinycld-calc-grid">
//	            <thead><tr>
//	                <th class="tinycld-calc-corner"></th>
//	                <th class="tinycld-calc-col-h">A</th> …
//	            </tr></thead>
//	            <tbody>
//	                <tr>
//	                    <th class="tinycld-calc-row-h">1</th>
//	                    <td class="tinycld-calc-cell …">…</td> …
//	                </tr>
//	            </tbody>
//	        </table>
//	    </article>
//	</section>
func RenderHTML(wb Workbook, opts RenderOpts) (string, error) {
	sheets, err := pickSheets(wb, opts)
	if err != nil {
		return "", err
	}
	multiSheet := len(sheets) > 1

	var b strings.Builder
	b.WriteString(`<section class="tinycld-calc">`)
	for _, sheet := range sheets {
		clip, err := computeClip(sheet, opts)
		if err != nil {
			return "", err
		}
		writeSheet(&b, sheet, clip, multiSheet)
	}
	b.WriteString(`</section>`)

	clean, err := coreRender.Sanitize(b.String(), sanitizeAllowlist)
	if err != nil {
		return "", fmt.Errorf("calc render: sanitize: %w", err)
	}
	return clean, nil
}

// pickSheets returns the workbook sheets that participate in this
// render. Hidden sheets never appear; selection scope filters to a
// single sheet by name or ID. The default is every visible sheet in
// workbook order.
func pickSheets(wb Workbook, opts RenderOpts) ([]Worksheet, error) {
	scope := opts.Scope
	if scope == "" {
		scope = ScopeAll
	}
	visible := make([]Worksheet, 0, len(wb.Sheets))
	for _, s := range wb.Sheets {
		if s.Hidden {
			continue
		}
		visible = append(visible, s)
	}
	if scope == ScopeAll {
		return visible, nil
	}
	if scope != ScopeSelection {
		return nil, bad("unknown scope %q", scope)
	}
	if opts.Sheet == "" {
		// Selection without a sheet target falls back to the first
		// visible sheet — matches the behavior of the existing TS
		// preview which always renders sheets[0] by default.
		if len(visible) == 0 {
			return nil, nil
		}
		return visible[:1], nil
	}
	for _, s := range visible {
		if s.Name == opts.Sheet {
			return []Worksheet{s}, nil
		}
	}
	return nil, bad("sheet %q not found", opts.Sheet)
}

// clipRect is the inclusive 1-based rectangle of cells to render
// from a sheet. computeClip derives it from the sheet's used range
// (defaulting) and the optional opts.Range A1 string.
type clipRect struct {
	startRow, endRow int
	startCol, endCol int
}

func computeClip(sheet Worksheet, opts RenderOpts) (clipRect, error) {
	used := usedRange(sheet)
	if opts.Range == "" {
		return used, nil
	}
	parsed, err := parseA1Range(opts.Range)
	if err != nil {
		return clipRect{}, bad("range %q: %v", opts.Range, err)
	}
	// Intersect with the used range so a too-wide range doesn't pad
	// the output with empty cells past the last data cell.
	return clipRect{
		startRow: maxInt(parsed.startRow, used.startRow),
		endRow:   minInt(parsed.endRow, used.endRow),
		startCol: maxInt(parsed.startCol, used.startCol),
		endCol:   minInt(parsed.endCol, used.endCol),
	}, nil
}

// usedRange walks the sheet's cells map and returns the tight
// rectangle that contains every non-empty cell. Falls back to the
// sheet's RowCount/ColCount when there are no cells (empty sheet).
func usedRange(sheet Worksheet) clipRect {
	if len(sheet.Cells) == 0 {
		return clipRect{startRow: 1, endRow: 1, startCol: 1, endCol: 1}
	}
	rect := clipRect{startRow: 1<<31 - 1, startCol: 1<<31 - 1}
	for key := range sheet.Cells {
		r, c, ok := parseCellKey(key)
		if !ok {
			continue
		}
		if r < rect.startRow {
			rect.startRow = r
		}
		if r > rect.endRow {
			rect.endRow = r
		}
		if c < rect.startCol {
			rect.startCol = c
		}
		if c > rect.endCol {
			rect.endCol = c
		}
	}
	if rect.startRow > rect.endRow {
		// All keys malformed — fall back to a single-cell range so
		// the renderer still produces a non-crashing skeleton.
		rect = clipRect{startRow: 1, endRow: 1, startCol: 1, endCol: 1}
	}
	return rect
}

func parseCellKey(key string) (int, int, bool) {
	parts := strings.SplitN(key, ":", 2)
	if len(parts) != 2 {
		return 0, 0, false
	}
	r, err := atoiPositive(parts[0])
	if err != nil {
		return 0, 0, false
	}
	c, err := atoiPositive(parts[1])
	if err != nil {
		return 0, 0, false
	}
	return r, c, true
}

func atoiPositive(s string) (int, error) {
	if s == "" {
		return 0, fmt.Errorf("empty")
	}
	n := 0
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ch < '0' || ch > '9' {
			return 0, fmt.Errorf("non-digit")
		}
		n = n*10 + int(ch-'0')
	}
	if n <= 0 {
		return 0, fmt.Errorf("non-positive")
	}
	return n, nil
}

// parseA1Range parses an inclusive A1 range like "B2:D10" or "A1" (a
// single cell). Single-cell forms collapse to a 1×1 rect. Anything
// malformed returns an error so the handler can respond with 400.
func parseA1Range(s string) (clipRect, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return clipRect{}, fmt.Errorf("empty range")
	}
	parts := strings.SplitN(s, ":", 2)
	from := parts[0]
	to := from
	if len(parts) == 2 {
		to = parts[1]
	}
	startCol, startRow, err := parseA1Cell(from)
	if err != nil {
		return clipRect{}, fmt.Errorf("invalid range start %q: %w", from, err)
	}
	endCol, endRow, err := parseA1Cell(to)
	if err != nil {
		return clipRect{}, fmt.Errorf("invalid range end %q: %w", to, err)
	}
	if endRow < startRow {
		startRow, endRow = endRow, startRow
	}
	if endCol < startCol {
		startCol, endCol = endCol, startCol
	}
	return clipRect{
		startRow: startRow, endRow: endRow,
		startCol: startCol, endCol: endCol,
	}, nil
}

// parseA1Cell splits "AB12" into (col=28, row=12). Returns an error
// for empty, non-letter prefix, or non-digit suffix inputs.
func parseA1Cell(s string) (int, int, error) {
	if s == "" {
		return 0, 0, fmt.Errorf("empty cell ref")
	}
	i := 0
	col := 0
	for ; i < len(s); i++ {
		ch := s[i]
		if ch >= 'a' && ch <= 'z' {
			ch -= 'a' - 'A'
		}
		if ch < 'A' || ch > 'Z' {
			break
		}
		col = col*26 + int(ch-'A'+1)
	}
	if col == 0 || i == 0 {
		return 0, 0, fmt.Errorf("missing column letters")
	}
	row, err := atoiPositive(s[i:])
	if err != nil {
		return 0, 0, fmt.Errorf("missing or invalid row number")
	}
	return col, row, nil
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// writeSheet emits one <article class="tinycld-calc-sheet"> block.
// showTitle is true only when the parent has multiple sheets in the
// fragment; the first sheet gets a leading title to disambiguate.
func writeSheet(b *strings.Builder, sheet Worksheet, clip clipRect, showTitle bool) {
	b.WriteString(`<article class="tinycld-calc-sheet">`)
	if showTitle {
		b.WriteString(`<h2 class="tinycld-calc-sheet-title">`)
		b.WriteString(escapeHTML(sheet.Name))
		b.WriteString(`</h2>`)
	}
	writeGrid(b, sheet, clip)
	b.WriteString(`</article>`)
}

// mergeMaps indexes the sheet's merge rectangles into two maps:
//   - anchors: (row,col) → MergeRange when this cell is the merge
//     anchor (top-left). writeGrid emits colspan/rowspan from this.
//   - covered: (row,col) → true when this cell is INSIDE a merge but
//     NOT the anchor. writeGrid skips these so the merged cell spans
//     visually.
type mergeMaps struct {
	anchors map[uint64]MergeRange
	covered map[uint64]struct{}
}

func mergeKey(row, col int) uint64 {
	return uint64(row)<<32 | uint64(uint32(col))
}

func buildMergeMaps(merges []MergeRange) mergeMaps {
	out := mergeMaps{
		anchors: map[uint64]MergeRange{},
		covered: map[uint64]struct{}{},
	}
	for _, m := range merges {
		if m.RowSpan <= 0 || m.ColSpan <= 0 {
			continue
		}
		if m.RowSpan == 1 && m.ColSpan == 1 {
			// Degenerate 1×1 — not a merge.
			continue
		}
		out.anchors[mergeKey(m.AnchorRow, m.AnchorCol)] = m
		for dr := 0; dr < m.RowSpan; dr++ {
			for dc := 0; dc < m.ColSpan; dc++ {
				if dr == 0 && dc == 0 {
					continue
				}
				out.covered[mergeKey(m.AnchorRow+dr, m.AnchorCol+dc)] = struct{}{}
			}
		}
	}
	return out
}

// writeGrid produces the <table class="tinycld-calc-grid">…</table>
// for the sheet, including the column-letter header row and per-row
// number headers. Cells outside the clip rect are not emitted at all.
// Merged cells get colspan/rowspan on the anchor cell; covered cells
// inside the rectangle are skipped entirely so the anchor's spans
// fill them.
func writeGrid(b *strings.Builder, sheet Worksheet, clip clipRect) {
	merges := buildMergeMaps(sheet.Merges)
	b.WriteString(`<table class="tinycld-calc-grid">`)
	writeColgroup(b, sheet.ColWidths, clip)

	// thead: corner + column letters
	b.WriteString(`<thead><tr>`)
	b.WriteString(`<th class="tinycld-calc-corner"></th>`)
	for c := clip.startCol; c <= clip.endCol; c++ {
		b.WriteString(`<th class="tinycld-calc-col-h">`)
		b.WriteString(columnLabel(c))
		b.WriteString(`</th>`)
	}
	b.WriteString(`</tr></thead>`)

	b.WriteString(`<tbody>`)
	for r := clip.startRow; r <= clip.endRow; r++ {
		b.WriteString(`<tr>`)
		b.WriteString(`<th class="tinycld-calc-row-h">`)
		b.WriteString(itoa(r))
		b.WriteString(`</th>`)
		for c := clip.startCol; c <= clip.endCol; c++ {
			k := mergeKey(r, c)
			if _, covered := merges.covered[k]; covered {
				// Inside a merge but not the anchor — skip.
				continue
			}
			var mergeAttrs string
			if m, ok := merges.anchors[k]; ok {
				mergeAttrs = renderMergeAttrs(m)
			}
			key := fmt.Sprintf("%d:%d", r, c)
			cell, ok := sheet.Cells[key]
			if !ok {
				b.WriteString(`<td class="tinycld-calc-cell"`)
				b.WriteString(mergeAttrs)
				b.WriteString(`></td>`)
				continue
			}
			writeCellWithMerge(b, cell, mergeAttrs)
		}
		b.WriteString(`</tr>`)
	}
	b.WriteString(`</tbody>`)
	b.WriteString(`</table>`)
}

// writeColgroup emits one <col> per column in the clip range, with an
// inline width style when the source sheet recorded a non-default
// column width. Always emits a <colgroup> wrapper (even when no
// widths are tracked) so the leading corner column is accounted for
// in browser column-resolution.
//
// The leftmost <col> covers the row-header column and never carries a
// width (it sizes to its own header content). Remaining <col>s map
// 1:1 to columns in the clip range, in order, so column N in the clip
// gets a width from ColWidths[N] when present.
func writeColgroup(b *strings.Builder, widths map[int]int, clip clipRect) {
	b.WriteString(`<colgroup>`)
	b.WriteString(`<col class="tinycld-calc-row-h-col">`)
	for c := clip.startCol; c <= clip.endCol; c++ {
		px, ok := widths[c]
		if ok && px > 0 {
			b.WriteString(`<col style="width: `)
			b.WriteString(itoa(px))
			b.WriteString(`px">`)
		} else {
			b.WriteString(`<col>`)
		}
	}
	b.WriteString(`</colgroup>`)
}

func renderMergeAttrs(m MergeRange) string {
	var b strings.Builder
	if m.ColSpan > 1 {
		b.WriteString(` colspan="`)
		b.WriteString(itoa(m.ColSpan))
		b.WriteByte('"')
	}
	if m.RowSpan > 1 {
		b.WriteString(` rowspan="`)
		b.WriteString(itoa(m.RowSpan))
		b.WriteByte('"')
	}
	return b.String()
}

// itoa is a tiny non-allocating integer→string for positive ints.
// Avoids importing strconv just for the row-number column.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	negative := false
	if n < 0 {
		negative = true
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if negative {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// columnLabel converts a 1-based column number into its Excel-style
// label (1 → "A", 27 → "AA", 703 → "AAA"). Mirrors the TS
// columnLabel(workbook-types.ts) exactly.
func columnLabel(col int) string {
	if col <= 0 {
		return "A"
	}
	var rev []byte
	n := col
	for n > 0 {
		rem := (n - 1) % 26
		rev = append(rev, byte('A'+rem))
		n = (n - 1) / 26
	}
	for i, j := 0, len(rev)-1; i < j; i, j = i+1, j-1 {
		rev[i], rev[j] = rev[j], rev[i]
	}
	return string(rev)
}
