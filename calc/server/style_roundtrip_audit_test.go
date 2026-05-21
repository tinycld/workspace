package calc

import (
	"bytes"
	"reflect"
	"sort"
	"strings"
	"testing"

	ycrdt "github.com/skyterra/y-crdt"
	"github.com/xuri/excelize/v2"
)

// TestCellStyleAttributeRoundTripExhaustive is the canonical audit: it
// proves that EVERY leaf on CellStyle survives the full server-side
// round-trip — overlay onto excelize, serialize to xlsx, re-read,
// extract back to CellStyle, AND bootstrap-emit to YMap + decode back.
//
// The enumeration is reflect-driven via collectCellStyleLeaves, so
// adding a new leaf on CellStyle automatically grows the matrix. The
// test fails with a per-leaf, per-stage breakdown the first time a
// new attribute slips through without writer + reader + bootstrap
// support.
//
// This is the test that would have caught the original bug: the read
// side only handled font.bold, and the bootstrap-emit only handled
// font + numFmt. After the fix, the test passes for every leaf in
// the registry.
func TestCellStyleAttributeRoundTripExhaustive(t *testing.T) {
	leaves := collectCellStyleLeaves()
	if len(leaves) == 0 {
		t.Fatal("no CellStyle leaves discovered — schema introspection broken")
	}

	// Every CellStyle leaf MUST have a registry entry. The registry is
	// what extractStyle uses to invert overlayStyle and what this audit
	// uses to canary every stage. A missing entry means the leaf has no
	// way of being read back from excelize, even if overlayStyle's
	// reflect walk writes it correctly.
	for _, path := range leaves {
		if _, ok := styleAttributeRegistry[path]; !ok {
			t.Errorf("CellStyle leaf %q has no entry in styleAttributeRegistry — extractStyle cannot recover it from excelize", path)
		}
	}
	if t.Failed() {
		return
	}

	for _, path := range leaves {
		t.Run(path, func(t *testing.T) {
			spec := styleAttributeRegistry[path]
			expected := spec.CanaryReadBack
			if expected == nil {
				expected = spec.Canary
			}

			if spec.ReadOnly {
				auditReadOnlyAttribute(t, path, spec, expected)
				return
			}

			patch := buildSingleLeafCellStyle(t, path, spec.Canary)
			report := stageReport{path: path, canary: spec.Canary, expected: expected}

			// Stage 1: overlay onto a fresh excelize.Style and probe.
			base := freshExcelizeStyle()
			overlayStyle(base, patch)
			report.excelize, report.excelizeOK = spec.ReadFromExcelize(base)

			// Stage 2: re-read via extractStyle (the read-side inverse).
			extracted := extractStyle(base)
			report.extracted, report.extractedOK = leafValueFromCellStyle(extracted, path)

			// Stage 3: a real xlsx round-trip — write to a fresh
			// workbook, re-open via excelize, probe and extract again.
			// Catches anything excelize loses on serialize/deserialize
			// that the in-memory style accidentally tolerates.
			xlsxBytes := writeSingleStyledCellXLSX(t, patch)
			reopened := readStyleFromXLSX(t, xlsxBytes, "Sheet1", 1, 1)
			report.xlsx, report.xlsxOK = spec.ReadFromExcelize(reopened)
			xlsxExtracted := extractStyle(reopened)
			report.xlsxExtracted, report.xlsxExtractedOK = leafValueFromCellStyle(xlsxExtracted, path)

			// Stage 4: bootstrap-emit + decode. Mirrors the read path
			// the YDoc bootstrap uses on first joiner — fails when
			// buildStyleYMapFromStyle drops a leaf even if extractStyle
			// recovered it.
			bootstrapped := bootstrapRoundTrip(t, patch)
			report.bootstrap, report.bootstrapOK = leafValueFromCellStyle(bootstrapped, path)

			report.assert(t, expected)
		})
	}
}

