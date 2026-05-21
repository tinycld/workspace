package translate

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"
)

// buildImageDocJSON wraps a single image node in a minimal doc so we
// can exercise the emitter's image pipeline end-to-end without dragging
// in surrounding paragraphs.
func buildImageDocJSON(t *testing.T, src string) []byte {
	t.Helper()
	doc := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{Type: NodeTypeImage, Attrs: map[string]any{"src": src}},
		},
	}
	bs, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return bs
}

// makePNGDataURI builds a valid base64 PNG data URI of approximately
// `payloadBytes` decoded length. The actual payload is one tiny PNG
// header followed by zero-padding; we only care about decoded length
// for the size-cap test.
func makePNGDataURI(t *testing.T, payloadBytes int) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	pngBytes := buf.Bytes()
	if len(pngBytes) >= payloadBytes {
		return "data:image/png;base64," + base64.StdEncoding.EncodeToString(pngBytes[:payloadBytes])
	}
	padded := make([]byte, payloadBytes)
	copy(padded, pngBytes)
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(padded)
}

// TestPMJSONToDocx_OversizedImageDropped verifies that an image whose
// decoded payload exceeds MaxImageBytes is skipped and a
// WarningImageTooLarge surfaces from PMJSONToDocxWithWarnings.
func TestPMJSONToDocx_OversizedImageDropped(t *testing.T) {
	src := makePNGDataURI(t, MaxImageBytes+1024)
	pmJSON := buildImageDocJSON(t, src)

	_, warnings, err := PMJSONToDocxWithWarnings(pmJSON)
	if err != nil {
		t.Fatalf("PMJSONToDocxWithWarnings: %v", err)
	}

	if !hasWarning(warnings, WarningImageTooLarge) {
		t.Fatalf("expected WarningImageTooLarge, got warnings=%+v", warnings)
	}
}

// TestPMJSONToDocx_UnsupportedImageTypeDropped verifies that an
// image/svg+xml data URI is skipped with WarningUnsupportedImageType
// rather than failing the whole flush.
func TestPMJSONToDocx_UnsupportedImageTypeDropped(t *testing.T) {
	svg := `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>`
	src := "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(svg))
	pmJSON := buildImageDocJSON(t, src)

	_, warnings, err := PMJSONToDocxWithWarnings(pmJSON)
	if err != nil {
		t.Fatalf("PMJSONToDocxWithWarnings: %v", err)
	}

	if !hasWarning(warnings, WarningUnsupportedImageType) {
		t.Fatalf("expected WarningUnsupportedImageType, got warnings=%+v", warnings)
	}
}

// TestPMJSONToDocx_NormalImageEmbeds confirms the size / MIME gates do
// not regress the happy path: a ~100 KB PNG still embeds, no warnings,
// no error.
func TestPMJSONToDocx_NormalImageEmbeds(t *testing.T) {
	src := makePNGDataURI(t, 100*1024)
	pmJSON := buildImageDocJSON(t, src)

	bs, warnings, err := PMJSONToDocxWithWarnings(pmJSON)
	if err != nil {
		t.Fatalf("PMJSONToDocxWithWarnings: %v", err)
	}
	if len(bs) == 0 {
		t.Fatal("expected non-empty docx bytes")
	}
	if len(warnings) != 0 {
		t.Fatalf("expected no warnings for a normal image, got %+v", warnings)
	}

	// docx is a zip — verify it contains a media/ entry as evidence the
	// image actually landed in the package.
	if !bytes.Contains(bs, []byte("word/media/")) {
		t.Errorf("docx output does not contain a word/media/ image part: %s",
			firstNBytes(bs, 200))
	}
}

func hasWarning(warnings []Warning, code WarningCode) bool {
	for _, w := range warnings {
		if w.Code == code {
			return true
		}
	}
	return false
}

func firstNBytes(b []byte, n int) string {
	if len(b) > n {
		b = b[:n]
	}
	return strings.TrimRight(fmt.Sprintf("%q", b), `"`)
}
