package translate

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"path"
	"strconv"
	"strings"
)

// DocxToPMJSON parses .docx bytes into a ProseMirror JSON tree plus a
// list of soft-degradation warnings (for tracked changes, comments,
// content controls, unknown styles, and unknown body children).
//
// We parse word/document.xml directly via encoding/xml rather than
// going through WordZero's Document.Open because WordZero's parser
// drops content we need to preserve — most importantly, runs nested
// inside <w:hyperlink> elements never appear in Paragraph.Runs, so
// every link's text vanishes round-trip. Walking the OOXML ourselves
// also gives us full control over warnings and unrecognized elements.
//
// Hard error if: the bytes don't form a ZIP, or word/document.xml
// is missing or malformed. Everything else degrades to a Warning.
func DocxToPMJSON(docx []byte) ([]byte, []Warning, error) {
	root, warnings, err := parseDocxToPMNode(docx)
	if err != nil {
		return nil, nil, err
	}
	out, err := json.Marshal(root)
	if err != nil {
		return nil, nil, fmt.Errorf("translate: marshal root: %w", err)
	}
	return out, warnings, nil
}

// parseDocxToPMNode parses .docx bytes into an in-memory PMNode tree
// plus warnings. Shared by DocxToPMJSON (which marshals to JSON for
// the bootstrap path's Y.Doc seeding) and DocxToHTML (which walks
// the tree directly to HTML for the render path).
func parseDocxToPMNode(docx []byte) (PMNode, []Warning, error) {
	zr, err := zip.NewReader(bytes.NewReader(docx), int64(len(docx)))
	if err != nil {
		return PMNode{}, nil, fmt.Errorf("translate: open docx as zip: %w", err)
	}

	parts, err := readZipParts(zr)
	if err != nil {
		return PMNode{}, nil, err
	}

	docXML, ok := parts["word/document.xml"]
	if !ok {
		return PMNode{}, nil, fmt.Errorf("translate: docx missing word/document.xml")
	}

	parser := docxParser{
		zip:       zr,
		rels:      parseRelationships(parts["word/_rels/document.xml.rels"]),
		numbering: parseNumberingFormats(parts["word/numbering.xml"]),
		comments:  parseComments(parts["word/comments.xml"]),
		footnotes: parseFootnoteLikeBodies(parts["word/footnotes.xml"], "footnote"),
		endnotes:  parseFootnoteLikeBodies(parts["word/endnotes.xml"], "endnote"),
	}

	root, err := parser.parseDocument(docXML)
	if err != nil {
		return PMNode{}, nil, fmt.Errorf("translate: parse document.xml: %w", err)
	}
	return root, parser.warnings, nil
}

// readZipParts collects the bytes of every file in the docx zip.
func readZipParts(zr *zip.Reader) (map[string][]byte, error) {
	parts := make(map[string][]byte, len(zr.File))
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("translate: open %s: %w", f.Name, err)
		}
		buf, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			return nil, fmt.Errorf("translate: read %s: %w", f.Name, err)
		}
		parts[f.Name] = buf
	}
	return parts, nil
}

// docxParser holds the state shared across paragraph/run/table parses
// so we don't have to thread a half-dozen arguments through every call.
type docxParser struct {
	zip          *zip.Reader              // open docx zip for reading media bytes
	rels         map[string]relationship  // rId -> relationship target
	numbering    map[string]string        // numId -> "bullet" or "decimal"
	comments     map[string]commentInfo   // commentId -> author/text/date
	footnotes    map[string]string        // footnote id -> plain text body
	endnotes     map[string]string        // endnote id -> plain text body
	openComments []string                 // commentIds currently active across the cursor
	warnings     []Warning                // accumulated soft-degradation signals
	warningSet   map[WarningCode]struct{} // dedupe
}

// commentInfo captures the metadata of one entry in word/comments.xml.
// Stored on the parser and stamped into MarkTypeComment marks; on export
// the same fields are written back out, so dropping or editing the
// mark cleanly removes/updates the comment in the resulting docx.
type commentInfo struct {
	Author string
	Text   string
	Date   string
}

// closeComment removes a single occurrence of id from openComments.
// Ranges close in arbitrary order (not necessarily LIFO) — a comment
// opened earlier can close after a later one — so we splice rather
// than pop.
func (p *docxParser) closeComment(id string) {
	for i, open := range p.openComments {
		if open == id {
			p.openComments = append(p.openComments[:i], p.openComments[i+1:]...)
			return
		}
	}
}

// activeCommentMarks builds one MarkTypeComment mark per currently-open
// comment id, populated with the resolved author/text/date from
// word/comments.xml. Used by flushRun to stamp the marks onto each
// text run sitting between a commentRangeStart and its matching
// commentRangeEnd.
func (p *docxParser) activeCommentMarks() []PMMark {
	if len(p.openComments) == 0 {
		return nil
	}
	out := make([]PMMark, 0, len(p.openComments))
	for _, id := range p.openComments {
		attrs := map[string]any{"id": id}
		if info, ok := p.comments[id]; ok {
			if info.Author != "" {
				attrs["author"] = info.Author
			}
			if info.Text != "" {
				attrs["text"] = info.Text
			}
			if info.Date != "" {
				attrs["date"] = info.Date
			}
		}
		out = append(out, PMMark{Type: MarkTypeComment, Attrs: attrs})
	}
	return out
}

// addWarning appends a unique warning code (we only emit one warning
// per code, no matter how many instances triggered it).
func (p *docxParser) addWarning(code WarningCode, detail string) {
	if p.warningSet == nil {
		p.warningSet = make(map[WarningCode]struct{})
	}
	if _, dup := p.warningSet[code]; dup {
		return
	}
	p.warningSet[code] = struct{}{}
	p.warnings = append(p.warnings, Warning{Code: code, Detail: detail})
}

// relationship is one Relationship row out of word/_rels/document.xml.rels;
// Type tells us hyperlink vs image vs other; Target is the URL or media path.
type relationship struct {
	Type       string
	Target     string
	TargetMode string
}

// parseRelationships reads document.xml.rels into a map keyed by rId.
// Returns nil-tolerant: a missing or malformed relationships file
// just produces an empty map (callers treat unknown rIds gracefully).
func parseRelationships(b []byte) map[string]relationship {
	if len(b) == 0 {
		return nil
	}
	type relXML struct {
		ID         string `xml:"Id,attr"`
		Type       string `xml:"Type,attr"`
		Target     string `xml:"Target,attr"`
		TargetMode string `xml:"TargetMode,attr"`
	}
	var doc struct {
		XMLName xml.Name `xml:"Relationships"`
		Rels    []relXML `xml:"Relationship"`
	}
	if err := xml.Unmarshal(b, &doc); err != nil {
		return nil
	}
	m := make(map[string]relationship, len(doc.Rels))
	for _, r := range doc.Rels {
		m[r.ID] = relationship{Type: r.Type, Target: r.Target, TargetMode: r.TargetMode}
	}
	return m
}

// parseNumberingFormats reads word/numbering.xml and returns a map
// from numId to its first-level numFmt ("bullet", "decimal",
// "lowerLetter", "lowerRoman", etc.). We use the first level's format
// to decide whether the whole list is a bulletList or orderedList in
// PM (PM has no per-level format distinction).
func parseNumberingFormats(b []byte) map[string]string {
	if len(b) == 0 {
		return nil
	}
	type lvlXML struct {
		ILvl   string `xml:"ilvl,attr"`
		NumFmt struct {
			Val string `xml:"val,attr"`
		} `xml:"numFmt"`
	}
	type abstractXML struct {
		ID   string   `xml:"abstractNumId,attr"`
		Lvls []lvlXML `xml:"lvl"`
	}
	type numXML struct {
		NumID         string `xml:"numId,attr"`
		AbstractNumID struct {
			Val string `xml:"val,attr"`
		} `xml:"abstractNumId"`
	}
	var root struct {
		XMLName      xml.Name      `xml:"numbering"`
		AbstractNums []abstractXML `xml:"abstractNum"`
		Nums         []numXML      `xml:"num"`
	}
	if err := xml.Unmarshal(b, &root); err != nil {
		return nil
	}
	abstracts := make(map[string]string, len(root.AbstractNums))
	for _, a := range root.AbstractNums {
		for _, l := range a.Lvls {
			if l.ILvl == "0" || l.ILvl == "" {
				abstracts[a.ID] = l.NumFmt.Val
				break
			}
		}
	}
	out := make(map[string]string, len(root.Nums))
	for _, n := range root.Nums {
		out[n.NumID] = abstracts[n.AbstractNumID.Val]
	}
	return out
}

// parseComments reads word/comments.xml into a map keyed by w:id. Each
// entry collects the comment's author / date attributes and the flat
// concatenation of every <w:t> child it contains. Returns nil on
// missing or malformed input — the body-level pass treats absence as
// "no comments" and skips emitting marks.
func parseComments(b []byte) map[string]commentInfo {
	if len(b) == 0 {
		return nil
	}
	dec := xml.NewDecoder(bytes.NewReader(b))
	out := map[string]commentInfo{}
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		start, ok := tok.(xml.StartElement)
		if !ok || start.Name.Local != "comment" {
			continue
		}
		info := commentInfo{
			Author: attrValue(start, "author"),
			Date:   attrValue(start, "date"),
		}
		id := attrValue(start, "id")
		text, err := readCommentBodyText(dec, start)
		if err != nil {
			return out
		}
		info.Text = text
		if id != "" {
			out[id] = info
		}
	}
	return out
}

// readCommentBodyText concatenates every <w:t> CharData inside a
// <w:comment> element. Walks until the matching </w:comment> closes.
func readCommentBodyText(dec *xml.Decoder, start xml.StartElement) (string, error) {
	var sb strings.Builder
	for {
		tok, err := dec.Token()
		if err != nil {
			return "", err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "t" {
				txt, err := readElementText(dec, t)
				if err != nil {
					return "", err
				}
				sb.WriteString(txt)
				continue
			}
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				return sb.String(), nil
			}
		}
	}
}

