package translate

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
)

// readDocxPart reads one part out of a docx (zip) blob, returning the
// raw bytes of the named file. Returns nil when the part is absent.
func readDocxPart(t *testing.T, docxBytes []byte, name string) []byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(docxBytes), int64(len(docxBytes)))
	if err != nil {
		t.Fatalf("open docx as zip: %v", err)
	}
	for _, f := range zr.File {
		if f.Name != name {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", name, err)
		}
		buf, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		return buf
	}
	return nil
}

// TestPMJSONToDocx_SinglePara generates a docx containing a single
// paragraph with one text run, then checks the output is a non-empty
// .docx and that round-tripping it through DocxToPMJSON recovers the
// original tree.
func TestPMJSONToDocx_SinglePara(t *testing.T) {
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
		t.Fatalf("marshal: %v", err)
	}

	docxBytes, err := PMJSONToDocx(originalJSON)
	if err != nil {
		t.Fatalf("PMJSONToDocx: %v", err)
	}
	if len(docxBytes) < 100 {
		t.Fatalf("docx too small (%d bytes); probably empty", len(docxBytes))
	}

	parsedJSON, _, err := DocxToPMJSON(docxBytes)
	if err != nil {
		t.Fatalf("DocxToPMJSON of our own output: %v", err)
	}
	var parsed PMNode
	if err := json.Unmarshal(parsedJSON, &parsed); err != nil {
		t.Fatalf("unmarshal parsed: %v", err)
	}
	if len(parsed.Content) != 1 || parsed.Content[0].Type != NodeTypeParagraph {
		t.Fatalf("expected one paragraph, got: %+v", parsed)
	}
	paraContent := parsed.Content[0].Content
	if len(paraContent) != 1 || paraContent[0].Type != NodeTypeText {
		t.Fatalf("expected one text node, got: %+v", paraContent)
	}
	if paraContent[0].Text != "Hello, world!" {
		t.Errorf("text mismatch: got %q, want %q", paraContent[0].Text, "Hello, world!")
	}
}

