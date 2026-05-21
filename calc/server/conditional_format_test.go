package calc

import (
	"bytes"
	"os"
	"testing"

	"github.com/xuri/excelize/v2"
)

// TestConditionalFormatRoundtripNumberGreater verifies that a doc-side
// numberGreater rule maps to a "cell" + "greater than" excelize rule
// and that re-parsing the saved file produces an equivalent rule.
func TestConditionalFormatRoundtripNumberGreater(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	op := "50"
	color := "#FF0000"
	rule := ConditionalFormatRule{
		ID:     "test-1",
		Ranges: []string{"A1:A10"},
		Condition: ConditionalCondition{
			Type:   "numberGreater",
			Value1: &op,
		},
		Style: &CellStyle{
			Fill: &CellFill{
				Type:    strPtr("pattern"),
				Pattern: strPtr("solid"),
				FgColor: &color,
				BgColor: &color,
			},
		},
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID:                 "sheet1",
				Name:               "People",
				Position:           0,
				ConditionalFormats: []ConditionalFormatRule{rule},
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	// Re-parse and confirm excelize sees the rule.
	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer func() { _ = f.Close() }()

	got, err := f.GetConditionalFormats("People")
	if err != nil {
		t.Fatalf("GetConditionalFormats: %v", err)
	}
	opts, ok := got["A1:A10"]
	if !ok {
		t.Fatalf("expected CF on A1:A10; got map %v", got)
	}
	if len(opts) != 1 {
		t.Fatalf("expected 1 rule on A1:A10; got %d", len(opts))
	}
	if opts[0].Type != "cell" {
		t.Errorf("type: want cell, got %q", opts[0].Type)
	}
	// excelize accepts both textual and symbolic criteria; assert
	// either form is OK here.
	if c := opts[0].Criteria; c != "greater than" && c != ">" {
		t.Errorf("criteria: want greater than, got %q", c)
	}
	if opts[0].Value != "50" {
		t.Errorf("value: want %q, got %q", "50", opts[0].Value)
	}

	// And confirm our reader maps it back to numberGreater.
	rules, err := readConditionalFormats(f, "People")
	if err != nil {
		t.Fatalf("readConditionalFormats: %v", err)
	}
	if len(rules) != 1 {
		t.Fatalf("expected 1 rule on re-parse; got %d", len(rules))
	}
	if rules[0].Condition.Type != "numberGreater" {
		t.Errorf("re-parse condition type: want numberGreater, got %q", rules[0].Condition.Type)
	}
	if rules[0].Condition.Value1 == nil || *rules[0].Condition.Value1 != "50" {
		t.Errorf("re-parse value: want %q, got %v", "50", rules[0].Condition.Value1)
	}
}

func TestConditionalFormatRoundtripCustomFormula(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	formula := "$A1=\"Yes\""
	rule := ConditionalFormatRule{
		ID:     "test-2",
		Ranges: []string{"A1:B10"},
		Condition: ConditionalCondition{
			Type:    "customFormula",
			Formula: &formula,
		},
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID:                 "sheet1",
				Name:               "People",
				Position:           0,
				ConditionalFormats: []ConditionalFormatRule{rule},
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer func() { _ = f.Close() }()

	got, err := f.GetConditionalFormats("People")
	if err != nil {
		t.Fatalf("GetConditionalFormats: %v", err)
	}
	opts := got["A1:B10"]
	if len(opts) == 0 {
		t.Fatalf("expected CF on A1:B10; got %v", got)
	}
	// Excelize labels custom-formula rules as either "expression" or
	// "formula" depending on the variant; both are acceptable.
	if got := opts[0].Type; got != "formula" && got != "expression" {
		t.Errorf("type: want formula/expression, got %q", got)
	}
	rules, err := readConditionalFormats(f, "People")
	if err != nil {
		t.Fatalf("readConditionalFormats: %v", err)
	}
	if len(rules) != 1 {
		t.Fatalf("expected 1 rule; got %d", len(rules))
	}
	if rules[0].Condition.Type != "customFormula" {
		t.Errorf("type: want customFormula, got %q", rules[0].Condition.Type)
	}
	if rules[0].Condition.Formula == nil || *rules[0].Condition.Formula != formula {
		t.Errorf("formula: want %q, got %v", formula, rules[0].Condition.Formula)
	}
}

func TestConditionalFormatOpaquePassthrough(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	// Stamp a "duplicateValues" rule via excelize directly so the
	// re-parse must round-trip it as xlsxOpaque (the authoring UI
	// doesn't model it in v1).
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	// "duplicate" rules require a Format pointer to a dxf index;
	// supply a minimal one so excelize accepts the seed.
	fmtIdx, err := f.NewConditionalStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	if err != nil {
		t.Fatalf("new dxf: %v", err)
	}
	if err := f.SetConditionalFormat("People", "A1:A10", []excelize.ConditionalFormatOptions{
		{Type: "duplicate", Criteria: "=", Format: &fmtIdx},
	}); err != nil {
		t.Fatalf("seed CF: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("write seeded: %v", err)
	}
	_ = f.Close()

	// Read it back via our reader.
	f2, err := excelize.OpenReader(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatalf("reopen seeded: %v", err)
	}
	defer func() { _ = f2.Close() }()
	rules, err := readConditionalFormats(f2, "People")
	if err != nil {
		t.Fatalf("readConditionalFormats: %v", err)
	}
	if len(rules) != 1 {
		t.Fatalf("expected 1 rule from seeded xlsx; got %d", len(rules))
	}
	if rules[0].Condition.Type != "xlsxOpaque" {
		t.Errorf("opaque type: want xlsxOpaque, got %q", rules[0].Condition.Type)
	}
	if rules[0].Condition.OpaqueXlsx == nil {
		t.Fatalf("opaque blob is nil; want roundtrip payload")
	}
	if rules[0].Condition.OpaqueXlsx["Type"] != "duplicate" {
		t.Errorf("opaque Type: want duplicate, got %v", rules[0].Condition.OpaqueXlsx["Type"])
	}

	// Now serialize a snapshot that carries the opaque rule and
	// verify the saved xlsx still has a duplicate rule.
	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID:                 "sheet1",
				Name:               "People",
				Position:           0,
				ConditionalFormats: rules,
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}
	out, err := serializeSnapshotToXLSX(buf.Bytes(), snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	f3, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("reopen final: %v", err)
	}
	defer func() { _ = f3.Close() }()
	got, err := f3.GetConditionalFormats("People")
	if err != nil {
		t.Fatalf("GetConditionalFormats final: %v", err)
	}
	opts := got["A1:A10"]
	if len(opts) == 0 {
		t.Fatalf("opaque round-trip lost the rule; got %v", got)
	}
	if opts[0].Type != "duplicate" {
		t.Errorf("opaque round-trip type: want duplicate, got %q", opts[0].Type)
	}
}

func strPtr(s string) *string { return &s }
