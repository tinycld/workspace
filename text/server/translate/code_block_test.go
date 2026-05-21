package translate

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

// TestPMJSONToDocx_InlineCodeRoundTrip exercises the inline code mark
// — a paragraph with a mid-sentence code span survives the
// PM -> DOCX -> PM trip with the mark intact on the same text run.
func TestPMJSONToDocx_InlineCodeRoundTrip(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{
				Type: NodeTypeParagraph,
				Content: []PMNode{
					{Type: NodeTypeText, Text: "Run "},
					{Type: NodeTypeText, Text: "go test", Marks: []PMMark{{Type: MarkTypeCode}}},
					{Type: NodeTypeText, Text: " to verify."},
				},
			},
		},
	}

	parsed := mustRoundtripParagraph(t, original)
	if len(parsed.Content) != 1 {
		t.Fatalf("expected 1 block, got %d", len(parsed.Content))
	}
	para := parsed.Content[0]
	if para.Type != NodeTypeParagraph {
		t.Fatalf("expected paragraph, got %q", para.Type)
	}

	var codeFound bool
	var codeText string
	for _, run := range para.Content {
		if run.Type != NodeTypeText {
			continue
		}
		for _, m := range run.Marks {
			if m.Type == MarkTypeCode {
				codeFound = true
				codeText = run.Text
			}
		}
	}
	if !codeFound {
		t.Fatalf("inline code mark missing after round-trip; got runs: %+v", para.Content)
	}
	if codeText != "go test" {
		t.Errorf("code-marked text mismatch: got %q want %q", codeText, "go test")
	}
}

// TestPMJSONToDocx_CodeBlockRoundTrip checks that a codeBlock node
// emits a paragraph with pStyle="CodeBlock" and that the import side
// recognises that style and rebuilds the codeBlock node.
func TestPMJSONToDocx_CodeBlockRoundTrip(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{
				Type: NodeTypeCodeBlock,
				Content: []PMNode{
					{Type: NodeTypeText, Text: "fmt.Println(\"hello\")"},
				},
			},
		},
	}

	parsed := mustRoundtripParagraph(t, original)
	if len(parsed.Content) != 1 {
		t.Fatalf("expected 1 block, got %d", len(parsed.Content))
	}
	cb := parsed.Content[0]
	if cb.Type != NodeTypeCodeBlock {
		t.Fatalf("expected codeBlock, got %q", cb.Type)
	}
	if len(cb.Content) != 1 || cb.Content[0].Type != NodeTypeText {
		t.Fatalf("codeBlock should contain one text child; got %+v", cb.Content)
	}
	if cb.Content[0].Text != "fmt.Println(\"hello\")" {
		t.Errorf("code text mismatch: got %q want %q",
			cb.Content[0].Text, "fmt.Println(\"hello\")")
	}
}

// TestPMJSONToDocx_CodeBlockThenParagraph proves consecutive blocks
// of different types are preserved as siblings — a code block
// followed by a normal paragraph should NOT be merged.
func TestPMJSONToDocx_CodeBlockThenParagraph(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{
				Type: NodeTypeCodeBlock,
				Content: []PMNode{
					{Type: NodeTypeText, Text: "pkg main"},
				},
			},
			{
				Type: NodeTypeParagraph,
				Content: []PMNode{
					{Type: NodeTypeText, Text: "Some prose."},
				},
			},
		},
	}

	parsed := mustRoundtripParagraph(t, original)
	if len(parsed.Content) != 2 {
		t.Fatalf("expected 2 blocks, got %d: %+v", len(parsed.Content), parsed.Content)
	}
	if parsed.Content[0].Type != NodeTypeCodeBlock {
		t.Errorf("first block should be codeBlock, got %q", parsed.Content[0].Type)
	}
	if parsed.Content[1].Type != NodeTypeParagraph {
		t.Errorf("second block should be paragraph, got %q", parsed.Content[1].Type)
	}
}