// parseFootnoteLikeBodies reads word/footnotes.xml or word/endnotes.xml
// into a map of id -> plain-text body. The elementName arg is
// "footnote" or "endnote"; both files share the same shape.
//
// Word seeds two reserved entries (id="-1" separator, id="0"
// continuation separator) which carry no user content; we skip those
// by checking the w:type attribute, which Word stamps as "separator"
// or "continuationSeparator" on the reserved ones.
func parseFootnoteLikeBodies(b []byte, elementName string) map[string]string {
	if len(b) == 0 {
		return nil
	}
	dec := xml.NewDecoder(bytes.NewReader(b))
	out := map[string]string{}
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		start, ok := tok.(xml.StartElement)
		if !ok || start.Name.Local != elementName {
			continue
		}
		id := attrValue(start, "id")
		typ := attrValue(start, "type")
		if typ == "separator" || typ == "continuationSeparator" {
			_ = skipElement(dec, start)
			continue
		}
		text, err := readCommentBodyText(dec, start)
		if err != nil {
			return out
		}
		if id != "" {
			out[id] = text
		}
	}
	return out
}

// parseDocument is the entry point for word/document.xml — it walks
// the body and produces a doc-level PMNode. List paragraphs (which
// are flat in OOXML) are post-processed into nested bulletList /
// orderedList / listItem trees.
func (p *docxParser) parseDocument(docXML []byte) (PMNode, error) {
	root := PMNode{Type: NodeTypeDoc}

	dec := xml.NewDecoder(bytes.NewReader(docXML))
	body, err := findElement(dec, "body")
	if err != nil {
		return PMNode{}, err
	}

	// Walk body children.
	flat, err := p.parseBodyChildren(dec, body)
	if err != nil {
		return PMNode{}, err
	}
	root.Content = renestInterruptingBulletSubLists(groupListParagraphs(flat))
	return root, nil
}

// findElement scans forward from the decoder until it hits a
// StartElement with the given local name, then returns it.
func findElement(dec *xml.Decoder, local string) (xml.StartElement, error) {
	for {
		tok, err := dec.Token()
		if err != nil {
			return xml.StartElement{}, fmt.Errorf("translate: looking for <%s>: %w", local, err)
		}
		if start, ok := tok.(xml.StartElement); ok && start.Name.Local == local {
			return start, nil
		}
	}
}

// parseBodyChildren consumes tokens until the closing </body> tag,
// emitting flat block-level PMNodes. The flat list is later post-
// processed by groupListParagraphs into proper PM list trees.
func (p *docxParser) parseBodyChildren(dec *xml.Decoder, body xml.StartElement) ([]PMNode, error) {
	var out []PMNode
	for {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			node, err := p.parseBodyChild(dec, t)
			if err != nil {
				return nil, err
			}
			if node != nil {
				out = append(out, liftInlineImages(*node)...)
			}
		case xml.EndElement:
			if t.Name.Local == body.Name.Local {
				return out, nil
			}
		}
	}
}

// liftInlineImages splits a paragraph that mixes text and image runs
// into a sequence of sibling block-level nodes: one paragraph per text
// span, plus an image-only paragraph (image wrapped in its own
// <p>) between/around them.
//
// Why the image stays inside a paragraph wrapper: the PM schema
// treats image as an inline node (so floated images can sit beside
// text inside one paragraph and CSS float works). A block-level
// image at top-level would be schema-invalid; wrapping each
// "standalone" image in its own paragraph keeps the tree valid.
//
// Exception: images with wrap="left" or wrap="right" stay inline as
// the first child of the original paragraph. The emitter writes them
// with WordZero's floatLeft/floatRight position, which produces an
// <wp:anchor> inside the same <w:p> as the surrounding text — so the
// pass-3 tree is also a single paragraph containing image + text.
// Hoisting these out would break round-trip AND lose the visual
// wrapping that's the whole point of the float.
//
// Non-paragraph nodes (tables, headings) pass through unchanged.
// Empty-after-lift paragraphs are dropped.
func liftInlineImages(node PMNode) []PMNode {
	if node.Type != NodeTypeParagraph {
		return []PMNode{node}
	}
	hasLiftableImage := false
	for _, c := range node.Content {
		if c.Type == NodeTypeImage && !isFloatedImage(c) {
			hasLiftableImage = true
			break
		}
	}
	if !hasLiftableImage {
		return []PMNode{node}
	}
	var out []PMNode
	var buf []PMNode
	flush := func() {
		if len(buf) == 0 {
			return
		}
		para := PMNode{Type: NodeTypeParagraph, Content: buf, Attrs: cloneAttrs(node.Attrs)}
		out = append(out, para)
		buf = nil
	}
	for _, c := range node.Content {
		if c.Type == NodeTypeImage && !isFloatedImage(c) {
			flush()
			// Wrap the standalone image in its own paragraph; PM
			// schema requires inline image to live inside a block.
			out = append(out, PMNode{Type: NodeTypeParagraph, Content: []PMNode{c}})
			continue
		}
		buf = append(buf, c)
	}
	flush()
	return out
}

// isFloatedImage reports whether an image PM node has a wrap attr
// that anchors it inside its surrounding paragraph rather than lifting
// it to its own block. "left"/"right" floats wrap surrounding text;
// "break" (Word's "Top and Bottom") doesn't wrap, but its anchor still
// lives inside a <w:p> in the DOCX export — lifting it would force the
// emitter to invent a host paragraph and break the round-trip shape.
func isFloatedImage(node PMNode) bool {
	if node.Type != NodeTypeImage {
		return false
	}
	wrap, _ := node.Attrs["wrap"].(string)
	return wrap == "left" || wrap == "right" || wrap == "break"
}

func cloneAttrs(in map[string]any) map[string]any {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

// parseBodyChild handles one direct child of <w:body>.
func (p *docxParser) parseBodyChild(dec *xml.Decoder, start xml.StartElement) (*PMNode, error) {
	switch start.Name.Local {
	case "p":
		return p.parseParagraph(dec, start)
	case "tbl":
		return p.parseTable(dec, start)
	case "sectPr":
		// Section properties (page setup) — silently skip; not
		// representable in PM and not user-content.
		return nil, skipElement(dec, start)
	case "sdt":
		// Structured document tag (content control). Replace with
		// inner text and warn.
		p.addWarning(WarningContentControls, "<w:sdt> elements were unwrapped to their inner text")
		return p.parseSdt(dec, start)
	default:
		p.addWarning(WarningUnsupportedNode, fmt.Sprintf("unknown body child <%s> dropped", start.Name.Local))
		return nil, skipElement(dec, start)
	}
}

// parseParagraph reads one <w:p> and returns either a PM paragraph,
// heading, blockquote, or — when wrapped by a parent context like a
// table cell — a paragraph regardless of pStyle.
func (p *docxParser) parseParagraph(dec *xml.Decoder, start xml.StartElement) (*PMNode, error) {
	var pStyle string
	var numID, ilvl string
	var textAlign string
	var indentLevel int
	var runs []PMNode

	for {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "pPr":
				if err := p.parseParagraphProperties(dec, t, &pStyle, &numID, &ilvl, &textAlign, &indentLevel); err != nil {
					return nil, err
				}
			case "r":
				if err := p.parseRun(dec, t, &runs, nil); err != nil {
					return nil, err
				}
			case "hyperlink":
				if err := p.parseHyperlink(dec, t, &runs); err != nil {
					return nil, err
				}
			case "ins":
				// Tracked insertion — we accept the inserted text and warn.
				p.addWarning(WarningTrackedChanges, "<w:ins> tracked insertions accepted as plain text")
				if err := p.parseInlineGroup(dec, t, &runs); err != nil {
					return nil, err
				}
			case "del":
				p.addWarning(WarningTrackedChanges, "<w:del> tracked deletions dropped")
				if err := skipElement(dec, t); err != nil {
					return nil, err
				}
			case "commentRangeStart":
				if id := attrValue(t, "id"); id != "" {
					p.openComments = append(p.openComments, id)
				}
				if err := skipElement(dec, t); err != nil {
					return nil, err
				}
			case "commentRangeEnd":
				if id := attrValue(t, "id"); id != "" {
					p.closeComment(id)
				}
				if err := skipElement(dec, t); err != nil {
					return nil, err
				}
			case "commentReference":
				// Reference runs carry no user content — they're the
				// "[A1]" pill Word renders between the range markers.
				// We round-trip via the marks on the range, so the
				// reference itself is dropped on import.
				if err := skipElement(dec, t); err != nil {
					return nil, err
				}
			case "bookmarkStart", "bookmarkEnd", "proofErr", "permStart", "permEnd":
				if err := skipElement(dec, t); err != nil {
					return nil, err
				}
			default:
				if err := skipElement(dec, t); err != nil {
					return nil, err
				}
			}
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				return p.assembleParagraph(pStyle, numID, ilvl, textAlign, indentLevel, runs), nil
			}
		}
	}
}

// assembleParagraph turns the parsed pPr fields and runs into a PM
// node — heading / paragraph / blockquote, with metadata for list
// post-processing tucked into Attrs. The temporary attrs are stripped
// by groupListParagraphs.
//
// textAlign / indentLevel encode <w:jc> and <w:ind w:left> values and
// are attached to the resulting paragraph or heading node when non-
// default. List items (numID != "") and blockquote-wrapped paragraphs
// intentionally do NOT carry these — Word's <w:jc> on a list item is
// uncommon and would complicate the list round-trip; blockquote
// formatting is owned by the wrapper.
func (p *docxParser) assembleParagraph(pStyle, numID, ilvl string, textAlign string, indentLevel int, runs []PMNode) *PMNode {
	// Empty paragraph (no runs) is still a valid PM paragraph node;
	// blank lines in OOXML translate to empty PM paragraphs.
	if numID != "" {
		// List item — emit a bare paragraph carrying list metadata
		// in Attrs; groupListParagraphs will gather these and rebuild
		// the bulletList/orderedList tree.
		return &PMNode{
			Type:    NodeTypeParagraph,
			Content: runs,
			Attrs: map[string]any{
				"_listNumId": numID,
				"_listLevel": ilvlToInt(ilvl),
				"_listFmt":   p.numbering[numID],
			},
		}
	}

	switch {
	case strings.HasPrefix(pStyle, "Heading"):
		level := headingLevel(pStyle)
		if level < 1 || level > 6 {
			p.addWarning(WarningUnsupportedStyle, fmt.Sprintf("heading level %d outside 1-6 normalized to 6", level))
			level = 6
		}
		attrs := map[string]any{"level": float64(level)}
		applyAlignIndentAttrs(attrs, textAlign, indentLevel)
		return &PMNode{
			Type:    NodeTypeHeading,
			Attrs:   attrs,
			Content: runs,
		}
	case pStyle == "Quote" || pStyle == "IntenseQuote":
		// Wrap a quote paragraph in a blockquote with one paragraph child.
		return &PMNode{
			Type: NodeTypeBlockquote,
			Content: []PMNode{
				{Type: NodeTypeParagraph, Content: runs},
			},
		}
	case isCodeBlockStyle(pStyle):
		// Collapse the paragraph's runs into a single plain-text child;
		// the PM codeBlock schema doesn't carry inline marks, so any
		// bold/italic/code marks from the source are dropped (visually
		// they would not survive the monospace verbatim render anyway).
		return &PMNode{
			Type:    NodeTypeCodeBlock,
			Content: codeBlockChildren(runs),
		}
	case pStyle != "" && pStyle != "Normal" && pStyle != "ListParagraph":
		// Unknown style — fall back to plain paragraph with a warning.
		p.addWarning(WarningUnsupportedStyle, fmt.Sprintf("paragraph style %q normalized to default paragraph", pStyle))
	}

	attrs := map[string]any{}
	applyAlignIndentAttrs(attrs, textAlign, indentLevel)
	if len(attrs) == 0 {
		return &PMNode{Type: NodeTypeParagraph, Content: runs}
	}
	return &PMNode{Type: NodeTypeParagraph, Attrs: attrs, Content: runs}
}

