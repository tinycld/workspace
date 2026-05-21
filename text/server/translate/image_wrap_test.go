package translate

import (
	"encoding/json"
	"testing"
)

// TestPMJSONToDocx_ImageWrapRoundTrip exercises the full DOCX round-trip
// for every legal wrap mode. We build a PM doc carrying one image with
// the wrap attr under test, run it through the emitter, parse the
// resulting .docx back, and assert the parsed image's wrap attr matches
// the input. The nil case (absent wrap) checks that an inline image
// stays attribute-free across the round-trip — a regression here would
// mean every existing inline-image fixture starts emitting a spurious
// wrap=… on save.
//
// Companion to TestResolveWrap (which locks in the parser's mapping in
// isolation) and TestPMJSONToDocx_ImageDimensionsRoundTrip (which
// covers width/height). Together the three guarantee the four image
// axes — src, wrap, width, height — survive an OOXML round-trip.
func TestPMJSONToDocx_ImageWrapRoundTrip(t *testing.T) {
	pngBytes := makePNGBytes(t)
	src := "data:image/png;base64," + base64EncodeBytes(pngBytes)

	cases := []struct {
		name      string
		wrap      any // nil for "no wrap attr", or a string literal
		wantWrap  string
		wantNoKey bool
	}{
		{name: "no wrap attr stays inline", wrap: nil, wantNoKey: true},
		{name: "wrap=left round-trips", wrap: "left", wantWrap: "left"},
		{name: "wrap=right round-trips", wrap: "right", wantWrap: "right"},
		{name: "wrap=break round-trips", wrap: "break", wantWrap: "break"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			attrs := map[string]any{"src": src}
			if c.wrap != nil {
				attrs["wrap"] = c.wrap
			}
			original := PMNode{
				Type: NodeTypeDoc,
				Content: []PMNode{
					{Type: NodeTypeImage, Attrs: attrs},
				},
			}
			originalJSON, err := json.Marshal(original)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}

			docxBytes, err := PMJSONToDocx(originalJSON)
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
				t.Fatalf("unmarshal: %v", err)
			}
			img := findFirstImageNode(&parsed)
			if img == nil {
				t.Fatalf("no image node in round-tripped doc: %+v", parsed)
			}
			got, has := img.Attrs["wrap"].(string)
			if c.wantNoKey {
				if has {
					t.Errorf("expected no wrap attr, got %q", got)
				}
				return
			}
			if !has {
				t.Errorf("expected wrap=%q, got no wrap attr (attrs=%+v)", c.wantWrap, img.Attrs)
				return
			}
			if got != c.wantWrap {
				t.Errorf("wrap mismatch: got %q, want %q", got, c.wantWrap)
			}
		})
	}
}