// auditReadOnlyAttribute verifies a read-only leaf round-trips on the
// read path: we hand-construct an excelize.Style that carries the
// canary value, then extractStyle must recover it, AND the bootstrap
// path (which sees the extracted CellStyle on first joiner) must
// preserve it through emit + decode. The write legs are skipped
// because the writer cannot produce this leaf.
func auditReadOnlyAttribute(t *testing.T, path string, spec attributeSpec, expected any) {
	t.Helper()
	base := craftExcelizeStyleForReadOnly(t, path, spec.Canary)
	if got, ok := spec.ReadFromExcelize(base); !ok || !equalAny(got, expected) {
		t.Fatalf("attribute %q (read-only): the hand-crafted excelize.Style does not even present the canary — audit scaffolding is broken (got %v present=%v)", path, got, ok)
	}
	extracted := extractStyle(base)
	got, ok := leafValueFromCellStyle(extracted, path)
	if !ok || !equalAny(got, expected) {
		t.Errorf("attribute %q (read-only): extractStyle did not recover the leaf\n  set      = %v\n  expected = %v\n  got      = %v (present=%v)\n  ↳ extractStyle / styleAttributeRegistry gap", path, spec.Canary, expected, got, ok)
	}
	bootstrapped := bootstrapRoundTrip(t, extracted)
	got, ok = leafValueFromCellStyle(bootstrapped, path)
	if !ok || !equalAny(got, expected) {
		t.Errorf("attribute %q (read-only): bootstrap emit+decode dropped the leaf\n  set      = %v\n  expected = %v\n  got      = %v (present=%v)\n  ↳ buildStyleYMapFromStyle does not propagate this field", path, spec.Canary, expected, got, ok)
	}
}

// craftExcelizeStyleForReadOnly produces an excelize.Style that
// carries the read-only canary, bypassing overlayStyle (which the
// writer uses and which cannot represent this leaf). We allow direct
// excelize-shape construction here precisely because the leaf is
// import-only: the audit's job is to prove the reader sees what an
// external editor wrote.
func craftExcelizeStyleForReadOnly(t *testing.T, path string, canary any) *excelize.Style {
	t.Helper()
	switch path {
	case "Fill.BgColor":
		s, ok := canary.(string)
		if !ok {
			t.Fatalf("Fill.BgColor canary must be a hex string, got %T", canary)
		}
		// A non-solid pattern is required for excelize to accept two
		// colors; we use Pattern=2 (darkVertical) which OOXML
		// recognizes. The fg color is required to occupy slot 0; we
		// supply an inert sentinel ("EEEEEE") so the bg color lands in
		// slot 1 unambiguously.
		return &excelize.Style{
			Fill: excelize.Fill{
				Type:    "pattern",
				Pattern: 2,
				Color:   []string{"EEEEEE", strings.TrimPrefix(s, "#")},
			},
		}
	}
	t.Fatalf("no read-only scaffolding for %q — extend craftExcelizeStyleForReadOnly when adding new ReadOnly leaves", path)
	return nil
}

// stageReport holds one leaf's result from every audit stage so the
// failure message points at the exact stage that dropped the value.
type stageReport struct {
	path     string
	canary   any
	expected any

	excelize        any
	excelizeOK      bool
	extracted       any
	extractedOK     bool
	xlsx            any
	xlsxOK          bool
	xlsxExtracted   any
	xlsxExtractedOK bool
	bootstrap       any
	bootstrapOK     bool
}

func (r stageReport) assert(t *testing.T, expected any) {
	t.Helper()
	fail := func(stage, detail string, got any, ok bool) {
		t.Errorf("attribute %q: %s lost the value\n"+
			"  set       = %v\n"+
			"  expected  = %v\n"+
			"  got       = %v (present=%v)\n"+
			"  ↳ %s", r.path, stage, r.canary, expected, got, ok, detail)
	}
	if !r.excelizeOK || !equalAny(r.excelize, expected) {
		fail("excelize", "overlayStyle did not land the value on excelize.Style — likely a styleOverlayOverride gap", r.excelize, r.excelizeOK)
	}
	if !r.extractedOK || !equalAny(r.extracted, expected) {
		fail("extract", "extractStyle did not recover the leaf from excelize.Style — likely a styleAttributeRegistry gap", r.extracted, r.extractedOK)
	}
	if !r.xlsxOK || !equalAny(r.xlsx, expected) {
		fail("xlsx", "value was lost during excelize serialize → deserialize round-trip", r.xlsx, r.xlsxOK)
	}
	if !r.xlsxExtractedOK || !equalAny(r.xlsxExtracted, expected) {
		fail("xlsx-extract", "extractStyle on the reopened xlsx style did not recover the leaf", r.xlsxExtracted, r.xlsxExtractedOK)
	}
	if !r.bootstrapOK || !equalAny(r.bootstrap, expected) {
		fail("bootstrap", "buildStyleYMapFromStyle → decodeCellStyle dropped the leaf — the bootstrap emitter is missing this field", r.bootstrap, r.bootstrapOK)
	}
}

// collectCellStyleLeaves enumerates every dotted pointer-leaf on
// CellStyle. Used both by the audit and as the source of truth for
// "what attributes must round-trip".
func collectCellStyleLeaves() []string {
	var out []string
	walkLeafFields(reflect.TypeOf(CellStyle{}), "", &out)
	sort.Strings(out)
	return out
}