// applyAlignIndentAttrs adds textAlign + indent entries to the given
// attr map when they are non-default. Defaults (textAlign="left",
// indentLevel=0) are omitted so the PM JSON stays compact for the
// 99% of paragraphs that don't carry either.
func applyAlignIndentAttrs(attrs map[string]any, textAlign string, indentLevel int) {
	if textAlign != "" && textAlign != "left" {
		attrs["textAlign"] = textAlign
	}
	if indentLevel > 0 {
		attrs["indent"] = float64(indentLevel)
	}
}

// isCodeBlockStyle returns true for the paragraph style names we
// recognise as code blocks on import. "CodeBlock" is what our own
// exporter writes; the others are common aliases produced by Word,
// pandoc, and HTML-export tooling — accepting all four lets users
// paste pre-formatted content from a wider set of source files
// without losing the monospace render.
func isCodeBlockStyle(pStyle string) bool {
	switch pStyle {
	case "CodeBlock", "Code", "HTMLPreformatted", "Preformatted":
		return true
	}
	return false
}

// codeBlockChildren flattens a paragraph's parsed runs into the
// plain-text children a PM codeBlock node accepts. Marks are dropped
// (codeBlock doesn't carry inline formatting); adjacent text nodes
// are concatenated so a multi-run paragraph collapses to one text
// child — matches Tiptap's <pre><code>…</code></pre> render where
// the entire block content is a single text node.
func codeBlockChildren(runs []PMNode) []PMNode {
	var sb strings.Builder
	for _, r := range runs {
		if r.Type == NodeTypeText {
			sb.WriteString(r.Text)
		}
	}
	if sb.Len() == 0 {
		return nil
	}
	return []PMNode{{Type: NodeTypeText, Text: sb.String()}}
}

// parseInlineGroup is parseHyperlink/parseIns/parseDel without the
// link-specific bookkeeping — used to flatten a tracked-insertion's
// runs back into the surrounding paragraph.
func (p *docxParser) parseInlineGroup(dec *xml.Decoder, start xml.StartElement, runs *[]PMNode) error {
	for {
		tok, err := dec.Token()
		if err != nil {
			return err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "r" {
				if err := p.parseRun(dec, t, runs, nil); err != nil {
					return err
				}
			} else {
				if err := skipElement(dec, t); err != nil {
					return err
				}
			}
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				return nil
			}
		}
	}
}

// parseParagraphProperties extracts the paragraph style id, list ids,
// alignment, and left-indent level out of <w:pPr>.
//
// Alignment maps <w:jc w:val="left|center|right|both"/> to "left",
// "center", "right", or "justify" ("both" is Word's name for what PM
// calls "justify"). Indent maps <w:ind w:left="…"/> twips through
// twipsToIndentLevel (720 twips per level, half-inch each).
func (p *docxParser) parseParagraphProperties(dec *xml.Decoder, start xml.StartElement, pStyle, numID, ilvl *string, textAlign *string, indentLevel *int) error {
	for {
		tok, err := dec.Token()
		if err != nil {
			return err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "pStyle":
				*pStyle = attrValue(t, "val")
				if err := skipElement(dec, t); err != nil {
					return err
				}
			case "numPr":
				if err := p.parseNumPr(dec, t, numID, ilvl); err != nil {
					return err
				}
			case "jc":
				if v := attrValue(t, "val"); v != "" {
					*textAlign = normalizeJustification(v)
				}
				if err := skipElement(dec, t); err != nil {
					return err
				}
			case "ind":
				// Only `w:left` is supported in v1 — first-line and
				// right indent are dropped (and the parser does not
				// emit a warning for those, since they're far less
				// common than block left-indent and surface as quiet
				// fidelity loss rather than visible damage).
				if v := attrValue(t, "left"); v != "" {
					*indentLevel = twipsToIndentLevel(v)
				}
				if err := skipElement(dec, t); err != nil {
					return err
				}
			default:
				if err := skipElement(dec, t); err != nil {
					return err
				}
			}
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				return nil
			}
		}
	}
}

// normalizeJustification maps OOXML <w:jc w:val=…> values onto the PM
// textAlign enum. "both" is Word's term for full justify; anything
// outside the known set falls back to "left" (default) so unknown
// values don't propagate downstream as opaque strings.
func normalizeJustification(v string) string {
	switch v {
	case "center":
		return "center"
	case "right", "end":
		return "right"
	case "both", "distribute":
		return "justify"
	default:
		return "left"
	}
}

// twipsToIndentLevel converts a <w:ind w:left> twips string to a
// 0..MaxIndentLevel integer indent level. One level == 720 twips
// (Word's standard half-inch indent). Rounds to nearest level so a
// 1080-twip indent (3/4 inch — what Word writes for a tab stop) lands
// on level 2.
func twipsToIndentLevel(twipsStr string) int {
	twips, err := strconv.Atoi(twipsStr)
	if err != nil || twips <= 0 {
		return 0
	}
	// Round-to-nearest: +half-step before integer division.
	level := (twips + twipsPerIndentLevel/2) / twipsPerIndentLevel
	if level < 0 {
		return 0
	}
	if level > MaxIndentLevel {
		return MaxIndentLevel
	}
	return level
}

// parseNumPr extracts numId and ilvl from <w:numPr>.
func (p *docxParser) parseNumPr(dec *xml.Decoder, start xml.StartElement, numID, ilvl *string) error {
	for {
		tok, err := dec.Token()
		if err != nil {
			return err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "numId":
				*numID = attrValue(t, "val")
			case "ilvl":
				*ilvl = attrValue(t, "val")
			}
			if err := skipElement(dec, t); err != nil {
				return err
			}
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				return nil
			}
		}
	}
}

// parseRun reads one <w:r>, splits it into PMNode text/image runs,
// and applies the supplied extra marks (used by parseHyperlink to
// add a link mark on every nested run).
func (p *docxParser) parseRun(dec *xml.Decoder, start xml.StartElement, out *[]PMNode, extraMarks []PMMark) error {
	var marks []PMMark
	var collected []PMNode

	for {
		tok, err := dec.Token()
		if err != nil {
			return err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "rPr":
				m, err := p.parseRunProperties(dec, t)
				if err != nil {
					return err
				}
				marks = m
			case "t":
				txt, err := readElementText(dec, t)
				if err != nil {
					return err
				}
				if txt != "" {
					collected = append(collected, PMNode{Type: NodeTypeText, Text: txt})
				}
			case "tab":
				collected = append(collected, PMNode{Type: NodeTypeText, Text: "\t"})
				if err := skipElement(dec, t); err != nil {
					return err
				}
			case "br":
				// <w:br w:type="page"/> is a hard page break — preserved
				// as its own PM node so the export side can re-emit it
				// at the same location. Soft / textWrapping breaks stay
				// as a newline inside the surrounding text run.
				if attrValue(t, "type") == "page" {
					collected = append(collected, PMNode{Type: NodeTypePageBreak})
				} else {
					collected = append(collected, PMNode{Type: NodeTypeText, Text: "\n"})
				}
				if err := skipElement(dec, t); err != nil {
					return err
				}
			case "drawing":
				img, err := p.parseDrawing(dec, t)
				if err != nil {
					return err
				}
				if img != nil {
					collected = append(collected, *img)
				}
			case "footnoteReference":
				ref := PMNode{Type: NodeTypeFootnoteReference}
				id := attrValue(t, "id")
				attrs := map[string]any{}
				if id != "" {
					attrs["id"] = id
					if txt, ok := p.footnotes[id]; ok {
						attrs["text"] = txt
					}
				}
				if len(attrs) > 0 {
					ref.Attrs = attrs
				}
				collected = append(collected, ref)
				if err := skipElement(dec, t); err != nil {
					return err
				}
			case "endnoteReference":
				ref := PMNode{Type: NodeTypeEndnoteReference}
				id := attrValue(t, "id")
				attrs := map[string]any{}
				if id != "" {
					attrs["id"] = id
					if txt, ok := p.endnotes[id]; ok {
						attrs["text"] = txt
					}
				}
				if len(attrs) > 0 {
					ref.Attrs = attrs
				}
				collected = append(collected, ref)
				if err := skipElement(dec, t); err != nil {
					return err
				}
			default:
				if err := skipElement(dec, t); err != nil {
					return err
				}
			}
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				return p.flushRun(out, collected, marks, extraMarks)
			}
		}
	}
}

// flushRun applies the run's marks (plus any inherited extras from a
// hyperlink wrapper) to each text node in the run. Image nodes pass
// through without marks.
//
// When the run is wrapped by a <w:hyperlink>, drop the underline mark
// and clear the color attr off the textStyle mark — those are emitted
// by pm_to_docx.marksToTextFormat as visual cues on every link, so
// preserving them on import would gain marks that weren't in the
// source. fontSize / fontFamily are NOT link-derived and must survive
// (otherwise a link with an explicit font choice would lose it on
// round-trip).
func (p *docxParser) flushRun(out *[]PMNode, collected []PMNode, marks, extras []PMMark) error {
	if hasMark(extras, MarkTypeLink) {
		marks = stripMark(marks, MarkTypeUnderline)
		marks = clearTextStyleAttr(marks, "color")
	}
	combined := mergeMarks(marks, extras)
	// Comment marks are appended (not merged) because mergeMarks
	// dedupes by Type — nested ranges would otherwise collapse to one.
	combined = append(combined, p.activeCommentMarks()...)
	for _, c := range collected {
		switch c.Type {
		case NodeTypeText:
			if len(combined) > 0 {
				c.Marks = append([]PMMark(nil), combined...)
			}
		case NodeTypeFootnoteReference, NodeTypeEndnoteReference:
			// Footnote / endnote refs preserve formatting marks (so a
			// bold paragraph keeps its bold ref) but skip mark types
			// that would be visually nonsensical on a numeric ref.
		}
		*out = append(*out, c)
	}
	return nil
}

