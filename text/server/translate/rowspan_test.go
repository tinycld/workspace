package translate

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

func extractDocumentXML(t *testing.T, docxBytes []byte) []byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(docxBytes), int64(len(docxBytes)))
	if err != nil {
		t.Fatalf("extractDocumentXML: open zip: %v", err)
	}
	for _, f := range zr.File {
		if f.Name == "word/document.xml" {
			r, err := f.Open()
			if err != nil {
				t.Fatalf("open document.xml: %v", err)
			}
			data, err := io.ReadAll(r)
			r.Close()
			if err != nil {
				t.Fatalf("read document.xml: %v", err)
			}
			return data
		}
	}
	t.Fatalf("docx missing word/document.xml")
	return nil
}

// TestConsolidateVMerges_BasicVerticalMerge covers the import-side
// post-pass: a continue cell directly under a start cell should
// collapse into the start cell's rowspan and be removed from its row.
func TestConsolidateVMerges_BasicVerticalMerge(t *testing.T) {
	tbl := &PMNode{
		Type: NodeTypeTable,
		Content: []PMNode{
			{
				Type: NodeTypeTableRow,
				Content: []PMNode{
					{
						Type:  NodeTypeTableCell,
						Attrs: map[string]any{"_vmerge": "restart"},
					},
					{Type: NodeTypeTableCell},
				},
			},
			{
				Type: NodeTypeTableRow,
				Content: []PMNode{
					{
						Type:  NodeTypeTableCell,
						Attrs: map[string]any{"_vmerge": "continue"},
					},
					{Type: NodeTypeTableCell},
				},
			},
		},
	}

	consolidateVMerges(tbl)

	if len(tbl.Content[0].Content) != 2 {
		t.Fatalf("row 0 should still have 2 cells, got %d", len(tbl.Content[0].Content))
	}
	if len(tbl.Content[1].Content) != 1 {
		t.Fatalf("row 1 should be down to 1 cell (continue removed), got %d", len(tbl.Content[1].Content))
	}
	startCell := tbl.Content[0].Content[0]
	rs, ok := startCell.Attrs["rowspan"]
	if !ok {
		t.Fatalf("start cell missing rowspan after consolidation: %+v", startCell.Attrs)
	}
	if asIntForPad(rs) != 2 {
		t.Errorf("expected rowspan=2, got %v", rs)
	}
	if _, has := startCell.Attrs["_vmerge"]; has {
		t.Errorf("_vmerge sentinel should have been stripped, got %+v", startCell.Attrs)
	}
}

// TestConsolidateVMerges_ContinueWithoutStart treats a stray continue
// (no active run above) as a fresh start cell. This is defensive — Word
// shouldn't emit this, but we don't want a malformed input to corrupt
// later cells in the same column.
func TestConsolidateVMerges_ContinueWithoutStart(t *testing.T) {
	tbl := &PMNode{
		Type: NodeTypeTable,
		Content: []PMNode{
			{
				Type: NodeTypeTableRow,
				Content: []PMNode{
					{
						Type:  NodeTypeTableCell,
						Attrs: map[string]any{"_vmerge": "continue"},
					},
				},
			},
		},
	}
	consolidateVMerges(tbl)
	if len(tbl.Content[0].Content) != 1 {
		t.Fatalf("stray continue should remain as a normal cell, got %d cells", len(tbl.Content[0].Content))
	}
	cell := tbl.Content[0].Content[0]
	if _, has := cell.Attrs["rowspan"]; has {
		t.Errorf("stray continue should not gain rowspan, got %+v", cell.Attrs)
	}
}