func walkLeafFields(t reflect.Type, prefix string, out *[]string) {
	if t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t.Kind() != reflect.Struct {
		return
	}
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if !field.IsExported() {
			continue
		}
		path := field.Name
		if prefix != "" {
			path = prefix + "." + field.Name
		}
		ft := field.Type
		if ft.Kind() == reflect.Pointer {
			elem := ft.Elem()
			if elem.Kind() == reflect.Struct {
				walkLeafFields(elem, path, out)
				continue
			}
			*out = append(*out, path)
			continue
		}
		// Non-pointer struct fields (none on CellStyle today) recurse
		// without contributing a leaf themselves.
		if ft.Kind() == reflect.Struct {
			walkLeafFields(ft, path, out)
		}
	}
}

// buildSingleLeafCellStyle constructs a *CellStyle with the target
// leaf set to its canary, plus any co-required leaves from the
// registry. The latter ride along so the resulting CellStyle is a
// valid xlsx record (e.g. a "fill bg color" leaf cannot exist on its
// own in OOXML — it needs a pattern + a fg color to be writable).
// The audit asserts only the target leaf's round-trip; co-required
// leaves are independently asserted by their own iterations.
func buildSingleLeafCellStyle(t *testing.T, path string, canary any) *CellStyle {
	t.Helper()
	cs := &CellStyle{}
	assignFromRegistry(t, cs, path, canary)
	spec := styleAttributeRegistry[path]
	for _, co := range spec.CoRequiredPaths {
		coSpec, ok := styleAttributeRegistry[co]
		if !ok {
			t.Fatalf("co-required path %q (referenced by %q) not in registry", co, path)
		}
		assignFromRegistry(t, cs, co, coSpec.Canary)
	}
	return cs
}

func assignFromRegistry(t *testing.T, cs *CellStyle, path string, canary any) {
	t.Helper()
	spec, ok := styleAttributeRegistry[path]
	if !ok {
		t.Fatalf("no registry entry for %q", path)
	}
	if spec.ExtractTo != nil {
		spec.ExtractTo(cs, canary)
		return
	}
	assignLeafByPath(cs, path, canary)
}

// leafValueFromCellStyle extracts the value at the given path off a
// *CellStyle (post-pipeline). Returns (nil, false) when the leaf or
// any of its ancestor groups is nil.
func leafValueFromCellStyle(cs *CellStyle, path string) (any, bool) {
	if cs == nil {
		return nil, false
	}
	v := reflect.ValueOf(cs).Elem()
	parts := splitDottedPath(path)
	for i, name := range parts {
		f := v.FieldByName(name)
		if !f.IsValid() {
			return nil, false
		}
		if i == len(parts)-1 {
			if f.Kind() == reflect.Pointer {
				if f.IsNil() {
					return nil, false
				}
				return f.Elem().Interface(), true
			}
			return f.Interface(), true
		}
		if f.Kind() != reflect.Pointer || f.IsNil() {
			return nil, false
		}
		v = f.Elem()
	}
	return nil, false
}

// equalAny compares two values from the audit pipeline. Most values
// are bool / string / float64 and compare directly; hex strings need
// the leading "#" trimmed because the writer accepts both forms but
// excelize stores bare hex.
func equalAny(got, want any) bool {
	if got == nil || want == nil {
		return got == nil && want == nil
	}
	gs, gok := got.(string)
	ws, wok := want.(string)
	if gok && wok {
		return strings.TrimPrefix(gs, "#") == strings.TrimPrefix(ws, "#")
	}
	return reflect.DeepEqual(got, want)
}

// freshExcelizeStyle returns an empty excelize.Style suitable as the
// "base" for overlayStyle. Matches what applyCellStyle uses when the
// cell has no pre-existing style.
func freshExcelizeStyle() *excelize.Style {
	return &excelize.Style{}
}

// writeSingleStyledCellXLSX opens a fresh xlsx, registers a style
// built by overlaying patch on an empty base, applies it to A1, and
// returns the workbook bytes. Mirrors what applyCellStyle does — the
// audit calls this so it exercises the actual write path the live
// server uses on save.
func writeSingleStyledCellXLSX(t *testing.T, patch *CellStyle) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()
	// SetCellValue gives the cell a writable address; without a value
	// excelize omits the cell from the saved xml and the style binding
	// has nothing to attach to.
	if err := f.SetCellValue("Sheet1", "A1", "audit"); err != nil {
		t.Fatalf("seed cell value: %v", err)
	}
	base := &excelize.Style{}
	overlayStyle(base, patch)
	id, err := f.NewStyle(base)
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetCellStyle("Sheet1", "A1", "A1", id); err != nil {
		t.Fatalf("SetCellStyle: %v", err)
	}
	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		t.Fatalf("write workbook: %v", err)
	}
	return buf.Bytes()
}