func hasMark(marks []PMMark, t string) bool {
	for _, m := range marks {
		if m.Type == t {
			return true
		}
	}
	return false
}

// clearTextStyleAttr removes a single attribute from the textStyle
// mark in marks (if present) and drops the mark entirely when it
// becomes empty. Used by flushRun to peel link-derived color cues off
// a textStyle mark that may still legitimately carry fontSize /
// fontFamily.
func clearTextStyleAttr(marks []PMMark, attr string) []PMMark {
	for i, m := range marks {
		if m.Type != MarkTypeTextStyle {
			continue
		}
		if m.Attrs == nil {
			continue
		}
		if _, ok := m.Attrs[attr]; !ok {
			continue
		}
		delete(m.Attrs, attr)
		if len(m.Attrs) == 0 {
			out := append([]PMMark{}, marks[:i]...)
			return append(out, marks[i+1:]...)
		}
		marks[i] = m
	}
	return marks
}

func stripMark(marks []PMMark, t string) []PMMark {
	out := marks[:0]
	for _, m := range marks {
		if m.Type == t {
			continue
		}
		out = append(out, m)
	}
	return out
}

// mergeMarks returns the union of two mark slices, deduplicated by
// type. The second slice (extras) wins on conflict — we use this so
// hyperlink-imposed link marks aren't shadowed by a duplicate.
func mergeMarks(a, b []PMMark) []PMMark {
	if len(a) == 0 && len(b) == 0 {
		return nil
	}
	seen := make(map[string]int, len(a)+len(b))
	out := make([]PMMark, 0, len(a)+len(b))
	for _, m := range a {
		seen[m.Type] = len(out)
		out = append(out, m)
	}
	for _, m := range b {
		if i, ok := seen[m.Type]; ok {
			out[i] = m
			continue
		}
		seen[m.Type] = len(out)
		out = append(out, m)
	}
	return out
}

// parseRunProperties extracts <w:rPr> bold/italic/underline marks plus
// the attributes that ride on a single textStyle mark (color, fontSize,
// fontFamily). Bold and italic are toggle elements (presence == on, but
// a w:val of "false" / "0" / "off" inverts that); underline uses w:val
// for the style ("single"/"double"/"none"). textStyle attrs are
// accumulated into one map and emitted as a single mark at the end so
// downstream mergeMarks (which dedupes by Type) doesn't drop them.
func (p *docxParser) parseRunProperties(dec *xml.Decoder, start xml.StartElement) ([]PMMark, error) {
	var marks []PMMark
	textStyleAttrs := map[string]any{}
	for {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "b":
				if isOnToggle(t) {
					marks = append(marks, PMMark{Type: MarkTypeBold})
				}
			case "i":
				if isOnToggle(t) {
					marks = append(marks, PMMark{Type: MarkTypeItalic})
				}
			case "u":
				if v := attrValue(t, "val"); v != "" && v != "none" {
					marks = append(marks, PMMark{Type: MarkTypeUnderline})
				} else if v == "" {
					marks = append(marks, PMMark{Type: MarkTypeUnderline})
				}
			case "color":
				// w:val is a hex RRGGBB (no leading "#") or "auto".
				// "auto" means "follow the theme default" — drop it.
				if v := attrValue(t, "val"); v != "" && !strings.EqualFold(v, "auto") {
					textStyleAttrs["color"] = "#" + strings.ToUpper(v)
				}
			case "shd":
				// <w:shd w:val="clear" w:color="auto" w:fill="RRGGBB"/> —
				// run shading. w:fill carries the hex background. "auto"
				// means "follow theme" (drop). w:shd is the precise
				// background color; w:highlight (below) is a coarser
				// named-color form. If both appear, the later element
				// wins — Word emits w:shd after w:highlight in practice.
				if v := attrValue(t, "fill"); v != "" && !strings.EqualFold(v, "auto") {
					textStyleAttrs["backgroundColor"] = "#" + strings.ToUpper(v)
				}
			case "highlight":
				// <w:highlight w:val="yellow"/> — Word's legacy fixed-
				// palette highlighter. Map the OOXML named colors to
				// hex so the renderer + the editor's color UI can treat
				// them uniformly with w:shd. "none" / unknown values
				// drop silently. If w:shd already set backgroundColor,
				// don't overwrite — w:shd is more precise.
				if _, alreadySet := textStyleAttrs["backgroundColor"]; !alreadySet {
					if v := attrValue(t, "val"); v != "" {
						if hex := highlightNameToHex(v); hex != "" {
							textStyleAttrs["backgroundColor"] = hex
						}
					}
				}
			case "sz":
				// <w:sz w:val="N"/> — N is half-points. We render as a
				// CSS pixel string ("Npx") because @tiptap/extension-
				// text-style/font-size stores the attribute verbatim
				// as the inline `style` value (it does no number
				// parsing). Zero / unparseable values are dropped
				// (treated as "no fontSize attr").
				if v := attrValue(t, "val"); v != "" {
					if n, err := strconv.Atoi(v); err == nil && n > 0 {
						if px := HalfPointsToPx(n); px > 0 {
							textStyleAttrs["fontSize"] = strconv.Itoa(px) + "px"
						}
					}
				}
			case "rFonts":
				// <w:rFonts w:ascii="…" w:hAnsi="…" .../>. Word writes
				// the same family across ascii/hAnsi for Western text;
				// we prefer w:ascii (most common, what Word reads back
				// first), then fall back to w:hAnsi when only that
				// attribute is set (rare but happens with some
				// Office-365-generated docs).
				name := attrValue(t, "ascii")
				if name == "" {
					name = attrValue(t, "hAnsi")
				}
				if name != "" {
					textStyleAttrs["fontFamily"] = name
				}
			case "rStyle":
				// Character style names. "VerbatimChar" is the standard
				// pandoc / HTML-export mark for inline code; we also
				// accept "Code" as a common alias. Hyperlink character
				// style is handled at the paragraph level via
				// parseHyperlink. Other styles drop silently — too
				// noisy to warn on.
				if v := attrValue(t, "val"); v == "VerbatimChar" || v == "Code" {
					marks = append(marks, PMMark{Type: MarkTypeCode})
				}
			}
			if err := skipElement(dec, t); err != nil {
				return nil, err
			}
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				if len(textStyleAttrs) > 0 {
					marks = append(marks, PMMark{
						Type:  MarkTypeTextStyle,
						Attrs: textStyleAttrs,
					})
				}
				return marks, nil
			}
		}
	}
}

// isOnToggle returns true for <w:b/>, <w:b w:val="true"/>,
// <w:b w:val="1"/>, etc., and false for explicit val="false"/"0"/"off".
func isOnToggle(start xml.StartElement) bool {
	v := attrValue(start, "val")
	if v == "" {
		return true
	}
	switch strings.ToLower(v) {
	case "false", "0", "off":
		return false
	}
	return true
}

// parseHyperlink wraps every contained run with a link mark whose
// href resolves via the shared rels map (or via the w:anchor
// attribute for in-document anchors).
func (p *docxParser) parseHyperlink(dec *xml.Decoder, start xml.StartElement, runs *[]PMNode) error {
	rid := attrValue(start, "id")
	anchor := attrValue(start, "anchor")
	href := ""
	if rid != "" {
		if rel, ok := p.rels[rid]; ok {
			href = rel.Target
		}
	}
	if href == "" && anchor != "" {
		href = "#" + anchor
	}

	var extra []PMMark
	if href != "" {
		extra = []PMMark{{Type: MarkTypeLink, Attrs: map[string]any{"href": href}}}
	}

	for {
		tok, err := dec.Token()
		if err != nil {
			return err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "r" {
				if err := p.parseRun(dec, t, runs, extra); err != nil {
					return err
				}
			} else {
				if err := skipElement(dec, t); err != nil {
					return err
				}
			}
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				return nil
			}
		}
	}
}