// TestPMJSONToDocx_RichRoundTrip exercises all v1 features (marks,
// headings, lists, blockquote, table, hyperlink) in a single doc and
// verifies the round-trip preserves the structural identity.
func TestPMJSONToDocx_RichRoundTrip(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{
				Type:  NodeTypeHeading,
				Attrs: map[string]any{"level": float64(1)},
				Content: []PMNode{
					{Type: NodeTypeText, Text: "Title"},
				},
			},
			{
				Type: NodeTypeParagraph,
				Content: []PMNode{
					{Type: NodeTypeText, Text: "Plain "},
					{Type: NodeTypeText, Text: "bold", Marks: []PMMark{{Type: MarkTypeBold}}},
					{Type: NodeTypeText, Text: " "},
					{Type: NodeTypeText, Text: "italic", Marks: []PMMark{{Type: MarkTypeItalic}}},
					{Type: NodeTypeText, Text: " "},
					{Type: NodeTypeText, Text: "underline", Marks: []PMMark{{Type: MarkTypeUnderline}}},
					{Type: NodeTypeText, Text: " "},
					{
						Type: NodeTypeText,
						Text: "link",
						Marks: []PMMark{{
							Type:  MarkTypeLink,
							Attrs: map[string]any{"href": "https://example.com"},
						}},
					},
				},
			},
			{
				Type: NodeTypeBulletList,
				Content: []PMNode{
					{
						Type: NodeTypeListItem,
						Content: []PMNode{
							{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "Item 1"}}},
						},
					},
					{
						Type: NodeTypeListItem,
						Content: []PMNode{
							{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "Item 2"}}},
						},
					},
				},
			},
			{
				Type: NodeTypeOrderedList,
				Content: []PMNode{
					{
						Type: NodeTypeListItem,
						Content: []PMNode{
							{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "First"}}},
						},
					},
					{
						Type: NodeTypeListItem,
						Content: []PMNode{
							{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "Second"}}},
						},
					},
				},
			},
			{
				Type: NodeTypeBlockquote,
				Content: []PMNode{
					{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "A quote"}}},
				},
			},
			{
				Type: NodeTypeTable,
				Content: []PMNode{
					{
						Type: NodeTypeTableRow,
						Content: []PMNode{
							{Type: NodeTypeTableCell, Content: []PMNode{
								{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "A1"}}},
							}},
							{Type: NodeTypeTableCell, Content: []PMNode{
								{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "B1"}}},
							}},
						},
					},
					{
						Type: NodeTypeTableRow,
						Content: []PMNode{
							{Type: NodeTypeTableCell, Content: []PMNode{
								{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "A2"}}},
							}},
							{Type: NodeTypeTableCell, Content: []PMNode{
								{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "B2"}}},
							}},
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

	// Spot-check the expected shape.
	if len(parsed.Content) < 6 {
		t.Fatalf("expected >= 6 top-level children, got %d: %s", len(parsed.Content), parsedJSON)
	}
	want := []string{
		NodeTypeHeading, NodeTypeParagraph, NodeTypeBulletList,
		NodeTypeOrderedList, NodeTypeBlockquote, NodeTypeTable,
	}
	for i, w := range want {
		if parsed.Content[i].Type != w {
			t.Errorf("child %d: expected %s, got %s", i, w, parsed.Content[i].Type)
		}
	}

	// Verify the heading level survived.
	if lvl, ok := parsed.Content[0].Attrs["level"]; !ok {
		t.Errorf("heading missing level attr")
	} else if v, _ := lvl.(float64); v != 1 {
		t.Errorf("heading level: expected 1, got %v", lvl)
	}

	// Verify marks survived.
	paraRuns := parsed.Content[1].Content
	foundBold, foundItalic, foundUnderline, foundLink := false, false, false, false
	for _, r := range paraRuns {
		for _, m := range r.Marks {
			switch m.Type {
			case MarkTypeBold:
				if r.Text == "bold" {
					foundBold = true
				}
			case MarkTypeItalic:
				if r.Text == "italic" {
					foundItalic = true
				}
			case MarkTypeUnderline:
				if r.Text == "underline" {
					foundUnderline = true
				}
			case MarkTypeLink:
				if r.Text == "link" {
					foundLink = true
					if href, _ := m.Attrs["href"].(string); href != "https://example.com" {
						t.Errorf("link href mismatch: %q", href)
					}
				}
			}
		}
	}
	if !foundBold {
		t.Errorf("bold mark not preserved (paraRuns=%+v)", paraRuns)
	}
	if !foundItalic {
		t.Errorf("italic mark not preserved")
	}
	if !foundUnderline {
		t.Errorf("underline mark not preserved")
	}
	if !foundLink {
		t.Errorf("link mark not preserved")
	}

	// Verify list items survived as listItem children of bulletList /
	// orderedList — guards against a future regression where list-item
	// grouping silently breaks (every item gets its own list).
	bullet := parsed.Content[2]
	if got := len(bullet.Content); got != 2 {
		t.Errorf("bulletList: expected 2 items, got %d", got)
	}
	ordered := parsed.Content[3]
	if got := len(ordered.Content); got != 2 {
		t.Errorf("orderedList: expected 2 items, got %d", got)
	}

	// Blockquote should wrap one paragraph.
	bq := parsed.Content[4]
	if len(bq.Content) != 1 || bq.Content[0].Type != NodeTypeParagraph {
		t.Errorf("blockquote: expected one paragraph child, got %+v", bq.Content)
	}

	// Table should be 2x2 with the right cell text.
	tbl := parsed.Content[5]
	if got := len(tbl.Content); got != 2 {
		t.Fatalf("table: expected 2 rows, got %d", got)
	}
	expectedCells := [][]string{{"A1", "B1"}, {"A2", "B2"}}
	for r, row := range tbl.Content {
		if got := len(row.Content); got != 2 {
			t.Errorf("row %d: expected 2 cells, got %d", r, got)
			continue
		}
		for c, cell := range row.Content {
			// Cells may contain multiple paragraphs (WordZero seeds an
			// empty placeholder when a table is created); concatenate
			// the text of every text node in every paragraph child.
			var sb strings.Builder
			for _, para := range cell.Content {
				for _, run := range para.Content {
					if run.Type == NodeTypeText {
						sb.WriteString(run.Text)
					}
				}
			}
			if sb.String() != expectedCells[r][c] {
				t.Errorf("cell [%d][%d]: expected %q, got %q (full=%+v)", r, c, expectedCells[r][c], sb.String(), cell.Content)
			}
		}
	}
}

