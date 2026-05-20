package textextract

import (
	"strings"
	"testing"
)

func TestTextExtractor(t *testing.T) {
	input := "Hello, world! This is plain text."
	result, err := Extract(strings.NewReader(input), "text/plain", MaxOutputBytes)
	if err != nil {
		t.Fatal(err)
	}
	if result != input {
		t.Errorf("expected %q, got %q", input, result)
	}
}

func TestTextExtractorLimit(t *testing.T) {
	input := strings.Repeat("a", 100)
	result, err := Extract(strings.NewReader(input), "text/plain", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(result) > 10 {
		t.Errorf("expected length <= 10, got %d", len(result))
	}
}

func TestHTMLExtractor(t *testing.T) {
	input := `<html><body><p>Hello &amp; <b>world</b></p></body></html>`
	result, err := Extract(strings.NewReader(input), "text/html", MaxOutputBytes)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result, "Hello & world") {
		t.Errorf("expected HTML stripped text, got %q", result)
	}
}

func TestHTMLExtractorCharset(t *testing.T) {
	input := `<p>test</p>`
	result, err := Extract(strings.NewReader(input), "text/html; charset=utf-8", MaxOutputBytes)
	if err != nil {
		t.Fatal(err)
	}
	if result != "test" {
		t.Errorf("expected %q, got %q", "test", result)
	}
}

func TestRTFExtractor(t *testing.T) {
	input := `{\rtf1\ansi Hello {\b world}!}`
	result, err := Extract(strings.NewReader(input), "application/rtf", MaxOutputBytes)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result, "Hello") || !strings.Contains(result, "world") {
		t.Errorf("expected RTF stripped text, got %q", result)
	}
}

func TestTextFallthrough(t *testing.T) {
	input := "body { color: red; }"
	result, err := Extract(strings.NewReader(input), "text/css", MaxOutputBytes)
	if err != nil {
		t.Fatal(err)
	}
	if result != input {
		t.Errorf("expected text/css fallback, got %q", result)
	}
}

func TestUnsupportedType(t *testing.T) {
	result, err := Extract(strings.NewReader("binary"), "application/octet-stream", MaxOutputBytes)
	if err != nil {
		t.Fatal(err)
	}
	if result != "" {
		t.Errorf("expected empty string for unsupported type, got %q", result)
	}
}

func TestEmptyInput(t *testing.T) {
	result, err := Extract(strings.NewReader(""), "text/plain", MaxOutputBytes)
	if err != nil {
		t.Fatal(err)
	}
	if result != "" {
		t.Errorf("expected empty string, got %q", result)
	}
}