// parseDrawing handles <w:drawing> (inline or anchor) and produces a
// PM image node. We extract the rId from the nested a:blip, look up
// the media filename via rels, and inline the image bytes from the
// docx zip as a self-contained data: URI. Embedding the bytes (rather
// than copying the in-zip path verbatim into src) keeps the PM tree
// round-trippable: PMJSONToDocx accepts only data: URIs because the
// emitter has no way to re-resolve in-zip paths from a tree that's
// been edited and re-serialized. Alt text comes from wp:docPr@descr.
//
// Anchor drawings (<wp:anchor>) carry text-wrapping info via
// <wp:wrapSquare>/<wp:wrapTight>/<wp:wrapThrough>/<wp:wrapTopAndBottom>
// plus a <wp:positionH><wp:align>{left|right|center}</...></...> sibling.
// We collapse all "text flows around image" wrap modes to
// wrap=left|right, map <wp:wrapTopAndBottom> to wrap=break (Word's
// "Top and Bottom"), and inline + wrapNone to wrap=none. Used by the
// emitter to round-trip and by the editor CSS to apply float / break.
//
// If the rels lookup or zip read fails, the image is dropped silently
// (no PM node emitted) — losing an unresolvable image is preferable
// to producing a tree that fails round-trip.
//
// Image dimensions are read from <wp:extent cx=".." cy=".."/>, which
// appears inside both <wp:inline> and <wp:anchor>. OOXML stores them
// as EMUs (English Metric Units: 1 inch = 914400 EMU, 1 px @ 96 DPI =
// 9525 EMU). We convert with rounding (emusToPixels) and stash the
// integer pixel values on the PM image node as `width` / `height`.
// pm_to_docx.go::emitImageBlock multiplies back to EMUs (via
// WordZero's `width * 9525`) on save, so a docx that round-trips
// through the editor without an explicit user resize comes back with
// the same wp:extent values (modulo ±1 px from integer rounding).
func (p *docxParser) parseDrawing(dec *xml.Decoder, start xml.StartElement) (*PMNode, error) {
	var blipRid, alt, title string
	hasAnchor := false
	hasWrap := false
	hasTopAndBottom := false
	posHAlign := ""
	var extentCx, extentCy int
	// Track depth inside <wp:positionH> so we only read the <wp:align>
	// that belongs to the horizontal positioner. Word writes both
	// <wp:positionH> and <wp:positionV>, each with an <wp:align> child;
	// vertical alignment is irrelevant to our left/right decision.
	posHDepth := 0

	for {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "anchor":
				hasAnchor = true
			case "docPr":
				alt = attrValue(t, "descr")
				title = attrValue(t, "title")
			case "blip":
				if v := attrValue(t, "embed"); v != "" {
					blipRid = v
				}
			case "extent":
				// <wp:extent cx="..." cy="..."/> — present on both
				// <wp:inline> and <wp:anchor>. We accept the first one
				// we see; effectExtent (which carries a similar shape)
				// is a different local name so there's no collision.
				if cx, ok := parseIntAttr(t, "cx"); ok && cx > 0 {
					extentCx = cx
				}
				if cy, ok := parseIntAttr(t, "cy"); ok && cy > 0 {
					extentCy = cy
				}
			case "wrapSquare", "wrapTight", "wrapThrough":
				hasWrap = true
			case "wrapTopAndBottom":
				// Word's "Top and Bottom" wrap. Semantically distinct
				// from text-flowing-around-image wrap modes: text never
				// sits beside the image — only above and below. We map
				// it to wrap="break" rather than reusing hasWrap.
				hasTopAndBottom = true
			case "positionH":
				posHDepth++
			case "align":
				if posHDepth > 0 {
					// CharData inside <wp:align> is "left"/"right"/"center".
					txt, err := readElementText(dec, t)
					if err != nil {
						return nil, err
					}
					posHAlign = strings.TrimSpace(txt)
				}
			}
			// Drawings nest very deep; we walk forward on every
			// StartElement (no skip) so we see the inner blip
			// regardless of where it appears.
		case xml.EndElement:
			if t.Name.Local == "positionH" && posHDepth > 0 {
				posHDepth--
			}
			if t.Name.Local == start.Name.Local {
				if blipRid == "" {
					return nil, nil
				}
				rel, ok := p.rels[blipRid]
				if !ok {
					return nil, nil
				}
				src := p.resolveMediaSrc(rel.Target)
				if src == "" {
					return nil, nil
				}
				img := &PMNode{
					Type:  NodeTypeImage,
					Attrs: map[string]any{"src": src},
				}
				if alt != "" && alt != wordZeroDefaultImageLabel {
					img.Attrs["alt"] = alt
				}
				if title != "" && title != wordZeroDefaultImageLabel {
					img.Attrs["title"] = title
				}
				if wrap := resolveWrap(hasAnchor, hasWrap, hasTopAndBottom, posHAlign); wrap != "" {
					img.Attrs["wrap"] = wrap
				}
				if extentCx > 0 {
					img.Attrs["width"] = emusToPixels(extentCx)
				}
				if extentCy > 0 {
					img.Attrs["height"] = emusToPixels(extentCy)
				}
				return img, nil
			}
		}
	}
}

// parseIntAttr returns the named attribute parsed as a decimal integer,
// plus an ok flag distinguishing "absent or unparsable" from a literal
// zero. Used for <wp:extent cx/cy> where a missing attr means
// "preserve the bytes' native dimensions" and zero means "render as
// 0×0" — semantically the same here but we keep the distinction for
// future callers.
func parseIntAttr(start xml.StartElement, name string) (int, bool) {
	raw := attrValue(start, name)
	if raw == "" {
		return 0, false
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return 0, false
	}
	return v, true
}

// emusToPixels converts an EMU (English Metric Unit) measurement into
// CSS pixels at 96 DPI. 914400 EMU = 1 inch, 96 px = 1 inch, so
// 9525 EMU = 1 px. We round to the nearest pixel because partial
// pixels never round-trip cleanly through the HTML width/height attrs
// (which are integers).
func emusToPixels(emus int) int {
	if emus <= 0 {
		return 0
	}
	return (emus + 4762) / 9525
}

// resolveWrap turns the collected anchor/wrap/position state into
// the PM image's `wrap` attribute. We only emit the attr when it's
// not the default ("none") so unwrapped images stay attribute-free
// and round-trip identically through the existing test fixtures.
//
// Mapping rules:
//   - Inline drawing (no <wp:anchor>) -> "" (no wrap attr; default
//     "none" applies).
//   - Anchor + <wp:wrapTopAndBottom> -> "break" (Word's "Top and
//     Bottom" mode; takes precedence over square/tight/through if
//     somehow both appeared in the same anchor).
//   - Anchor with no wrap*Square/Tight/Through child (and no
//     topAndBottom) -> "" (treated as none — wrapNone falls here).
//   - Anchor with wrap* present -> "left" or "right" based on
//     <wp:positionH><wp:align>. "center" falls back to "left" since
//     CSS float has no first-class "center" mode and Word renders
//     centered floats by treating them as floatLeft visually.
//     Missing align defaults to "left" (Word's default for new floats).
func resolveWrap(hasAnchor, hasWrap, hasTopAndBottom bool, posHAlign string) string {
	if !hasAnchor {
		return ""
	}
	if hasTopAndBottom {
		return "break"
	}
	if !hasWrap {
		return ""
	}
	if posHAlign == "right" {
		return "right"
	}
	return "left"
}

// wordZeroDefaultImageLabel is the literal Chinese string ("image")
// that WordZero hard-codes into wp:docPr@descr / @title whenever an
// image's ImageConfig leaves AltText / Title empty (see
// createImageParagraph in image.go in WordZero v1.6.0). When we round-
// trip an image whose alt/title were absent in the source, WordZero
// re-emits the default — the parser drops it on import to keep the
// PMNode attribute set stable across passes.
const wordZeroDefaultImageLabel = "图片"

// resolveMediaSrc converts an in-zip media reference (the Target field
// from word/_rels/document.xml.rels — e.g. "media/image1.gif" or
// "../media/image1.gif") into a self-contained data: URI suitable for
// round-tripping back through PMJSONToDocx. Returns the data: URI on
// success, or empty string on failure (caller drops the image rather
// than emitting an unresolvable reference).
//
// rels Targets are relative to the location of the .rels file
// (word/_rels/document.xml.rels), so they're rooted at "word/".
// path.Clean(path.Join("word", target)) collapses any "../" prefixes
// the way Word writes them when the media is already inside word/.
func (p *docxParser) resolveMediaSrc(relTarget string) string {
	if p.zip == nil || relTarget == "" {
		return ""
	}
	cleaned := strings.TrimPrefix(path.Clean(path.Join("word", relTarget)), "/")
	for _, f := range p.zip.File {
		if f.Name != cleaned {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return ""
		}
		buf, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			return ""
		}
		return "data:" + mimeFromExt(path.Ext(cleaned)) + ";base64," +
			base64.StdEncoding.EncodeToString(buf)
	}
	return ""
}

// mimeFromExt maps a file extension (with leading dot, any case) to a
// MIME type suitable for a data: URI. Unknown extensions fall through
// to application/octet-stream — pm_to_docx.decodeImageSrc will reject
// those at emit time, which is the correct behavior since we can't
// guess the format.
func mimeFromExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".svg":
		return "image/svg+xml"
	default:
		return "application/octet-stream"
	}
}

// parseTable reads <w:tbl> into a PM table node. We capture the
// <w:tblGrid>'s per-column dxa widths up-front and pass them down to
// each cell so cells that span columns get the exact per-column widths
// from the source (rather than evenly splitting their <w:tcW>, which
// would drift on round-trip when grid columns aren't equal).
func (p *docxParser) parseTable(dec *xml.Decoder, start xml.StartElement) (*PMNode, error) {
	tbl := &PMNode{Type: NodeTypeTable}
	var gridCols []int
	col := 0
	for {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "tblGrid":
				gridCols, err = parseTableGrid(dec, t)
				if err != nil {
					return nil, err
				}
			case "tr":
				row, err := p.parseTableRow(dec, t, gridCols, &col)
				if err != nil {
					return nil, err
				}
				if row != nil {
					tbl.Content = append(tbl.Content, *row)
				}
				col = 0
			default:
				if err := skipElement(dec, t); err != nil {
					return nil, err
				}
			}
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				consolidateVMerges(tbl)
				padTableRowsToMaxWidth(tbl)
				return tbl, nil
			}
		}
	}
}

// consolidateVMerges collapses OOXML vertical-merge runs into a
// single PM tableCell with rowspan>1. After parseTable finishes, every
// row carries one PM cell per <w:tc>, and continue cells carry a
// sentinel `_vmerge="continue"` attribute. This pass:
//
//  1. Walks rows top-to-bottom, tracking the most recent "start" cell
//     per physical column (a cell that began a vMerge OR a normal cell
//     that the next-row continue should attach to). A continue cell
//     directly under a start cell at the same physical column bumps
//     the start's `rowspan` and is removed from its row.
//  2. Resets the start tracker for a column when a row in that column
//     is occupied by a non-continue cell (a new vMerge run, or a fresh
//     unmerged cell — either way the previous run terminates).
//  3. Strips the `_vmerge` sentinel from every surviving cell.
//
// Physical column = position after accounting for colspan in prior
// cells of the same row. A cell with colspan=2 occupies two physical
// columns; both columns are advanced past, and a continue cell at
// either column will attach to that wide start cell.
func consolidateVMerges(tbl *PMNode) {
	if tbl == nil {
		return
	}
	type startRef struct {
		row int
		ci  int // index into tbl.Content[row].Content
	}
	// activeStart maps physical column → most-recent non-continue cell
	// covering that column. Nil entries mean "no active run here yet".
	var activeStart []*startRef

	for r := range tbl.Content {
		row := &tbl.Content[r]
		if row.Type != NodeTypeTableRow {
			continue
		}
		// Walk the row by physical column. We may splice out continue
		// cells as we go, so iterate with an index that doesn't
		// advance on splice.
		col := 0
		i := 0
		for i < len(row.Content) {
			cell := &row.Content[i]
			if cell.Type != NodeTypeTableCell {
				i++
				continue
			}
			span := cellColspanForPad(*cell)
			vm := ""
			if cell.Attrs != nil {
				if s, ok := cell.Attrs["_vmerge"].(string); ok {
					vm = s
				}
				delete(cell.Attrs, "_vmerge")
			}
			ensureCap := func(n int) {
				for len(activeStart) < n {
					activeStart = append(activeStart, nil)
				}
			}
			ensureCap(col + span)
			if vm == "continue" {
				// Attach to the active start cell at this column, if any.
				// We only consult the first spanned column — OOXML
				// permits gridSpan on a continue cell only when the
				// start cell had the same gridSpan, so all spanned
				// columns point to the same start.
				startCell := activeStart[col]
				if startCell != nil && startCell.row < r {
					sc := &tbl.Content[startCell.row].Content[startCell.ci]
					if sc.Attrs == nil {
						sc.Attrs = map[string]any{}
					}
					rs := 1
					if v, ok := sc.Attrs["rowspan"]; ok {
						if n := asIntForPad(v); n > 0 {
							rs = n
						}
					}
					sc.Attrs["rowspan"] = rs + 1
					// Remove the continue cell from this row.
					row.Content = append(row.Content[:i], row.Content[i+1:]...)
					// Don't advance i — the next cell slid into i.
					// Do advance col across the spanned columns.
					col += span
					continue
				}
				// No active start to attach to: treat as a fresh cell
				// (defensive — happens for malformed input). Fall
				// through to the start-cell branch by clearing vm.
				vm = ""
			}
			// Non-continue cell: establishes a new active run at every
			// physical column it covers.
			ref := &startRef{row: r, ci: i}
			for c := col; c < col+span; c++ {
				activeStart[c] = ref
			}
			col += span
			i++
		}
	}
}