// TestPMJSONToDocx_CodeBlockEmpty verifies an empty codeBlock survives
// the round trip without crashing. The output codeBlock has no text
// children (or an empty content slice) — both are valid encodings.
func TestPMJSONToDocx_CodeBlockEmpty(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{Type: NodeTypeCodeBlock},
		},
	}

	parsed := mustRoundtripParagraph(t, original)
	if len(parsed.Content) != 1 {
		t.Fatalf("expected 1 block, got %d", len(parsed.Content))
	}
	if parsed.Content[0].Type != NodeTypeCodeBlock {
		t.Errorf("expected codeBlock, got %q", parsed.Content[0].Type)
	}
}

// TestPMJSONToDocx_CodeBlockOOXMLShape sanity-checks that the emitted
// document.xml carries the canonical "CodeBlock" pStyle string — so
// any Word feature keyed off the style name (custom rendering, search,
// etc.) sees the expected value.
func TestPMJSONToDocx_CodeBlockOOXMLShape(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{
				Type: NodeTypeCodeBlock,
				Content: []PMNode{
					{Type: NodeTypeText, Text: "x := 1"},
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
	docXML := string(extractDocumentXML(t, docxBytes))
	if !strings.Contains(docXML, `<w:pStyle w:val="CodeBlock"`) {
		t.Errorf(`emitted document.xml missing <w:pStyle w:val="CodeBlock"/>; full xml:\n%s`, docXML)
	}
}

// TestPMJSONToDocx_InlineCodeOOXMLShape verifies the post-process pass
// successfully injects the VerbatimChar character style onto a
// code-marked run. Without this, Word would render the run without
// any styling — the round-trip importer would still recover the mark
// from the absent rStyle, so the test catches a silent emit
// regression that visual round-trip checks would miss.
func TestPMJSONToDocx_InlineCodeOOXMLShape(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{
				Type: NodeTypeParagraph,
				Content: []PMNode{
					{Type: NodeTypeText, Text: "tag ", Marks: nil},
					{Type: NodeTypeText, Text: "verbatim", Marks: []PMMark{{Type: MarkTypeCode}}},
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
	docXML := string(extractDocumentXML(t, docxBytes))
	if !strings.Contains(docXML, `<w:rStyle w:val="VerbatimChar"/>`) {
		t.Errorf("emitted document.xml missing VerbatimChar rStyle injection; xml:\n%s", docXML)
	}
	// The marker text must NOT survive into the final document.
	if strings.Contains(docXML, "__pmcd:") {
		t.Errorf("code-mark marker token leaked into final document.xml:\n%s", docXML)
	}
}

// TestPMJSONToDocx_InlineCodeWithBoldRoundTrip exercises the
// "extend existing <w:rPr>" branch of injectVerbatimChar — when the
// code-marked run already carries another mark (bold), WordZero emits
// <w:rPr><w:b ...></w:rPr>. The post-process pass must inject
// <w:rStyle w:val="VerbatimChar"/> INSIDE that existing block, not
// synthesise a second sibling <w:rPr> (which would be invalid OOXML).
// The earlier "code alone" test only covered the "no rPr at all"
// branch.
func TestPMJSONToDocx_InlineCodeWithBoldRoundTrip(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{
				Type: NodeTypeParagraph,
				Content: []PMNode{
					{
						Type: NodeTypeText,
						Text: "boldverbatim",
						Marks: []PMMark{
							{Type: MarkTypeBold},
							{Type: MarkTypeCode},
						},
					},
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
	docXML := string(extractDocumentXML(t, docxBytes))

	// Exactly one rStyle injection per code-marked run.
	if got := strings.Count(docXML, `<w:rStyle w:val="VerbatimChar"/>`); got != 1 {
		t.Errorf("want 1 VerbatimChar rStyle injection, got %d; xml:\n%s", got, docXML)
	}
	// No leftover marker tokens.
	if strings.Contains(docXML, "__pmcd:") {
		t.Errorf("code-mark marker token leaked into final document.xml:\n%s", docXML)
	}
	// Round-trip preserves both marks.
	pmJSON, _, err := DocxToPMJSON(docxBytes)
	if err != nil {
		t.Fatalf("DocxToPMJSON: %v", err)
	}
	var round PMNode
	if err := json.Unmarshal(pmJSON, &round); err != nil {
		t.Fatalf("unmarshal round-trip: %v", err)
	}
	if len(round.Content) == 0 || len(round.Content[0].Content) == 0 {
		t.Fatalf("round-trip produced empty doc:\n%s", pmJSON)
	}
	marks := round.Content[0].Content[0].Marks
	var hasBold, hasCode bool
	for _, m := range marks {
		if m.Type == MarkTypeBold {
			hasBold = true
		}
		if m.Type == MarkTypeCode {
			hasCode = true
		}
	}
	if !hasBold || !hasCode {
		t.Errorf("round-trip lost a mark: bold=%v code=%v; marks=%v", hasBold, hasCode, marks)
	}
}

// TestDocxToPM_CodeBlockStyleAliases proves the importer accepts the
// non-canonical pStyle names ("Code", "HTMLPreformatted",
// "Preformatted") and normalizes them all to NodeTypeCodeBlock.
// Constructs a minimal document.xml directly rather than going through
// our emitter — the emitter only writes "CodeBlock", so we have to
// hand-author the input to exercise the alias branches.
func TestDocxToPM_CodeBlockStyleAliases(t *testing.T) {
	cases := []string{"Code", "HTMLPreformatted", "Preformatted"}
	for _, style := range cases {
		t.Run(style, func(t *testing.T) {
			docxBytes := mustBuildMinimalDocxWithStyledParagraph(t, style, "import os")
			pmJSON, _, err := DocxToPMJSON(docxBytes)
			if err != nil {
				t.Fatalf("DocxToPMJSON: %v", err)
			}
			var root PMNode
			if err := json.Unmarshal(pmJSON, &root); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if len(root.Content) != 1 {
				t.Fatalf("expected 1 block, got %d", len(root.Content))
			}
			if root.Content[0].Type != NodeTypeCodeBlock {
				t.Errorf("alias %q should map to codeBlock, got %q",
					style, root.Content[0].Type)
			}
		})
	}
}

// mustBuildMinimalDocxWithStyledParagraph builds the minimum file set
// our DocxToPMJSON parser needs (a [Content_Types].xml, the root rels,
// and a one-paragraph word/document.xml carrying the requested
// pStyle), zips them up, and returns the bytes. Used to exercise
// import paths that our own emitter never generates (e.g. the
// non-canonical "Code" / "HTMLPreformatted" / "Preformatted"
// pStyle aliases for code blocks).
func mustBuildMinimalDocxWithStyledParagraph(t *testing.T, pStyle, text string) []byte {
	t.Helper()
	docXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
		`<w:body>` +
		`<w:p><w:pPr><w:pStyle w:val="` + pStyle + `"/></w:pPr>` +
		`<w:r><w:t xml:space="preserve">` + text + `</w:t></w:r></w:p>` +
		`</w:body></w:document>`
	contentTypes := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
		`<Default Extension="xml" ContentType="application/xml"/>` +
		`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
		`<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
		`</Types>`
	rootRels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
		`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
		`</Relationships>`
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	files := []struct{ name, body string }{
		{"[Content_Types].xml", contentTypes},
		{"_rels/.rels", rootRels},
		{"word/document.xml", docXML},
	}
	for _, f := range files {
		w, err := zw.Create(f.name)
		if err != nil {
			t.Fatalf("zip create %q: %v", f.name, err)
		}
		if _, err := w.Write([]byte(f.body)); err != nil {
			t.Fatalf("zip write %q: %v", f.name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

// TestIsCodeBlockStyle is a tiny unit test for the alias predicate.
// Asserts every accepted name returns true and a few non-matches
// return false so future additions can't accidentally widen the set.
func TestIsCodeBlockStyle(t *testing.T) {
	for _, ok := range []string{"CodeBlock", "Code", "HTMLPreformatted", "Preformatted"} {
		if !isCodeBlockStyle(ok) {
			t.Errorf("expected %q to be recognised as a code-block style", ok)
		}
	}
	for _, no := range []string{"", "Normal", "Quote", "Heading1", "ListParagraph", "codeblock"} {
		if isCodeBlockStyle(no) {
			t.Errorf("expected %q NOT to be recognised as a code-block style", no)
		}
	}
}
