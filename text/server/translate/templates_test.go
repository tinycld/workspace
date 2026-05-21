package translate

import (
	"os"
	"path/filepath"
	"testing"
)

// TestShippedTemplatesRoundTrip parses every committed template .docx
// back through DocxToPMJSON and verifies it produces zero warnings.
// The templates ship to every user as the starting point for a new
// document — a regression here (e.g. the generator emits an unknown
// node type, or someone edits the binaries by hand) would manifest as
// a warning banner on every fresh document. Failing this test forces a
// generator fix instead.
func TestShippedTemplatesRoundTrip(t *testing.T) {
	assetsDir := filepath.Join("..", "..", "tinycld", "text", "assets", "templates")
	expectedIDs := []string{"blank", "letter", "resume", "report"}
	for _, id := range expectedIDs {
		id := id
		t.Run(id, func(t *testing.T) {
			path := filepath.Join(assetsDir, id+".docx")
			bytes, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("read %s: %v", path, err)
			}
			pmJSON, warnings, err := DocxToPMJSON(bytes)
			if err != nil {
				t.Fatalf("parse %s: %v", id, err)
			}
			if len(warnings) > 0 {
				t.Errorf("template %s produced warnings on parse: %+v", id, warnings)
			}
			if len(pmJSON) == 0 {
				t.Errorf("template %s produced empty PM JSON", id)
			}
		})
	}
}