// makeListDocPMJSON builds a PM doc containing one bulleted and one
// numbered list — the two code paths that exercise WordZero's global
// NumberingManager. The label is interpolated into item text so the
// caller can match returned bytes back to the input later.
func makeListDocPMJSON(t *testing.T, label string) []byte {
	t.Helper()
	doc := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{
				Type: NodeTypeBulletList,
				Content: []PMNode{
					{
						Type: NodeTypeListItem,
						Content: []PMNode{
							{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: label + "-bul-1"}}},
						},
					},
					{
						Type: NodeTypeListItem,
						Content: []PMNode{
							{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: label + "-bul-2"}}},
						},
					},
				},
			},
			{
				Type: NodeTypeOrderedList,
				Content: []PMNode{
					{
						Type: NodeTypeListItem,
						Content: []PMNode{
							{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: label + "-ord-1"}}},
						},
					},
					{
						Type: NodeTypeListItem,
						Content: []PMNode{
							{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: label + "-ord-2"}}},
						},
					},
				},
			},
		},
	}
	bs, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal pm doc: %v", err)
	}
	return bs
}

// extractNumberingXML pulls word/numbering.xml from a docx zip, or
// returns an empty slice if the document has no list content.
func extractNumberingXML(t *testing.T, docxBytes []byte) []byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(docxBytes), int64(len(docxBytes)))
	if err != nil {
		t.Fatalf("extractNumberingXML: open zip: %v", err)
	}
	for _, f := range zr.File {
		if f.Name == "word/numbering.xml" {
			r, err := f.Open()
			if err != nil {
				t.Fatalf("open numbering.xml: %v", err)
			}
			data, err := io.ReadAll(r)
			r.Close()
			if err != nil {
				t.Fatalf("read numbering.xml: %v", err)
			}
			return data
		}
	}
	return nil
}

// TestPMJSONToDocx_ConcurrentNumbering fires many parallel emits in
// flight at once and asserts that each resulting docx has a coherent
// numbering.xml whose numIds match the document body's references.
// Without the package mutex around WordZero's NumberingManager
// singleton, concurrent allocations interleave: one document's body
// references a numId that another concurrent document's numbering.xml
// defined, or numbering.xml duplicates a numId, etc. Run with `-race`
// for additional read/write race coverage on the shared allocator.
func TestPMJSONToDocx_ConcurrentNumbering(t *testing.T) {
	t.Parallel()

	const workers = 16
	// Build inputs up front on the test goroutine — t.Fatalf inside a
	// child goroutine is unsafe per the testing package contract.
	inputs := make([][]byte, workers)
	for i := 0; i < workers; i++ {
		inputs[i] = makeListDocPMJSON(t, fmt.Sprintf("w%d", i))
	}

	results := make([][]byte, workers)
	errs := make([]error, workers)

	var wg sync.WaitGroup
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		go func(idx int) {
			defer wg.Done()
			bs, err := PMJSONToDocx(inputs[idx])
			if err != nil {
				errs[idx] = err
				return
			}
			results[idx] = bs
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("worker %d: PMJSONToDocx: %v", i, err)
		}
	}

	for i, bs := range results {
		if len(bs) < 100 {
			t.Fatalf("worker %d: docx suspiciously small: %d bytes", i, len(bs))
		}
		numXML := extractNumberingXML(t, bs)
		if len(numXML) == 0 {
			t.Fatalf("worker %d: docx has no word/numbering.xml — lists were dropped", i)
		}

		// Reuse the import-side parser: it returns numId -> first-level
		// numFmt, which is only populated when numbering.xml is well
		// formed and every <w:num> resolves to a defined <w:abstractNum>.
		numFmts := parseNumberingFormats(numXML)
		if len(numFmts) == 0 {
			t.Fatalf("worker %d: numbering.xml present but no <w:num> entries parsed; raw=%s", i, string(numXML))
		}
		// Each doc emits one bullet list and one ordered list, so we
		// expect at least two numIds, with at least one bullet and one
		// non-bullet (decimal) format. A torn allocation manifests as
		// missing or duplicated definitions.
		seenBullet, seenOrdered := false, false
		seenIDs := make(map[string]bool, len(numFmts))
		for id, fmtStr := range numFmts {
			if seenIDs[id] {
				t.Errorf("worker %d: duplicate numId %q in numbering.xml", i, id)
			}
			seenIDs[id] = true
			if fmtStr == "bullet" {
				seenBullet = true
			} else if fmtStr != "" {
				seenOrdered = true
			}
		}
		if !seenBullet {
			t.Errorf("worker %d: no bullet-format numId in numbering.xml; got %+v", i, numFmts)
		}
		if !seenOrdered {
			t.Errorf("worker %d: no ordered-format numId in numbering.xml; got %+v", i, numFmts)
		}

		// Cross-check: every numId referenced by the body must be
		// defined in numbering.xml. A race where one goroutine's body
		// captured a numId before another goroutine bumped the counter
		// shows up here as a body-side reference with no definition.
		docXML := extractDocumentXML(t, bs)
		bodyRefs := findNumIDRefs(docXML)
		if len(bodyRefs) == 0 {
			t.Fatalf("worker %d: body has no <w:numId> references but the input had lists", i)
		}
		for ref := range bodyRefs {
			if _, ok := numFmts[ref]; !ok {
				t.Errorf("worker %d: body references numId %q with no matching definition in numbering.xml (defs=%v)", i, ref, numFmts)
			}
		}
	}
}

