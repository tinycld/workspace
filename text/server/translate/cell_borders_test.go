package translate

import (
	"encoding/json"
	"testing"
)

// TestCellBorders_Roundtrip builds a 2×2 table where one cell has a
// red top border and a thick dashed bottom border, emits it to .docx,
// parses it back, and checks that the same border attrs survived. This
// is the load-bearing test for borders fidelity — any regression here
// means borders edited in the UI silently disappear on save.
func TestCellBorders_Roundtrip(t *testing.T) {
	// Build a minimal doc: a paragraph + a 2x2 table where (0,0) has
	// distinctive borders.
	originalAttrs := map[string]any{
		"top":    map[string]any{"style": "solid", "widthPx": 2, "color": "#FF0000"},
		"right":  nil,
		"bottom": map[string]any{"style": "dashed", "widthPx": 3, "color": nil},
		"left":   nil,
	}
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
								Attrs: map[string]any{"borders": originalAttrs},
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
					{
						Type: NodeTypeTableRow,
						Content: []PMNode{
							{
								Type: NodeTypeTableCell,
								Content: []PMNode{
									{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "C"}}},
								},
							},
							{
								Type: NodeTypeTableCell,
								Content: []PMNode{
									{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "D"}}},
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

	// Walk to the first table cell.
	cell := findFirstNodeByType(&parsed, NodeTypeTableCell)
	if cell == nil {
		t.Fatalf("no tableCell found in roundtripped doc")
	}
	rawBorders, ok := cell.Attrs["borders"].(map[string]any)
	if !ok {
		t.Fatalf("first cell missing borders attr after roundtrip; attrs=%v", cell.Attrs)
	}

	// Top: red 2px solid → at minimum survives with style=solid + a non-empty color.
	top, _ := rawBorders["top"].(map[string]any)
	if top == nil {
		t.Fatalf("top border missing after roundtrip: %v", rawBorders)
	}
	if top["style"] != "solid" {
		t.Errorf("top style: got %q, want solid", top["style"])
	}
	if c, _ := top["color"].(string); c != "#FF0000" {
		t.Errorf("top color: got %q, want #FF0000", c)
	}

	// Bottom: dashed
	bot, _ := rawBorders["bottom"].(map[string]any)
	if bot == nil {
		t.Fatalf("bottom border missing after roundtrip: %v", rawBorders)
	}
	if bot["style"] != "dashed" {
		t.Errorf("bottom style: got %q, want dashed", bot["style"])
	}
}

// TestCellBorders_NoneStyle verifies that an explicit "none" border on
// one edge survives the docx roundtrip and isn't replaced by the
// default solid border on re-import.
func TestCellBorders_NoneStyle(t *testing.T) {
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
								Attrs: map[string]any{
									"borders": map[string]any{
										"top":    map[string]any{"style": "none", "widthPx": 0},
										"right":  nil,
										"bottom": nil,
										"left":   nil,
									},
								},
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
	borders, _ := cell.Attrs["borders"].(map[string]any)
	if borders == nil {
		t.Fatalf("borders missing; want top=none preserved. attrs=%v", cell.Attrs)
	}
	top, _ := borders["top"].(map[string]any)
	if top == nil || top["style"] != "none" {
		t.Errorf("expected top=none survived roundtrip, got %v", top)
	}
}

func findFirstNodeByType(root *PMNode, t string) *PMNode {
	if root == nil {
		return nil
	}
	if root.Type == t {
		return root
	}
	for i := range root.Content {
		if found := findFirstNodeByType(&root.Content[i], t); found != nil {
			return found
		}
	}
	return nil
}
