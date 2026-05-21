package translate

import (
	"encoding/json"
	"testing"

	ycrdt "github.com/skyterra/y-crdt"
)

func TestColwidthSurvives(t *testing.T) {
	pmJSON := []byte(`{
		"type": "doc",
		"content": [
			{
				"type": "table",
				"content": [
					{
						"type": "tableRow",
						"content": [
							{"type": "tableCell", "attrs": {"colwidth": [120], "colspan": 1}, "content": [{"type": "paragraph"}]},
							{"type": "tableCell", "attrs": {"colwidth": [255, 254], "colspan": 2}, "content": [{"type": "paragraph"}]}
						]
					}
				]
			}
		]
	}`)

	doc := ycrdt.NewDoc("test-room", false, nil, nil, false)
	if err := SeedFromPMJSON(doc, pmJSON); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Round-trip read it back
	out, err := PMJSONFromYDoc(doc)
	if err != nil {
		t.Fatalf("readback: %v", err)
	}
	t.Logf("roundtrip: %s", string(out))

	// Inspect raw attrs of cell xml elements
	frag, _ := doc.GetXmlFragment("prosemirror").(*ycrdt.YXmlFragment)
	for _, item := range frag.ToArray() {
		el, ok := item.(*ycrdt.YXmlElement)
		if !ok {
			continue
		}
		var walk func(e *ycrdt.YXmlElement, depth int)
		walk = func(e *ycrdt.YXmlElement, depth int) {
			t.Logf("%s%s attrs=%v", spaces(depth), e.NodeName, e.GetAttributes())
			for _, c := range e.ToArray() {
				if child, ok := c.(*ycrdt.YXmlElement); ok {
					walk(child, depth+1)
				}
			}
		}
		walk(el, 0)
	}
	// Also check JSON unmarshal of array values
	var root PMNode
	_ = json.Unmarshal(pmJSON, &root)
	cell := root.Content[0].Content[0].Content[1]
	t.Logf("cell attrs raw: %v", cell.Attrs)
	if cw, ok := cell.Attrs["colwidth"]; ok {
		t.Logf("colwidth type=%T value=%v", cw, cw)
		if arr, ok := cw.([]any); ok {
			for i, v := range arr {
				t.Logf("  [%d] type=%T value=%v", i, v, v)
			}
		}
	}
}

func spaces(n int) string {
	s := ""
	for i := 0; i < n; i++ {
		s += "  "
	}
	return s
}