// findNumIDRefs scans word/document.xml for `w:numId w:val="N"`
// attribute literals. Cheap substring scan — sufficient for the test,
// which only needs the set of referenced ids.
func findNumIDRefs(docXML []byte) map[string]bool {
	out := make(map[string]bool)
	s := string(docXML)
	const tag = `<w:numId w:val="`
	for {
		i := strings.Index(s, tag)
		if i < 0 {
			break
		}
		s = s[i+len(tag):]
		j := strings.Index(s, `"`)
		if j < 0 {
			break
		}
		out[s[:j]] = true
		s = s[j+1:]
	}
	return out
}

// TestPMJSONToDocx_PageBreakRoundTrip emits a doc with a hard page
// break embedded between two paragraphs of text and confirms the
// round-trip preserves both the break and its position.
func TestPMJSONToDocx_PageBreakRoundTrip(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{Type: NodeTypeParagraph, Content: []PMNode{
				{Type: NodeTypeText, Text: "before"},
				{Type: NodeTypePageBreak},
				{Type: NodeTypeText, Text: "after"},
			}},
		},
	}
	jsonBytes, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	docxBytes, err := PMJSONToDocx(jsonBytes)
	if err != nil {
		t.Fatalf("PMJSONToDocx: %v", err)
	}
	if !bytes.Contains(readDocxPart(t, docxBytes, "word/document.xml"), []byte(`<w:br w:type="page"/>`)) {
		t.Errorf("expected <w:br w:type=\"page\"/> in document.xml")
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
	if len(parsed.Content) != 1 || parsed.Content[0].Type != NodeTypeParagraph {
		t.Fatalf("expected one paragraph, got %+v", parsed.Content)
	}
	pb := -1
	for i, c := range parsed.Content[0].Content {
		if c.Type == NodeTypePageBreak {
			pb = i
		}
	}
	if pb < 0 {
		t.Errorf("page break missing from round-tripped paragraph: %+v", parsed.Content[0].Content)
	}
}