// asIntForPad coerces an attribute value (which may have come from
// JSON as float64 or be an int) into an int. Parallel to asInt in
// pm_to_docx.go — duplicated to avoid cross-file coupling.
func asIntForPad(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case float64:
		return int(n)
	}
	return 0
}

// parseTableGrid reads <w:tblGrid> into an int slice of per-column dxa
// widths. Word emits one <w:gridCol w:w="…"/> per physical column;
// these are authoritative for the table's column layout and are what
// we want to round-trip back out so widths don't drift cell-by-cell.
func parseTableGrid(dec *xml.Decoder, start xml.StartElement) ([]int, error) {
	var cols []int
	for {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "gridCol" {
				if v := attrValue(t, "w"); v != "" {
					if n, err := strconv.Atoi(v); err == nil {
						cols = append(cols, n)
					}
				}
			}
			if err := skipElement(dec, t); err != nil {
				return nil, err
			}
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				return cols, nil
			}
		}
	}
}

// padTableRowsToMaxWidth normalizes a parsed table so every row spans
// the same number of physical columns, padding shorter rows with empty
// cells. The emitter (pm_to_docx.emitTable) creates a uniform-width
// WordZero table by computing max(cols) across rows; padding on import
// keeps pass-1 and pass-3 trees structurally identical.
//
// Physical-column count means: sum of colspan across cells in the row
// PLUS columns covered by an earlier row's rowspan>1 cell. A row
// holding a single cell at column 1 still has "physical width 2" if
// column 0 is being covered by a rowspan from the row above. Without
// the rowspan contribution, padding would inject a stray empty cell
// at column 1 that shifts every real cell to its right.
func padTableRowsToMaxWidth(tbl *PMNode) {
	type rowMetrics struct {
		ownCols     int // sum of colspans of cells actually in this row
		coveredCols int // cols covered by an earlier row's rowspan
	}
	// First pass: compute, for each row, how many cols are already
	// covered by earlier rows' rowspan=N cells.
	covered := make([]int, len(tbl.Content))
	// activeRowspans tracks remaining rowspan rows for each "logical"
	// column position, but rowspans are anchored at physical column
	// indices — and physical columns shift if we don't carefully
	// account for ordering. Use a slice indexed by physical col.
	var rowspanAt []int // remaining rows of cover at each physical col
	metrics := make([]rowMetrics, len(tbl.Content))
	for r, row := range tbl.Content {
		if row.Type != NodeTypeTableRow {
			continue
		}
		col := 0
		own := 0
		cov := 0
		// Track which physical-col cover entries are "new this row"
		// so we don't decrement them at end-of-row (they apply to
		// subsequent rows only).
		newThisRow := make(map[int]bool)
		for _, cell := range row.Content {
			if cell.Type != NodeTypeTableCell {
				continue
			}
			for col < len(rowspanAt) && rowspanAt[col] > 0 {
				col++
				cov++
			}
			span := cellColspanForPad(cell)
			rspan := cellRowspanForPad(cell)
			for len(rowspanAt) < col+span {
				rowspanAt = append(rowspanAt, 0)
			}
			if rspan > 1 {
				for c := col; c < col+span; c++ {
					rowspanAt[c] = rspan - 1
					newThisRow[c] = true
				}
			}
			own += span
			col += span
		}
		// Cover past the end of this row's own cells still counts.
		for c := col; c < len(rowspanAt); c++ {
			if rowspanAt[c] > 0 {
				cov++
			}
		}
		metrics[r] = rowMetrics{ownCols: own, coveredCols: cov}
		covered[r] = cov
		// Decrement at end-of-row — but skip entries we just set, so
		// the next row still sees them as covered.
		for c := range rowspanAt {
			if newThisRow[c] {
				continue
			}
			if rowspanAt[c] > 0 {
				rowspanAt[c]--
			}
		}
	}
	maxCols := 0
	for _, m := range metrics {
		if total := m.ownCols + m.coveredCols; total > maxCols {
			maxCols = total
		}
	}
	for i := range tbl.Content {
		row := &tbl.Content[i]
		if row.Type != NodeTypeTableRow {
			continue
		}
		want := maxCols - metrics[i].coveredCols
		for metrics[i].ownCols < want {
			row.Content = append(row.Content, PMNode{
				Type: NodeTypeTableCell,
				Content: []PMNode{
					{Type: NodeTypeParagraph},
				},
			})
			metrics[i].ownCols++
		}
	}
}

// cellColspanForPad reads colspan off a tableCell, defaulting to 1.
// Parallel to cellColspan in pm_to_docx.go — kept separate so docx_to_pm
// doesn't depend on the export side of the package.
func cellColspanForPad(cell PMNode) int {
	if cell.Attrs == nil {
		return 1
	}
	if v, ok := cell.Attrs["colspan"]; ok {
		switch n := v.(type) {
		case int:
			if n > 0 {
				return n
			}
		case float64:
			if n > 0 {
				return int(n)
			}
		}
	}
	return 1
}

// cellRowspanForPad reads rowspan off a tableCell, defaulting to 1.
// Parallel to cellColspanForPad. Driven by the same attribute the
// editor's TableCell extension exposes ("rowspan", set by Tiptap's
// columnResizing/mergeCells flow and by consolidateVMerges on import).
func cellRowspanForPad(cell PMNode) int {
	if cell.Attrs == nil {
		return 1
	}
	if v, ok := cell.Attrs["rowspan"]; ok {
		switch n := v.(type) {
		case int:
			if n > 0 {
				return n
			}
		case float64:
			if n > 0 {
				return int(n)
			}
		}
	}
	return 1
}

func (p *docxParser) parseTableRow(dec *xml.Decoder, start xml.StartElement, gridCols []int, colCursor *int) (*PMNode, error) {
	row := &PMNode{Type: NodeTypeTableRow}
	for {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "tc":
				cell, err := p.parseTableCell(dec, t, gridCols, *colCursor)
				if err != nil {
					return nil, err
				}
				if cell != nil {
					row.Content = append(row.Content, *cell)
					*colCursor += cellColspanForPad(*cell)
				}
			default:
				if err := skipElement(dec, t); err != nil {
					return nil, err
				}
			}
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				return row, nil
			}
		}
	}
}

func (p *docxParser) parseTableCell(dec *xml.Decoder, start xml.StartElement, gridCols []int, colIdx int) (*PMNode, error) {
	cell := &PMNode{Type: NodeTypeTableCell}
	var tcWDxa int    // <w:tcW w:w="..."> in dxa (twentieths of a point); 0 if missing or non-dxa.
	var gridSpan = 1  // <w:gridSpan w:val="..."> default 1.
	var vMerge string // "" / "restart" / "continue" from <w:vMerge>.
	for {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "tcPr":
				var bordersAttr map[string]any
				var shading string
				tcWDxa, gridSpan, vMerge, bordersAttr, shading, err = p.parseTableCellProperties(dec, t)
				if err != nil {
					return nil, err
				}
				if bordersAttr != nil {
					if cell.Attrs == nil {
						cell.Attrs = map[string]any{}
					}
					cell.Attrs["borders"] = bordersAttr
				}
				if shading != "" {
					if cell.Attrs == nil {
						cell.Attrs = map[string]any{}
					}
					cell.Attrs["shading"] = shading
				}
				if vMerge != "" {
					if cell.Attrs == nil {
						cell.Attrs = map[string]any{}
					}
					// Sentinel attr consumed (and stripped) by
					// consolidateVMerges. We carry it through to the
					// post-row pass so we can collapse continue cells
					// into their start cell's rowspan once the table
					// is fully parsed.
					cell.Attrs["_vmerge"] = vMerge
				}
			case "p":
				para, err := p.parseParagraph(dec, t)
				if err != nil {
					return nil, err
				}
				if para != nil {
					// Cell paragraphs never participate in list
					// grouping, so strip any list metadata that
					// snuck in (it would confuse the post-pass).
					if para.Attrs != nil {
						delete(para.Attrs, "_listNumId")
						delete(para.Attrs, "_listLevel")
						delete(para.Attrs, "_listFmt")
						if len(para.Attrs) == 0 {
							para.Attrs = nil
						}
					}
					cell.Content = append(cell.Content, liftInlineImages(*para)...)
				}
			case "tbl":
				nested, err := p.parseTable(dec, t)
				if err != nil {
					return nil, err
				}
				if nested != nil {
					cell.Content = append(cell.Content, *nested)
				}
			default:
				if err := skipElement(dec, t); err != nil {
					return nil, err
				}
			}
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				cell.Content = collapseLeadingEmptyParagraphs(cell.Content)
				applyTableCellWidth(cell, tcWDxa, gridSpan, gridCols, colIdx)
				return cell, nil
			}
		}
	}
}

