package translate

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"testing"
)

// makePNGBytes returns a PNG-encoded 4×4 magenta square. We need real
// PNG bytes (not a stub) because WordZero's image pipeline detects the
// format from the header and the docx validators reject malformed
// media parts. The dimensions of the source PNG are irrelevant — we're
// driving display size off the width/height args, not the bytes.
func makePNGBytes(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	for x := 0; x < 4; x++ {
		for y := 0; y < 4; y++ {
			img.Set(x, y, color.RGBA{R: 255, B: 255, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	return buf.Bytes()
}

// TestEmusToPixels covers the EMU->px conversion at the boundaries
// the round-trip cares about. 9525 EMU = 1 px at 96 DPI.
func TestEmusToPixels(t *testing.T) {
	cases := []struct {
		name string
		in   int
		want int
	}{
		{"zero", 0, 0},
		{"negative", -1, 0},
		{"one pixel", 9525, 1},
		{"three hundred pixels", 300 * 9525, 300},
		{"rounds up at midpoint", 9525*200 + 4763, 201},
		{"rounds down below midpoint", 9525*200 + 4762, 200},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := emusToPixels(c.in)
			if got != c.want {
				t.Errorf("emusToPixels(%d) = %d, want %d", c.in, got, c.want)
			}
		})
	}
}

// TestPMJSONToDocx_ImageDimensionsRoundTrip emits a PM doc carrying an
// image with explicit width=300 height=200, runs it through the docx
// emitter, parses the resulting .docx back, and asserts the PM image
// node still carries width≈300 height≈200. The ±1 px tolerance covers
// integer rounding in the EMU/px conversion. Locks in the persistence
// of the v1 resize feature through OOXML's <wp:extent>.
func TestPMJSONToDocx_ImageDimensionsRoundTrip(t *testing.T) {
	pngBytes := makePNGBytes(t)
	src := "data:image/png;base64," + base64EncodeBytes(pngBytes)

	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{
				Type: NodeTypeImage,
				Attrs: map[string]any{
					"src":    src,
					"width":  float64(300),
					"height": float64(200),
				},
			},
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
		t.Fatalf("unmarshal parsed: %v", err)
	}

	img := findFirstImageNode(&parsed)
	if img == nil {
		t.Fatalf("no image node in round-tripped doc: %+v", parsed)
	}
	gotWidth := intFromAttr(img.Attrs["width"])
	gotHeight := intFromAttr(img.Attrs["height"])
	if !inTolerance(gotWidth, 300, 1) {
		t.Errorf("width: got %d, want ~300 (±1)", gotWidth)
	}
	if !inTolerance(gotHeight, 200, 1) {
		t.Errorf("height: got %d, want ~200 (±1)", gotHeight)
	}
}

// TestPMJSONToDocx_ImageWithoutDimensions verifies that an image with
// no width/height attrs round-trips without picking up spurious
// dimensions. The emitter passes 0/0 to WordZero, which writes
// <wp:extent cx="0" cy="0"/> (the "auto-from-bytes" sentinel); the
// importer's emusToPixels(0) returns 0, which the !>0 guard in
// parseDrawing filters out, so the PM image node carries no
// width/height attrs.
func TestPMJSONToDocx_ImageWithoutDimensions(t *testing.T) {
	pngBytes := makePNGBytes(t)
	src := "data:image/png;base64," + base64EncodeBytes(pngBytes)

	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{
				Type:  NodeTypeImage,
				Attrs: map[string]any{"src": src},
			},
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
	parsedJSON, _, err := DocxToPMJSON(docxBytes)
	if err != nil {
		t.Fatalf("DocxToPMJSON: %v", err)
	}
	var parsed PMNode
	if err := json.Unmarshal(parsedJSON, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	img := findFirstImageNode(&parsed)
	if img == nil {
		t.Fatalf("no image node: %+v", parsed)
	}
	if _, has := img.Attrs["width"]; has {
		t.Errorf("expected no width attr, got %v", img.Attrs["width"])
	}
	if _, has := img.Attrs["height"]; has {
		t.Errorf("expected no height attr, got %v", img.Attrs["height"])
	}
}

func findFirstImageNode(n *PMNode) *PMNode {
	if n == nil {
		return nil
	}
	if n.Type == NodeTypeImage {
		return n
	}
	for i := range n.Content {
		if img := findFirstImageNode(&n.Content[i]); img != nil {
			return img
		}
	}
	return nil
}

func intFromAttr(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	}
	return 0
}

func inTolerance(got, want, tol int) bool {
	d := got - want
	if d < 0 {
		d = -d
	}
	return d <= tol
}

// base64EncodeBytes wraps encoding/base64 std encoding to keep the
// caller side legible.
func base64EncodeBytes(b []byte) string {
	return base64.StdEncoding.EncodeToString(b)
}