// TestPMJSONToDocx_CommentRoundTrip emits a doc containing a comment
// mark and verifies word/comments.xml is present and the markers
// round-trip back into a comment mark on the same text.
func TestPMJSONToDocx_CommentRoundTrip(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{Type: NodeTypeParagraph, Content: []PMNode{
				{Type: NodeTypeText, Text: "plain "},
				{Type: NodeTypeText, Text: "commented", Marks: []PMMark{{
					Type: MarkTypeComment,
					Attrs: map[string]any{
						"id":     "0",
						"author": "Alice",
						"text":   "Look at this",
						"date":   "2026-05-15T12:00:00Z",
					},
				}}},
				{Type: NodeTypeText, Text: " more"},
			}},
		},
	}
	jsonBytes, _ := json.Marshal(original)
	docxBytes, err := PMJSONToDocx(jsonBytes)
	if err != nil {
		t.Fatalf("PMJSONToDocx: %v", err)
	}
	if !bytes.Contains(readDocxPart(t, docxBytes, "word/document.xml"), []byte("<w:commentRangeStart")) {
		t.Errorf("expected <w:commentRangeStart in document.xml")
	}
	if readDocxPart(t, docxBytes, "word/comments.xml") == nil {
		t.Errorf("expected word/comments.xml to be present in the zip")
	}
	parsedJSON, warnings, err := DocxToPMJSON(docxBytes)
	if err != nil {
		t.Fatalf("DocxToPMJSON: %v", err)
	}
	for _, w := range warnings {
		if w.Code == WarningComments || w.Code == WarningUnsupportedNode {
			t.Errorf("unexpected warning: %+v", w)
		}
	}
	var parsed PMNode
	_ = json.Unmarshal(parsedJSON, &parsed)
	foundComment := false
	for _, r := range parsed.Content[0].Content {
		for _, m := range r.Marks {
			if m.Type != MarkTypeComment {
				continue
			}
			foundComment = true
			if r.Text != "commented" {
				t.Errorf("comment mark applied to wrong text: %q", r.Text)
			}
			if a, _ := m.Attrs["author"].(string); a != "Alice" {
				t.Errorf("author mismatch: %q", a)
			}
			if txt, _ := m.Attrs["text"].(string); txt != "Look at this" {
				t.Errorf("comment text mismatch: %q", txt)
			}
		}
	}
	if !foundComment {
		t.Errorf("comment mark missing after round-trip: %+v", parsed.Content[0].Content)
	}
}

// TestPMJSONToDocx_FootnoteRoundTrip emits a doc with a footnote
// reference and verifies both the inline reference and word/
// footnotes.xml round-trip.
func TestPMJSONToDocx_FootnoteRoundTrip(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{Type: NodeTypeParagraph, Content: []PMNode{
				{Type: NodeTypeText, Text: "claim"},
				{Type: NodeTypeFootnoteReference, Attrs: map[string]any{
					"id":   "1",
					"text": "Source: Smith 2025",
				}},
				{Type: NodeTypeText, Text: " end"},
			}},
		},
	}
	jsonBytes, _ := json.Marshal(original)
	docxBytes, err := PMJSONToDocx(jsonBytes)
	if err != nil {
		t.Fatalf("PMJSONToDocx: %v", err)
	}
	if !bytes.Contains(readDocxPart(t, docxBytes, "word/document.xml"), []byte("<w:footnoteReference")) {
		t.Errorf("expected <w:footnoteReference in document.xml")
	}
	if readDocxPart(t, docxBytes, "word/footnotes.xml") == nil {
		t.Errorf("expected word/footnotes.xml to be present in the zip")
	}
	parsedJSON, warnings, err := DocxToPMJSON(docxBytes)
	if err != nil {
		t.Fatalf("DocxToPMJSON: %v", err)
	}
	for _, w := range warnings {
		if w.Code == WarningUnsupportedNode {
			t.Errorf("unexpected unsupported-node warning: %+v", w)
		}
	}
	var parsed PMNode
	_ = json.Unmarshal(parsedJSON, &parsed)
	if len(parsed.Content) == 0 {
		t.Fatalf("empty parsed content")
	}
	found := false
	for _, r := range parsed.Content[0].Content {
		if r.Type != NodeTypeFootnoteReference {
			continue
		}
		found = true
		if txt, _ := r.Attrs["text"].(string); txt != "Source: Smith 2025" {
			t.Errorf("footnote body mismatch: %q", txt)
		}
	}
	if !found {
		t.Errorf("footnote reference missing after round-trip: %+v", parsed.Content[0].Content)
	}
}