// TestRowspan_RoundTrip emits a small PM table with rowspan=2 on the
// first cell, parses the resulting docx back, and verifies the rowspan
// survives. This is the export+import contract for vertical merges.
func TestRowspan_RoundTrip(t *testing.T) {
	pmJSON := []byte(`{
		"type": "doc",
		"content": [
			{
				"type": "table",
				"content": [
					{
						"type": "tableRow",
						"content": [
							{"type": "tableCell", "attrs": {"rowspan": 2, "colwidth": [120]}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "spanned"}]}]},
							{"type": "tableCell", "attrs": {"colwidth": [120]}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "r0c1"}]}]}
						]
					},
					{
						"type": "tableRow",
						"content": [
							{"type": "tableCell", "attrs": {"colwidth": [120]}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "r1c1"}]}]}
						]
					}
				]
			}
		]
	}`)

	docxBytes, err := PMJSONToDocx(pmJSON)
	if err != nil {
		t.Fatalf("PMJSONToDocx: %v", err)
	}

	// Spot-check the emitted XML: vMerge "restart" should appear on
	// row 0 col 0 and a continue on row 1 col 0. .docx is a zip;
	// extract word/document.xml first.
	xmlBytes := extractDocumentXML(t, docxBytes)
	if !bytes.Contains(xmlBytes, []byte(`<w:vMerge w:val="restart"`)) {
		t.Logf("word/document.xml:\n%s", xmlBytes)
		t.Errorf("expected <w:vMerge w:val=\"restart\" in emitted docx")
	}

	pm2JSON, _, err := DocxToPMJSON(docxBytes)
	if err != nil {
		t.Fatalf("DocxToPMJSON: %v", err)
	}

	var doc PMNode
	if err := json.Unmarshal(pm2JSON, &doc); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// Locate the table → first row → first cell.
	if len(doc.Content) == 0 || doc.Content[0].Type != NodeTypeTable {
		t.Fatalf("expected top-level table, got %+v", doc.Content)
	}
	table := doc.Content[0]
	if len(table.Content) < 2 {
		t.Fatalf("expected 2 rows in round-tripped table, got %d", len(table.Content))
	}
	startCell := table.Content[0].Content[0]
	rs, ok := startCell.Attrs["rowspan"]
	if !ok {
		dump, _ := json.MarshalIndent(table, "", "  ")
		t.Fatalf("first cell lost rowspan on round-trip:\n%s", dump)
	}
	if asIntForPad(rs) != 2 {
		t.Errorf("expected rowspan=2 after round-trip, got %v", rs)
	}
	// Row 1 should have only one cell (the continue was consolidated).
	if got := len(table.Content[1].Content); got != 1 {
		dump, _ := json.MarshalIndent(table.Content[1], "", "  ")
		t.Errorf("row 1 should have 1 cell after consolidation, got %d:\n%s", got, dump)
	}
}

// TestRowspan_MixedWithColspan covers the export's two-pass merge logic
// when a cell has both rowspan>1 and a separate colspan>1 cell in the
// same table. The vertical merge runs first; the horizontal merge then
// runs right-to-left without interfering.
func TestRowspan_MixedWithColspan(t *testing.T) {
	pmJSON := []byte(`{
		"type": "doc",
		"content": [
			{
				"type": "table",
				"content": [
					{
						"type": "tableRow",
						"content": [
							{"type": "tableCell", "attrs": {"rowspan": 2, "colwidth": [120]}, "content": [{"type": "paragraph"}]},
							{"type": "tableCell", "attrs": {"colspan": 2, "colwidth": [120, 120]}, "content": [{"type": "paragraph"}]}
						]
					},
					{
						"type": "tableRow",
						"content": [
							{"type": "tableCell", "attrs": {"colwidth": [120]}, "content": [{"type": "paragraph"}]},
							{"type": "tableCell", "attrs": {"colwidth": [120]}, "content": [{"type": "paragraph"}]}
						]
					}
				]
			}
		]
	}`)

	docxBytes, err := PMJSONToDocx(pmJSON)
	if err != nil {
		t.Fatalf("PMJSONToDocx: %v", err)
	}

	xmlBytes := extractDocumentXML(t, docxBytes)
	docxStr := string(xmlBytes)
	if !strings.Contains(docxStr, `<w:vMerge w:val="restart"`) {
		t.Errorf("expected vMerge restart in emitted docx")
	}
	if !strings.Contains(docxStr, `<w:gridSpan w:val="2"`) {
		t.Errorf("expected gridSpan=2 in emitted docx")
	}

	pm2JSON, _, err := DocxToPMJSON(docxBytes)
	if err != nil {
		t.Fatalf("DocxToPMJSON: %v", err)
	}
	var doc PMNode
	if err := json.Unmarshal(pm2JSON, &doc); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	table := doc.Content[0]
	r0c0 := table.Content[0].Content[0]
	if rs := asIntForPad(r0c0.Attrs["rowspan"]); rs != 2 {
		t.Errorf("r0c0 rowspan: want 2, got %v", r0c0.Attrs["rowspan"])
	}
	r0c1 := table.Content[0].Content[1]
	if cs := asIntForPad(r0c1.Attrs["colspan"]); cs != 2 {
		t.Errorf("r0c1 colspan: want 2, got %v", r0c1.Attrs["colspan"])
	}
}