// readStyleFromXLSX reopens xlsx bytes and returns the excelize.Style
// applied at (sheet, row, col), or a freshly-allocated empty style
// when the cell has no registered style.
func readStyleFromXLSX(t *testing.T, xlsx []byte, sheet string, row, col int) *excelize.Style {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	id, err := f.GetCellStyle(sheet, ref)
	if err != nil {
		t.Fatalf("GetCellStyle %s!%s: %v", sheet, ref, err)
	}
	if id == 0 {
		return &excelize.Style{}
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("GetStyle %d: %v", id, err)
	}
	if style == nil {
		return &excelize.Style{}
	}
	return style
}

// bootstrapRoundTrip exercises the bootstrap-emit path: build a YMap
// from the patch, attach it under a real Y.Doc (so ForEach can read
// the entries — y-crdt keeps Set'd values in PrelimContent until the
// YMap is integrated into a doc), then decode it through the same
// decodeCellStyle the live runtime uses on first joiner. Returns the
// reconstructed *CellStyle.
func bootstrapRoundTrip(t *testing.T, patch *CellStyle) *CellStyle {
	t.Helper()
	doc := ycrdt.NewDoc("audit", false, nil, nil, false)
	root, ok := doc.GetMap("cells").(*ycrdt.YMap)
	if !ok {
		t.Fatal("doc cells map not a YMap")
	}
	doc.Transact(func(_ *ycrdt.Transaction) {
		emitted := buildStyleYMapFromStyle(patch)
		if emitted == nil {
			return
		}
		root.Set("style", emitted)
	}, nil)

	styleVal := root.Get("style")
	if styleVal == nil {
		return nil
	}
	styleMap, ok := styleVal.(*ycrdt.YMap)
	if !ok {
		t.Fatalf("style key is not a YMap, got %T", styleVal)
	}
	decoded, err := decodeCellStyle(styleMap)
	if err != nil {
		t.Fatalf("decodeCellStyle: %v", err)
	}
	return decoded
}

// TestCellStyleReadFromXLSXEndToEnd is the user-facing reproduction of
// the original bug: write a workbook with every CellStyle attribute
// set on one cell, run it through ReadWorkbookFromXLSX (the production
// preview / bootstrap entry point), and assert every attribute
// survives onto the resulting WorkbookModel. Catches a regression at
// the level of "open a customer xlsx, half the formatting is gone".
func TestCellStyleReadFromXLSXEndToEnd(t *testing.T) {
	leaves := collectCellStyleLeaves()

	combined := &CellStyle{}
	for _, path := range leaves {
		spec := styleAttributeRegistry[path]
		if spec.ReadOnly {
			// Writer can't produce this leaf — auditReadOnlyAttribute
			// covers the read-only round-trip separately.
			continue
		}
		if spec.ExtractTo != nil {
			spec.ExtractTo(combined, spec.Canary)
			continue
		}
		assignLeafByPath(combined, path, spec.Canary)
	}

	xlsxBytes := writeSingleStyledCellXLSX(t, combined)

	model, err := ReadWorkbookFromXLSX(xlsxBytes, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	if len(model.Sheets) == 0 {
		t.Fatal("no sheets in workbook model")
	}
	sheet := model.Sheets[0]
	cell, ok := sheet.Cells["1:1"]
	if !ok {
		t.Fatalf("no cell at 1:1, got keys: %v", sheetCellKeys(sheet))
	}
	if cell.Style == nil {
		t.Fatal("ReadWorkbookFromXLSX dropped the entire style block — extractStyle returned nil despite a fully-styled cell")
	}

	for _, path := range leaves {
		spec := styleAttributeRegistry[path]
		if spec.ReadOnly {
			// Writer cannot produce a ReadOnly leaf, so a
			// writer-built fixture can't carry it. Audited
			// separately in auditReadOnlyAttribute.
			continue
		}
		expected := spec.CanaryReadBack
		if expected == nil {
			expected = spec.Canary
		}
		got, ok := leafValueFromCellStyle(cell.Style, path)
		if !ok || !equalAny(got, expected) {
			t.Errorf("ReadWorkbookFromXLSX lost %q: want %v, got %v (present=%v)", path, expected, got, ok)
		}
	}
}

func sheetCellKeys(s WorksheetModel) []string {
	keys := make([]string, 0, len(s.Cells))
	for k := range s.Cells {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