// TestPMJSONToDocx_EndnoteRoundTrip mirrors the footnote test for
// endnotes, ensuring the parallel pipeline is wired up symmetrically.
func TestPMJSONToDocx_EndnoteRoundTrip(t *testing.T) {
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{Type: NodeTypeParagraph, Content: []PMNode{
				{Type: NodeTypeText, Text: "see"},
				{Type: NodeTypeEndnoteReference, Attrs: map[string]any{
					"id":   "1",
					"text": "Appendix",
				}},
			}},
		},
	}
	jsonBytes, _ := json.Marshal(original)
	docxBytes, err := PMJSONToDocx(jsonBytes)
	if err != nil {
		t.Fatalf("PMJSONToDocx: %v", err)
	}
	if !bytes.Contains(readDocxPart(t, docxBytes, "word/document.xml"), []byte("<w:endnoteReference")) {
		t.Errorf("expected <w:endnoteReference in document.xml")
	}
	if readDocxPart(t, docxBytes, "word/endnotes.xml") == nil {
		t.Errorf("expected word/endnotes.xml to be present in the zip")
	}
	parsedJSON, warnings, err := DocxToPMJSON(docxBytes)
	if err != nil {
		t.Fatalf("DocxToPMJSON: %v", err)
	}
	for _, w := range warnings {
		if w.Code == WarningUnsupportedNode {
			t.Errorf("unexpected unsupported-node warning: %+v", w)
		}
	}
	var parsed PMNode
	_ = json.Unmarshal(parsedJSON, &parsed)
	found := false
	for _, r := range parsed.Content[0].Content {
		if r.Type == NodeTypeEndnoteReference {
			found = true
			if txt, _ := r.Attrs["text"].(string); txt != "Appendix" {
				t.Errorf("endnote body mismatch: %q", txt)
			}
		}
	}
	if !found {
		t.Errorf("endnote reference missing after round-trip")
	}
}

// TestPMJSONToDocx_NestedTableInCellFlattened verifies that a table
// cell containing block content the v1 exporter can't represent (here,
// a nested table) no longer fails the whole conversion. Instead the
// inner text is flattened into the cell and a WarningCellContentFlattened
// is surfaced. Regression test for the production infinite-retry loop
// caused by `tableCell content must be paragraph, got "table"`.
func TestPMJSONToDocx_NestedTableInCellFlattened(t *testing.T) {
	innerTable := PMNode{
		Type: NodeTypeTable,
		Content: []PMNode{
			{
				Type: NodeTypeTableRow,
				Content: []PMNode{
					{Type: NodeTypeTableCell, Content: []PMNode{
						{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "inner-a"}}},
					}},
					{Type: NodeTypeTableCell, Content: []PMNode{
						{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "inner-b"}}},
					}},
				},
			},
		},
	}
	original := PMNode{
		Type: NodeTypeDoc,
		Content: []PMNode{
			{
				Type: NodeTypeTable,
				Content: []PMNode{
					{
						Type: NodeTypeTableRow,
						Content: []PMNode{
							{Type: NodeTypeTableCell, Content: []PMNode{
								{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "outer"}}},
								innerTable,
							}},
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

	docxBytes, warnings, err := PMJSONToDocxWithWarnings(originalJSON)
	if err != nil {
		t.Fatalf("PMJSONToDocxWithWarnings should degrade, not error: %v", err)
	}
	if len(docxBytes) < 100 {
		t.Fatalf("docx too small (%d bytes); probably empty", len(docxBytes))
	}

	var sawFlatten bool
	for _, w := range warnings {
		if w.Code == WarningCellContentFlattened {
			sawFlatten = true
		}
	}
	if !sawFlatten {
		t.Fatalf("expected WarningCellContentFlattened, got %+v", warnings)
	}

	body := string(readDocxPart(t, docxBytes, "word/document.xml"))
	for _, want := range []string{"outer", "inner-a", "inner-b"} {
		if !strings.Contains(body, want) {
			t.Errorf("flattened cell text %q missing from document.xml", want)
		}
	}
}
