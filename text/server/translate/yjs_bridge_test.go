package translate

import (
	"encoding/json"
	"testing"

	ycrdt "github.com/skyterra/y-crdt"
)

// TestYJSBridge_RoundTripSinglePara verifies that a minimal PMNode
// (one paragraph with a text run) survives the YJS round trip:
// PMJSON -> Y.Doc -> PMJSON should produce identical JSON.
func TestYJSBridge_RoundTripSinglePara(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{
				Type: NodeTypeParagraph,
				Content: []PMNode{
					{Type: NodeTypeText, Text: "Hello, world!"},
				},
			},
		},
	}
	originalJSON, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal original: %v", err)
	}

	doc := ycrdt.NewDoc("test-room", false, nil, nil, false)
	if err := SeedFromPMJSON(doc, originalJSON); err != nil {
		t.Fatalf("SeedFromPMJSON: %v", err)
	}

	roundTrippedJSON, err := PMJSONFromYDoc(doc)
	if err != nil {
		t.Fatalf("PMJSONFromYDoc: %v", err)
	}

	// Compare structurally by re-marshalling parsed structs so field
	// ordering / omitempty behavior is normalized on both sides.
	var originalParsed, rtParsed PMNode
	if err := json.Unmarshal(originalJSON, &originalParsed); err != nil {
		t.Fatalf("unmarshal original: %v", err)
	}
	if err := json.Unmarshal(roundTrippedJSON, &rtParsed); err != nil {
		t.Fatalf("unmarshal round-tripped: %v", err)
	}
	originalRe, _ := json.Marshal(originalParsed)
	rtRe, _ := json.Marshal(rtParsed)
	if string(originalRe) != string(rtRe) {
		t.Errorf("round-trip mismatch:\noriginal:    %s\nround-trip:  %s", originalRe, rtRe)
	}
}
