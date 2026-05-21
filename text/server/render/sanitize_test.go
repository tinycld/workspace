// Sanitizer round-trip tests for the text package's allowlist.
//
// The shared sanitizer in tinycld.org/core/render has its own broad
// test suite; these tests pin down the specific tag / attribute
// passes-through that the text renderer relies on for full-fidelity
// docx → HTML rendering. A future allowlist edit that accidentally
// drops one of these would silently degrade the preview, so we make
// the dependency explicit here.
package render

import (
	"strings"
	"testing"
)

// Table columns from a docx ride on <colgroup> + <col style="width:Npx">.
// The col tag must survive sanitization (it's in the allowlist now)
// and the inline width style must pass through the shared
// safe-style-properties filter.
func TestSanitize_PreservesColgroupAndColWidth(t *testing.T) {
	in := `<table class="tinycld-text-table">` +
		`<colgroup><col style="width: 120px"><col style="width: 200px"></colgroup>` +
		`<tbody><tr class="tinycld-text-tr">` +
		`<td class="tinycld-text-td"><p class="tinycld-text-p">A</p></td>` +
		`<td class="tinycld-text-td"><p class="tinycld-text-p">B</p></td>` +
		`</tr></tbody></table>`
	out, err := Sanitize(in)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if !strings.Contains(out, `<colgroup>`) {
		t.Fatalf("colgroup stripped: %q", out)
	}
	if !strings.Contains(out, `<col style="width: 120px">`) {
		t.Fatalf("first col width stripped: %q", out)
	}
	if !strings.Contains(out, `<col style="width: 200px">`) {
		t.Fatalf("second col width stripped: %q", out)
	}
}

// Ordered-list resumption (Word emits start="6" when a list is
// interrupted by a bullet sub-list and resumes at item 6). The start
// attribute must pass through the per-tag allowlist on <ol>.
func TestSanitize_PreservesOrderedListStart(t *testing.T) {
	in := `<ol class="tinycld-text-ol" start="6">` +
		`<li class="tinycld-text-li"><p class="tinycld-text-p">Columns</p></li>` +
		`</ol>`
	out, err := Sanitize(in)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if !strings.Contains(out, `start="6"`) {
		t.Fatalf("start attribute stripped: %q", out)
	}
}

// start on <ul> is not allowlisted and must be dropped (the sanitizer
// only honors per-tag entries, and we deliberately scoped start to
// <ol>). Defends against a future edit that promotes start to a
// universally allowed attribute.
func TestSanitize_DropsStartOnUnorderedList(t *testing.T) {
	in := `<ul class="tinycld-text-ul" start="3">` +
		`<li class="tinycld-text-li"><p class="tinycld-text-p">x</p></li>` +
		`</ul>`
	out, err := Sanitize(in)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if strings.Contains(out, `start=`) {
		t.Fatalf("start should not appear on ul: %q", out)
	}
}

// Float-paragraph marker class (tinycld-text-p-with-float--left|right)
// is just a class token with the project prefix — it must survive the
// class filter the same way every other tinycld-* class does.
func TestSanitize_PreservesFloatParagraphMarkerClass(t *testing.T) {
	in := `<p class="tinycld-text-p tinycld-text-p-with-float--left">` +
		`<img class="tinycld-text-img tinycld-text-img-wrap--left" src="https://example/a.png">` +
		`text</p>`
	out, err := Sanitize(in)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if !strings.Contains(out, `tinycld-text-p-with-float--left`) {
		t.Fatalf("marker class stripped: %q", out)
	}
}