// parseTableCellProperties pulls the cell width (in dxa), gridSpan,
// vMerge state, and (optionally) the border map out of a <w:tcPr>
// block. Cell widths drive TipTap's `colwidth` attribute; gridSpan
// becomes the cell's colspan; vMerge is consumed by consolidateVMerges
// to collapse continue-cells into the start cell's rowspan; borders
// become the `borders` attr. Returns zero/nil/"" values for any field
// that's missing.
//
// <w:vMerge> shape:
//   - <w:vMerge w:val="restart"/> — this cell begins a vertical merge
//   - <w:vMerge/>                 — this cell continues a merge that
//     started above. (OOXML allows
//     w:val="continue" but Word omits it.)
func (p *docxParser) parseTableCellProperties(dec *xml.Decoder, start xml.StartElement) (int, int, string, map[string]any, string, error) {
	tcWDxa := 0
	gridSpan := 1
	vMerge := ""
	var borders map[string]any
	shading := ""
	for {
		tok, err := dec.Token()
		if err != nil {
			return 0, 0, "", nil, "", err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "tcW":
				// w:type="dxa" is the common case (twentieths of a point).
				// w:type="auto" / "nil" / "pct" are intentionally ignored:
				// for "auto" Word lays out by content so we want no fixed
				// width; pct% would need the table's total width to be
				// known, which we don't carry through.
				wType := attrValue(t, "type")
				if wType == "" || wType == "dxa" {
					if v := attrValue(t, "w"); v != "" {
						if n, err := strconv.Atoi(v); err == nil {
							tcWDxa = n
						}
					}
				}
				if err := skipElement(dec, t); err != nil {
					return 0, 0, "", nil, "", err
				}
			case "gridSpan":
				if v := attrValue(t, "val"); v != "" {
					if n, err := strconv.Atoi(v); err == nil && n > 0 {
						gridSpan = n
					}
				}
				if err := skipElement(dec, t); err != nil {
					return 0, 0, "", nil, "", err
				}
			case "vMerge":
				v := attrValue(t, "val")
				if v == "restart" {
					vMerge = "restart"
				} else {
					// Missing val and val="continue" both mean continue.
					vMerge = "continue"
				}
				if err := skipElement(dec, t); err != nil {
					return 0, 0, "", nil, "", err
				}
			case "tcBorders":
				b, err := parseTcBorders(dec, t)
				if err != nil {
					return 0, 0, "", nil, "", err
				}
				borders = b
			case "shd":
				shading = parseTcShading(t)
				if err := skipElement(dec, t); err != nil {
					return 0, 0, "", nil, "", err
				}
			default:
				if err := skipElement(dec, t); err != nil {
					return 0, 0, "", nil, "", err
				}
			}
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				return tcWDxa, gridSpan, vMerge, borders, shading, nil
			}
		}
	}
}

// applyTableCellWidth converts a cell's dxa width into TipTap's
// `colwidth` attribute (array of px widths, one per spanned column)
// and stamps it on the cell along with `colspan` if it spans columns.
// Skips when dxa is 0 (no explicit width — auto-sized).
//
// When the table's <w:tblGrid> per-column widths are available AND
// they align with the cell (colIdx + gridSpan ≤ len(gridCols)), each
// spanned column's px width is taken straight from the grid. This is
// what avoids round-trip drift: re-importing an emitted table sees
// the same per-column widths instead of evenly-split derived ones.
//
// Falls back to evenly splitting <w:tcW> across spanned columns when
// the grid is missing or misaligned (e.g. malformed source).
func applyTableCellWidth(cell *PMNode, tcWDxa, gridSpan int, gridCols []int, colIdx int) {
	if gridSpan > 1 {
		if cell.Attrs == nil {
			cell.Attrs = map[string]any{}
		}
		cell.Attrs["colspan"] = gridSpan
	}
	// Prefer <w:tblGrid> per-column widths — they are the canonical
	// source of column layout in OOXML and round-trip cleanly.
	if colIdx+gridSpan <= len(gridCols) {
		widths := make([]int, gridSpan)
		for i := 0; i < gridSpan; i++ {
			widths[i] = dxaToPx(gridCols[colIdx+i])
		}
		if cell.Attrs == nil {
			cell.Attrs = map[string]any{}
		}
		cell.Attrs["colwidth"] = widths
		return
	}
	if tcWDxa <= 0 {
		return
	}
	totalPx := dxaToPx(tcWDxa)
	if totalPx <= 0 {
		return
	}
	widths := make([]int, gridSpan)
	base := totalPx / gridSpan
	rem := totalPx - base*gridSpan
	for i := range widths {
		widths[i] = base
		if i < rem {
			widths[i]++
		}
	}
	if cell.Attrs == nil {
		cell.Attrs = map[string]any{}
	}
	cell.Attrs["colwidth"] = widths
}

func dxaToPx(dxa int) int {
	if dxa <= 0 {
		return 0
	}
	// Integer division matches Word's perceived sizing closely enough
	// for the editor (we don't need sub-pixel accuracy on screen).
	return dxa / 15
}

// collapseLeadingEmptyParagraphs normalizes the placeholder paragraphs
// WordZero leaves behind in cells. WordZero's AddCellParagraph does
// not replace the empty placeholder it seeds into each new cell, so
// every emitted cell ends up with a leading empty paragraph plus the
// appended one. Stripping it on import keeps the round-trip stable;
// visually a leading empty paragraph in a cell is rarely intentional.
//
// Two normalizations:
//
//   - If the cell mixes empty leading paragraphs with at least one
//     non-empty sibling, drop the leading empties.
//   - If the cell is entirely empty paragraphs, collapse to a single
//     empty paragraph (PM tableCell requires at least one paragraph).
func collapseLeadingEmptyParagraphs(content []PMNode) []PMNode {
	idx := 0
	for idx < len(content) && isEmptyParagraph(content[idx]) {
		idx++
	}
	if idx == len(content) && idx > 1 {
		// Entirely-empty cell: collapse to a single empty paragraph.
		return content[:1]
	}
	if idx == 0 || idx == len(content) {
		return content
	}
	return content[idx:]
}

func isEmptyParagraph(n PMNode) bool {
	return n.Type == NodeTypeParagraph && len(n.Content) == 0 && len(n.Attrs) == 0
}

// parseSdt unwraps <w:sdt> by recursively descending into its
// contents and emitting the inner block-level nodes as if the sdt
// wasn't there.
func (p *docxParser) parseSdt(dec *xml.Decoder, start xml.StartElement) (*PMNode, error) {
	for {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "sdtContent" {
				// Walk the sdtContent and return its first
				// block-level child. SDTs commonly wrap a single
				// paragraph; multi-paragraph SDTs lose all but the
				// first (acceptable for v1, signaled by the warning).
				return p.parseSdtContent(dec, t)
			}
			if err := skipElement(dec, t); err != nil {
				return nil, err
			}
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				return nil, nil
			}
		}
	}
}

func (p *docxParser) parseSdtContent(dec *xml.Decoder, start xml.StartElement) (*PMNode, error) {
	for {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			node, err := p.parseBodyChild(dec, t)
			if err != nil {
				return nil, err
			}
			if node != nil {
				// Drain the rest of sdtContent without producing more
				// nodes; first body-level child wins.
				if err := skipUntilEnd(dec, start.Name.Local); err != nil {
					return nil, err
				}
				return node, nil
			}
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				return nil, nil
			}
		}
	}
}

// readElementText reads CharData inside a <w:t> (or similar) element
// until its closing tag.
func readElementText(dec *xml.Decoder, start xml.StartElement) (string, error) {
	var sb strings.Builder
	for {
		tok, err := dec.Token()
		if err != nil {
			return "", err
		}
		switch t := tok.(type) {
		case xml.CharData:
			sb.Write(t)
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				return sb.String(), nil
			}
		case xml.StartElement:
			// shouldn't happen inside <w:t>, but just in case
			if err := skipElement(dec, t); err != nil {
				return "", err
			}
		}
	}
}

// skipElement consumes tokens until the matching EndElement of the
// supplied StartElement is seen. Handles arbitrary nesting depth.
func skipElement(dec *xml.Decoder, start xml.StartElement) error {
	depth := 1
	for depth > 0 {
		tok, err := dec.Token()
		if err != nil {
			return err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == start.Name.Local {
				depth++
			}
		case xml.EndElement:
			if t.Name.Local == start.Name.Local {
				depth--
			}
		}
	}
	return nil
}

// skipUntilEnd consumes tokens until the named element closes —
// useful when a function takes over after partially consuming a
// container.
func skipUntilEnd(dec *xml.Decoder, name string) error {
	for {
		tok, err := dec.Token()
		if err != nil {
			return err
		}
		if t, ok := tok.(xml.EndElement); ok && t.Name.Local == name {
			return nil
		}
	}
}

// highlightNameToHex maps OOXML's <w:highlight w:val="…"> fixed-palette
// names to hex strings the renderer can consume uniformly with w:shd's
// arbitrary hex fill. Word's highlighter only supports this fixed set
// (see ST_HighlightColor in the OOXML spec); arbitrary backgrounds go
// through w:shd instead. Unknown names (including "none") return ""
// and the caller drops the attr.
func highlightNameToHex(name string) string {
	switch strings.ToLower(name) {
	case "black":
		return "#000000"
	case "blue":
		return "#0000FF"
	case "cyan":
		return "#00FFFF"
	case "darkblue":
		return "#000080"
	case "darkcyan":
		return "#008080"
	case "darkgray":
		return "#808080"
	case "darkgreen":
		return "#008000"
	case "darkmagenta":
		return "#800080"
	case "darkred":
		return "#800000"
	case "darkyellow":
		return "#808000"
	case "green":
		return "#00FF00"
	case "lightgray":
		return "#C0C0C0"
	case "magenta":
		return "#FF00FF"
	case "red":
		return "#FF0000"
	case "white":
		return "#FFFFFF"
	case "yellow":
		return "#FFFF00"
	}
	return ""
}

// attrValue looks up a single attribute by local name on the
// start element. Returns "" if absent.
func attrValue(start xml.StartElement, name string) string {
	for _, a := range start.Attr {
		if a.Name.Local == name {
			return a.Value
		}
	}
	return ""
}

// headingLevel pulls an int out of "HeadingN" / "headingN" /
// "heading N". Returns 0 if no digit is present.
func headingLevel(style string) int {
	for i := len(style) - 1; i >= 0; i-- {
		if style[i] >= '0' && style[i] <= '9' {
			n, err := strconv.Atoi(string(style[i]))
			if err == nil {
				return n
			}
		}
	}
	return 0
}

