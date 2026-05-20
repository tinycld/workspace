package textextract

import (
	"io"
	"mime"
	"strings"
)

// MaxOutputBytes is the default maximum size of extracted text output.
const MaxOutputBytes = 50 * 1024

// Extractor extracts plain text from a specific file format.
type Extractor interface {
	Extract(r io.Reader, limit int) (string, error)
}

var registry = make(map[string]Extractor)

// Register associates a MIME type with an Extractor. Called from handler init() functions.
func Register(mimeType string, e Extractor) {
	registry[mimeType] = e
}

// Extract dispatches to the registered handler for the given MIME type.
// Falls back to plain-text passthrough for any text/* type without a specific handler.
// Returns ("", nil) for unsupported or corrupt files.
func Extract(r io.Reader, mimeType string, maxBytes int) (string, error) {
	if maxBytes <= 0 {
		maxBytes = MaxOutputBytes
	}

	// Normalize: strip parameters (e.g. "text/html; charset=utf-8" → "text/html")
	mt, _, _ := mime.ParseMediaType(mimeType)
	if mt == "" {
		mt = mimeType
	}
	mt = strings.ToLower(strings.TrimSpace(mt))

	if e, ok := registry[mt]; ok {
		return e.Extract(r, maxBytes)
	}

	// Fallback: any text/* type gets plain-text extraction
	if strings.HasPrefix(mt, "text/") {
		return (&textExtractor{}).Extract(r, maxBytes)
	}

	return "", nil
}
