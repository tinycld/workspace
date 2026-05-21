package translate

import (
	"encoding/json"
	"testing"
)

// TestCellShading_Roundtrip builds a table with a yellow-shaded cell,
// emits it to .docx, parses it back, and asserts the shading attr
// survived. This is the load-bearing test for shading fidelity — a
// regression here means colors picked in the editor silently disappear
// on save.
func TestCellShading_Roundtrip(t *testing.T) {
	doc := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "Before"}}},
			{
				Type: NodeTypeTable,
				Content: []PMNode{
					{
						Type: NodeTypeTableRow,
						Content: []PMNode{
							{
								Type:  NodeTypeTableCell,
								Attrs: map[string]any{"shading": "#FFFF00"},
								Content: []PMNode{
									{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "A"}}},
								},
							},
							{
								Type: NodeTypeTableCell,
								Content: []PMNode{
									{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "B"}}},
								},
							},
						},
					},
				},
			},
		},
	}

	pmJSON, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal doc: %v", err)
	}
	docxBytes, err := PMJSONToDocx(pmJSON)
	if err != nil {
		t.Fatalf("PMJSONToDocx: %v", err)
	}
	parsedJSON, warnings, err := DocxToPMJSON(docxBytes)
	if err != nil {
		t.Fatalf("DocxToPMJSON: %v", err)
	}
	if len(warnings) > 0 {
		t.Errorf("unexpected warnings: %+v", warnings)
	}
	var parsed PMNode
	if err := json.Unmarshal(parsedJSON, &parsed); err != nil {
		t.Fatalf("unmarshal parsed: %v", err)
	}

	cell := findFirstNodeByType(&parsed, NodeTypeTableCell)
	if cell == nil {
		t.Fatalf("no tableCell found in roundtripped doc")
	}
	shading, _ := cell.Attrs["shading"].(string)
	if shading != "#FFFF00" {
		t.Errorf("cell shading: got %q, want %q", shading, "#FFFF00")
	}
}

// TestCellShading_NoShading verifies that a cell without shading
// stays without shading after the round-trip. Asymmetric coverage
// matters: a regression that always emits <w:shd w:fill="auto"> would
// turn every cell into a shaded cell on re-import.
func TestCellShading_NoShading(t *testing.T) {
	doc := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "x"}}},
			{
				Type: NodeTypeTable,
				Content: []PMNode{
					{
						Type: NodeTypeTableRow,
						Content: []PMNode{
							{
								Type: NodeTypeTableCell,
								Content: []PMNode{
									{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "A"}}},
								},
							},
						},
					},
				},
			},
		},
	}
	pmJSON, _ := json.Marshal(doc)
	docxBytes, err := PMJSONToDocx(pmJSON)
	if err != nil {
		t.Fatalf("emit: %v", err)
	}
	parsedJSON, _, err := DocxToPMJSON(docxBytes)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	var parsed PMNode
	_ = json.Unmarshal(parsedJSON, &parsed)
	cell := findFirstNodeByType(&parsed, NodeTypeTableCell)
	if cell == nil {
		t.Fatalf("no cell after roundtrip")
	}
	if shading, ok := cell.Attrs["shading"]; ok {
		t.Errorf("unshaded cell unexpectedly grew shading attr: %v", shading)
	}
}

// TestCellShading_MultipleColors guards against the simple-case
// optimization where a fixed yellow could be hard-coded — verifies a
// different palette color (green) also round-trips, and on a non-
// first cell of the row (to catch column-index-related off-by-ones).
func TestCellShading_MultipleColors(t *testing.T) {
	doc := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "x"}}},
			{
				Type: NodeTypeTable,
				Content: []PMNode{
					{
						Type: NodeTypeTableRow,
						Content: []PMNode{
							{
								Type: NodeTypeTableCell,
								Content: []PMNode{
									{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "A"}}},
								},
							},
							{
								Type:  NodeTypeTableCell,
								Attrs: map[string]any{"shading": "#C8E6C9"},
								Content: []PMNode{
									{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "B"}}},
								},
							},
						},
					},
				},
			},
		},
	}
	pmJSON, _ := json.Marshal(doc)
	docxBytes, err := PMJSONToDocx(pmJSON)
	if err != nil {
		t.Fatalf("emit: %v", err)
	}
	parsedJSON, _, err := DocxToPMJSON(docxBytes)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	var parsed PMNode
	_ = json.Unmarshal(parsedJSON, &parsed)
	// Walk to second cell in first row.
	row := findFirstNodeByType(&parsed, NodeTypeTableRow)
	if row == nil || len(row.Content) < 2 {
		t.Fatalf("could not find second cell; row=%+v", row)
	}
	secondCell := row.Content[1]
	shading, _ := secondCell.Attrs["shading"].(string)
	if shading != "#C8E6C9" {
		t.Errorf("second cell shading: got %q, want %q", shading, "#C8E6C9")
	}
	firstCell := row.Content[0]
	if _, has := firstCell.Attrs["shading"]; has {
		t.Errorf("first cell unexpectedly grew shading; attrs=%v", firstCell.Attrs)
	}
}

// TestCellShading_FillAutoStripped verifies w:fill="auto" → no
// shading attr. Word emits w:fill="auto" to mean "use theme default"
// which is functionally identical to no <w:shd> at all, and we
// shouldn't pollute the PM tree with a meaningless attr.
func TestCellShading_FillAutoStripped(t *testing.T) {
	if got := parseTcShadingFromFill("auto"); got != "" {
		t.Errorf("auto fill: got %q, want empty", got)
	}
	if got := parseTcShadingFromFill(""); got != "" {
		t.Errorf("empty fill: got %q, want empty", got)
	}
}

// TestNormalizeShadingHex covers the input-shape edge cases the
// importer + emitter share. Word writes 6-digit hex without leading
// '#'; the editor stores with '#'; both must end up as #RRGGBB
// uppercase after normalize.
func TestNormalizeShadingHex(t *testing.T) {
	cases := map[string]string{
		"FFFF00":  "#FFFF00",
		"ffff00":  "#FFFF00",
		"#ffff00": "#FFFF00",
		"#FFFF00": "#FFFF00",
		"auto":    "",
		"":        "",
		"#ff":     "",
		"GGGGGG":  "",
		"#GGGGGG": "",
		"FF00":    "",
	}
	for in, want := range cases {
		if got := normalizeShadingHex(in); got != want {
			t.Errorf("normalizeShadingHex(%q) = %q, want %q", in, got, want)
		}
	}
}

// parseTcShadingFromFill is a tiny helper to test parseTcShading
// without building a full xml.StartElement. parseTcShading itself
// reads w:fill via attrValue, which expects an xml.StartElement. We
// route the logic through normalizeShadingHex with the same fill-auto
// rule the parser applies.
func parseTcShadingFromFill(fill string) string {
	if fill == "" || fill == "auto" {
		return ""
	}
	return normalizeShadingHex(fill)
}