// ilvlToInt converts a w:val string ("0", "1", …) to int, defaulting
// to 0 on parse failure.
func ilvlToInt(s string) int {
	if s == "" {
		return 0
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return n
}

// groupListParagraphs is the post-pass that turns the flat OOXML
// list-paragraph stream into PM's nested bulletList / orderedList /
// listItem trees. It walks block-level children left-to-right; runs
// of paragraphs sharing the same numId are bundled into one list
// node, and ilvl is honored to nest sub-lists inside their parent
// listItem.
//
// Numbering continuation: in OOXML, a numbered list can be visually
// interrupted (e.g. by a nested bulleted list with a different numId)
// and then resume with the same numId. Word renders the resumption
// continuing the previous numbering (1..5, bullets, 6.). We honor
// this by tracking the running level-0 item count per ordered numId
// and emitting `start` on each resumed list so it picks up where the
// previous one left off.
func groupListParagraphs(blocks []PMNode) []PMNode {
	var out []PMNode
	// Level-0 items emitted so far for each ordered-list numId. Only
	// level-0 items contribute to the visible number on the resumed
	// list; nested items reset their own counter inside the sub-list.
	emitted := map[string]int{}
	i := 0
	for i < len(blocks) {
		if numID, ok := listNumID(blocks[i]); ok {
			run := []PMNode{}
			for i < len(blocks) {
				id, ok := listNumID(blocks[i])
				if !ok || id != numID {
					break
				}
				run = append(run, blocks[i])
				i++
			}
			startAt := 0
			if listTypeFromFmt(listFmt(run[0])) == NodeTypeOrderedList {
				startAt = emitted[numID]
			}
			tree := buildListTree(run)
			if startAt > 0 && tree.Type == NodeTypeOrderedList {
				if tree.Attrs == nil {
					tree.Attrs = map[string]any{}
				}
				tree.Attrs["start"] = startAt + 1
			}
			for _, para := range run {
				if paraLevel(para) == 0 {
					emitted[numID]++
				}
			}
			out = append(out, tree)
			continue
		}
		out = append(out, blocks[i])
		i++
	}
	return out
}

// renestInterruptingBulletSubLists fixes a docx-shape problem: Word
// often emits a nested bullet list (under one item of a numbered
// outline) as a separate list paragraph stream with its own numId,
// so groupListParagraphs ends up producing three sibling list nodes:
//
//	orderedList (items 1..N, numId=A)
//	bulletList  (the sub-bullets,  numId=B)
//	orderedList (items N+1.., numId=A, start=N+1)
//
// The user's mental model is one outline with sub-bullets nested
// inside item N. Reading order is preserved either way, but the
// rendered HTML looks broken — the bullets appear at top level
// rather than indented under their parent.
//
// This pass walks the block list and, whenever it finds the pattern
// above, moves the bulletList inside the last listItem of the first
// orderedList AND merges the two halves of the orderedList into one
// (dropping the `start` attribute on the second half, since the
// numbering now flows naturally without resumption).
//
// We only merge when the two orderedList halves share the same numId
// (verifiable indirectly: the second half's `start` attribute equals
// the first half's item count + 1). Sibling ordered lists that don't
// belong together — e.g. two unrelated outlines — leave the
// interrupting bulletList where it was.
func renestInterruptingBulletSubLists(blocks []PMNode) []PMNode {
	out := make([]PMNode, 0, len(blocks))
	i := 0
	for i < len(blocks) {
		if i+2 < len(blocks) &&
			blocks[i].Type == NodeTypeOrderedList &&
			blocks[i+1].Type == NodeTypeBulletList &&
			blocks[i+2].Type == NodeTypeOrderedList {
			firstOL, midUL, secondOL := blocks[i], blocks[i+1], blocks[i+2]
			expectedStart := topLevelItemCount(firstOL) + 1
			if secondStart, _ := secondOL.Attrs["start"].(int); secondStart == expectedStart {
				merged := mergeOrderedListsAroundBulletInterrupt(firstOL, midUL, secondOL)
				out = append(out, merged)
				i += 3
				continue
			}
		}
		out = append(out, blocks[i])
		i++
	}
	return out
}

// topLevelItemCount counts immediate listItem children of a list node.
// Nested sub-lists don't contribute to the outer list's item count.
func topLevelItemCount(list PMNode) int {
	n := 0
	for _, c := range list.Content {
		if c.Type == NodeTypeListItem {
			n++
		}
	}
	return n
}

// mergeOrderedListsAroundBulletInterrupt rebuilds the first orderedList
// so its last listItem contains the bulletList as a child block, then
// appends every listItem from the second orderedList. The `start`
// attribute on the second half is no longer needed (numbering flows
// continuously through one list now) so it's dropped.
func mergeOrderedListsAroundBulletInterrupt(firstOL, midUL, secondOL PMNode) PMNode {
	merged := PMNode{Type: NodeTypeOrderedList, Content: make([]PMNode, 0, len(firstOL.Content)+len(secondOL.Content))}
	if firstOL.Attrs != nil {
		merged.Attrs = cloneAttrs(firstOL.Attrs)
	}
	merged.Content = append(merged.Content, firstOL.Content...)
	if last := len(merged.Content) - 1; last >= 0 && merged.Content[last].Type == NodeTypeListItem {
		item := merged.Content[last]
		item.Content = append(item.Content, midUL)
		merged.Content[last] = item
	}
	for _, c := range secondOL.Content {
		if c.Type == NodeTypeListItem {
			merged.Content = append(merged.Content, c)
		}
	}
	return merged
}

func listNumID(node PMNode) (string, bool) {
	if node.Type != NodeTypeParagraph {
		return "", false
	}
	v, ok := node.Attrs["_listNumId"].(string)
	return v, ok && v != ""
}

// buildListTree turns a sequence of paragraphs — all sharing one
// numId — into a single nested list node. ilvl drives nesting depth.
//
// The paragraphs come in document order. Whenever the level rises
// (e.g. ilvl 0 -> 1) we open a nested list inside the most recently
// opened listItem; whenever it drops, we close back to the matching
// depth.
func buildListTree(paras []PMNode) PMNode {
	if len(paras) == 0 {
		return PMNode{}
	}
	// Word's docx can emit a same-numId paragraph stream that never
	// reaches ilvl=0 (e.g. a sub-bullet list with its own numId whose
	// only paragraphs are all at ilvl=1, because the emitter wrote
	// them nested inside an outer ordered listItem). buildListTree's
	// frame stack expects the root to be ilvl=0, so a deeper-only
	// stream would trigger the "synthesize empty placeholder" branch
	// once per missing level. Normalize the stream so the shallowest
	// observed level is 0 — the relative nesting is what matters, not
	// the absolute level number.
	minLvl := -1
	for _, p := range paras {
		l := paraLevel(p)
		if minLvl < 0 || l < minLvl {
			minLvl = l
		}
	}
	if minLvl > 0 {
		paras = append([]PMNode(nil), paras...)
		for i := range paras {
			cur := paraLevel(paras[i])
			if paras[i].Attrs == nil {
				paras[i].Attrs = map[string]any{}
			} else {
				paras[i].Attrs = cloneAttrs(paras[i].Attrs)
			}
			paras[i].Attrs["_listLevel"] = cur - minLvl
		}
	}
	rootType := listTypeFromFmt(listFmt(paras[0]))
	root := PMNode{Type: rootType}

	// Stack of (listNode, currentItem) frames; index 0 is the root list.
	type frame struct {
		list *PMNode
		item *PMNode
		lvl  int
	}
	stack := []frame{{list: &root, lvl: 0}}

	for _, para := range paras {
		lvl := paraLevel(para)
		// Pop frames whose level is deeper than this paragraph's level.
		for len(stack) > 1 && stack[len(stack)-1].lvl > lvl {
			stack = stack[:len(stack)-1]
		}
		// If we're going deeper, push a new sub-list under the
		// current top frame's most recent item.
		for stack[len(stack)-1].lvl < lvl {
			parent := stack[len(stack)-1]
			if parent.item == nil {
				// Edge case: list starts at level >0 with no level-0
				// item — synthesize an empty placeholder item so the
				// nesting has a parent.
				newItem := PMNode{Type: NodeTypeListItem, Content: []PMNode{
					{Type: NodeTypeParagraph},
				}}
				parent.list.Content = append(parent.list.Content, newItem)
				parent.item = &parent.list.Content[len(parent.list.Content)-1]
				stack[len(stack)-1] = parent
			}
			subList := PMNode{Type: listTypeFromFmt(listFmt(para))}
			parent.item.Content = append(parent.item.Content, subList)
			subPtr := &parent.item.Content[len(parent.item.Content)-1]
			stack = append(stack, frame{list: subPtr, lvl: parent.lvl + 1})
		}
		// Now stack top is the right list — append a new item.
		top := &stack[len(stack)-1]
		stripped := stripListAttrs(para)
		newItem := PMNode{
			Type:    NodeTypeListItem,
			Content: []PMNode{stripped},
		}
		top.list.Content = append(top.list.Content, newItem)
		top.item = &top.list.Content[len(top.list.Content)-1]
	}
	return root
}

func paraLevel(node PMNode) int {
	if v, ok := node.Attrs["_listLevel"].(int); ok {
		return v
	}
	return 0
}

func listFmt(node PMNode) string {
	if v, ok := node.Attrs["_listFmt"].(string); ok {
		return v
	}
	return ""
}

// listTypeFromFmt maps an OOXML numFmt value onto the PM list-type.
// Only "bullet" maps to bulletList; everything else (decimal,
// lowerLetter, lowerRoman, upperLetter, upperRoman, …) is treated as
// orderedList — ProseMirror's schema only has the binary distinction.
func listTypeFromFmt(fmt string) string {
	if fmt == "bullet" {
		return NodeTypeBulletList
	}
	return NodeTypeOrderedList
}

// stripListAttrs returns a copy of the paragraph with the temporary
// list-tracking attrs removed.
func stripListAttrs(node PMNode) PMNode {
	if node.Attrs == nil {
		return node
	}
	clean := PMNode{
		Type:    node.Type,
		Content: node.Content,
		Text:    node.Text,
		Marks:   node.Marks,
	}
	for k, v := range node.Attrs {
		if k == "_listNumId" || k == "_listLevel" || k == "_listFmt" {
			continue
		}
		if clean.Attrs == nil {
			clean.Attrs = map[string]any{}
		}
		clean.Attrs[k] = v
	}
	return clean
}
