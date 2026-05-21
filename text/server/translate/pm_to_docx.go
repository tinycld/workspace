package translate

// WordZero API notes (from spike):
//
//   Construction:
//     doc := document.New()                                  -> *Document
//
//   Block-level adders (each returns the *Paragraph for further mutation):
//     doc.AddParagraph(text)                                 -> normal paragraph
//     doc.AddFormattedParagraph(text, *TextFormat)           -> first run is formatted
//     doc.AddHeadingParagraph(text, level int)               -> Heading{level}
//     doc.AddBulletList(text, level int, BulletType)         -> bullet list item
//     doc.AddNumberedList(text, level int, ListType)         -> ordered list item
//     doc.AddTable(*TableConfig)                             -> (*Table, error)
//
//   Inline runs on a paragraph:
//     p.AddFormattedText(text string, *TextFormat)           -> appends a run
//     TextFormat fields used: Bold, Italic, Underline (bool); FontColor (hex string)
//
//   Tables:
//     tbl, _ := doc.AddTable(&document.TableConfig{Rows, Cols, ColWidths})
//     tbl.AddCellParagraph(row, col, text)                   -> append a paragraph to a cell
//     tbl.SetCellText(row, col, text)                        -> replace cell with one run
//     tbl.AddCellFormattedText(row, col, text, *TextFormat)  -> append formatted run
//     tbl.ClearCellParagraphs(row, col)                      -> drop the default empty paragraph
//
//   Images:
//     doc.AddImageFromData(data []byte, name, ImageFormat, w, h, *ImageConfig)
//
//   Save / load:
//     doc.ToBytes() ([]byte, error)                          -> in-memory save (used here)
//     doc.Save(path string) error                            -> file save
//     document.OpenFromMemory(io.ReadCloser) (*Document, error)
//
//   Limitations relevant to v1:
//     - The Paragraph struct only exposes Runs []Run; there is no
//       hyperlink container at the public API level. To inject
//       <w:hyperlink r:id="rIdN"> wrappers around runs, we
//       post-process the saved zip: rewrite word/document.xml
//       (replace marker tokens with hyperlink open/close tags) and
//       extend word/_rels/document.xml.rels with the matching
//       Relationship rows. See pmToDocxLinkPostProcess().
//     - Blockquote: WordZero accepts SetStyle("Quote") on a
//       paragraph, but the default styles.xml doesn't define a Quote
//       style, so the visual rendering is unstyled. The pStyle pPr
//       does survive round-trip, which is what matters for fidelity.

import (
	"archive/zip"
	"bytes"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"net/url"
	"strconv"
	"strings"
	"sync"

	"github.com/ZeroHawkeye/wordZero/pkg/document"
)

// numberingMu serializes WordZero document emission across concurrent
// callers. WordZero's document package keeps a process-global
// NumberingManager singleton that allocates <w:numId> values; two
// goroutines flushing different rooms at the same time race for that
// counter and can interleave numbering definitions across documents,
// producing malformed list output. The emit path is short and runs off
// the SaveCoordinator's worker pool, so the contention cost of a single
// package-level mutex is acceptable v1; revisit if we replace WordZero.
var numberingMu sync.Mutex

// Silence WordZero's INFO-level chatter — every table create / cell
// clear / cell add prints to stdout by default. Errors still flow
// through err returns. We never want this in tests or production.
func init() {
	document.SetGlobalLevel(document.LogLevelSilent)
}

// MaxImageBytes caps a single embedded image at 4 MiB. Larger images
// are dropped with WarningImageTooLarge rather than embedded — the
// limit bounds the memory cost of round-tripping a docx that contains
// a hostile or accidentally enormous data: URI from the client.
const MaxImageBytes = 4 * 1024 * 1024

// allowedImageMediaTypes is the whitelist of data: URI media types the
// emitter embeds. Anything outside (image/svg+xml, image/bmp, …) is
// dropped with WarningUnsupportedImageType — Word rejects unknown image
// parts and SVG specifically would require rasterization we don't
// perform.
var allowedImageMediaTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/jpg":  true,
	"image/gif":  true,
	"image/webp": true,
}

// PMJSONToDocx translates a ProseMirror JSON tree into .docx bytes.
// Returns an error if the JSON is malformed or contains node/mark
// types outside the supported set.
//
// Soft degradations (e.g. an oversized image dropped) are silently
// discarded by this wrapper. Callers that want to surface them to the
// user should use PMJSONToDocxWithWarnings instead.
//
// Implementation strategy: drive WordZero for the bulk of the
// document (paragraphs, headings, lists, tables, blockquote-styled
// paragraphs, inline images). Hyperlinks are emitted as marker text
// runs, then post-processed: the marker tokens in word/document.xml
// are rewritten as <w:hyperlink r:id=…> wrappers and matching
// Relationship rows are appended to word/_rels/document.xml.rels.
func PMJSONToDocx(pmJSON []byte) ([]byte, error) {
	bs, _, err := PMJSONToDocxWithWarnings(pmJSON)
	return bs, err
}

// PMJSONToDocxWithResolver is the variant the server flush uses: it
// supplies an ImageResolver so inserted drive-file images (stored as
// /api/files/drive_items/<id>/<file> URLs, not data: URIs) can be
// fetched and embedded. A nil resolver behaves exactly like
// PMJSONToDocx — drive URLs are rejected.
func PMJSONToDocxWithResolver(pmJSON []byte, resolver ImageResolver) ([]byte, []Warning, error) {
	return pmJSONToDocx(pmJSON, resolver)
}

// PMJSONToDocxWithWarnings is the warnings-aware variant of
// PMJSONToDocx. The returned slice contains every soft-degradation
// signal the emitter raised (e.g. an oversized image was dropped) —
// hard errors still come back via the error return.
func PMJSONToDocxWithWarnings(pmJSON []byte) ([]byte, []Warning, error) {
	return pmJSONToDocx(pmJSON, nil)
}

func pmJSONToDocx(pmJSON []byte, resolver ImageResolver) ([]byte, []Warning, error) {
	var root PMNode
	if err := json.Unmarshal(pmJSON, &root); err != nil {
		return nil, nil, fmt.Errorf("translate: unmarshal pmJSON: %w", err)
	}
	if root.Type != NodeTypeDoc {
		return nil, nil, fmt.Errorf("translate: pmJSON root must be type=doc, got %q", root.Type)
	}

	// Hold numberingMu across the entire emit + serialize so every call
	// that might touch WordZero's global NumberingManager (AddBulletList /
	// AddNumberedList allocations, plus ToBytes which materializes
	// numbering.xml from that shared state) is serialized.
	numberingMu.Lock()
	defer numberingMu.Unlock()

	em := newEmitter()
	em.imageResolver = resolver
	for _, child := range root.Content {
		if err := em.emitBlock(child, 0, ""); err != nil {
			return nil, nil, err
		}
	}

	bs, err := em.doc.ToBytes()
	if err != nil {
		return nil, nil, fmt.Errorf("translate: serialize docx: %w", err)
	}

	if len(em.linkRels) > 0 {
		bs, err = postProcessLinks(bs, em.linkRels)
		if err != nil {
			return nil, nil, err
		}
	}
	if len(em.pageBreaks) > 0 || len(em.commentSpans) > 0 || len(em.footnotes) > 0 || len(em.endnotes) > 0 || len(em.codeMarks) > 0 || len(em.bgColorSpans) > 0 {
		bs, err = postProcessRichXML(bs, em)
		if err != nil {
			return nil, nil, err
		}
	}
	return bs, em.warnings, nil
}

// emitter wraps a fresh WordZero document with the side state we
// need across recursive emitBlock calls — the chosen numId for the
// current top-level list, and the set of hyperlink relationships to
// be patched in post-process.
//
// listScope tracks which numId to use for the current bulletList /
// orderedList (and its nested children); set when we enter a list
// and cleared on exit. Reusing a numId across the items of one
// logical PM list is essential — WordZero's AddListItem allocates a
// fresh numId per call, which would (a) break round-trip grouping
// in the parser and (b) make every "bullet" render as a distinct
// list of one.
type emitter struct {
	doc       *document.Document
	linkRels  []linkRel
	linkSeq   int      // monotonic id for marker tokens
	listScope []string // numIds keyed by depth — one entry per nested list
	// lastOrderedNumIDAtLevel0 is the most recent level-0 ordered-list
	// numId we've emitted in this document, surviving across sibling
	// lists. When a later orderedList carries start > 1, we reuse this
	// numId so OOXML's natural numbering continuation produces the
	// expected resumed numbers (Word's behavior when an ordered list is
	// visually interrupted by a nested bulleted list and then resumed).
	lastOrderedNumIDAtLevel0 string

	// Page break / comment / footnote / endnote post-process state.
	// Each feature uses the same marker-token strategy that links use:
	// we plant uniquely-recognizable strings inside the WordZero output,
	// then rewrite them in postProcess* passes once WordZero has
	// finished serializing the body. Marker IDs are independent monotonic
	// counters per kind.
	pageBreaks     []pageBreakMarker
	pageBreakSeq   int
	commentSpans   []commentSpan
	commentSpanSeq int // monotonic uniqueness counter for marker tokens
	commentIDSeq   int // OOXML w:id allocator for synthesized ids
	// Authored comments accumulated during emission, keyed by the
	// runtime comment id we assigned. Each entry feeds one <w:comment>
	// in word/comments.xml on flush.
	commentBodies map[string]commentBody
	footnotes     []footnoteEntry
	endnotes      []footnoteEntry
	footnoteSeq   int
	endnoteSeq    int

	// codeMarks tracks each inline code-marked run as an (open marker,
	// close marker) pair. WordZero's RunProperties struct has no
	// rStyle field, so we wrap the marked text in marker text runs and
	// rewrite document.xml after WordZero serializes — splicing the
	// markers out and injecting <w:rStyle w:val="VerbatimChar"/> into
	// the surviving run's <w:rPr>. Same marker-token strategy as
	// links / comments / page breaks (see postProcessRichXML).
	codeMarks   []codeMarkSpan
	codeMarkSeq int

	// bgColorSpans tracks each inline backgroundColor-styled run.
	// WordZero's RunProperties has no Shd field (only Highlight, which
	// is limited to a fixed 17-color named palette), so we apply the
	// same marker-token strategy used for code marks: wrap the run in
	// open/close markers at emit time and rewrite document.xml in the
	// post-process pass, splicing the markers out and injecting
	// <w:shd w:val="clear" w:color="auto" w:fill="RRGGBB"/> into the
	// surviving run's <w:rPr>.
	bgColorSpans []bgColorSpan
	bgColorSeq   int

	// warnings accumulates soft-degradation signals raised during
	// emission (currently: oversized / unsupported-type images dropped).
	// Surfaced by PMJSONToDocxWithWarnings; the legacy PMJSONToDocx
	// signature drops them silently.
	warnings   []Warning
	warningSet map[WarningCode]struct{}

	// imageResolver fetches the bytes for a drive-file image src
	// (/api/files/drive_items/<id>/<file>). The editor inserts images as
	// drive URLs (not data: URIs) to keep the Y.Doc small, but docx has
	// to embed the actual bytes — so the server flush injects a resolver
	// backed by the PocketBase filesystem. nil for non-server callers
	// (tests, future direct callers), which then reject drive URLs the
	// same way they always have.
	imageResolver ImageResolver
}

// ImageResolver returns the raw bytes for an inserted drive-file image,
// identified by the drive_items record id and the stored file name parsed
// out of an /api/files/drive_items/<id>/<file> src. Returning an error
// aborts the flush (the image can't be embedded, so the docx would be
// lossy); the server's SaveCoordinator retries.
type ImageResolver func(driveItemID, fileName string) ([]byte, error)

// pageBreakMarker tracks a single page-break PM node that emit time
// recorded; postProcessPageBreaks rewrites the marker text run into
// <w:br w:type="page"/> inside the surrounding paragraph.
type pageBreakMarker struct {
	Marker string
}

// commentSpan tracks one PM comment mark span as a (open marker, close
// marker, id) triple. Two PM runs are wrapped at emit time:
//   - {{__pmcm:N:open}} just before the first masked text
//   - {{__pmcm:N:close}} just after the last masked text
//
// Post-process rewrites both into <w:commentRangeStart/> and
// <w:commentRangeEnd/> + <w:commentReference w:id="N"/>.
type commentSpan struct {
	OpenMarker  string
	CloseMarker string
	ID          string
}

// commentBody is what we'll serialize into word/comments.xml on flush —
// one entry per comment, populated from the PM mark attrs.
type commentBody struct {
	ID     string
	Author string
	Text   string
	Date   string
}

// footnoteEntry holds one footnote (or endnote) body we accumulated
// during emission. ID is the OOXML id (1-based, with 1+ reserved for
// user notes since Word seeds 0 = separator). MarkerText is the inline
// token we substitute into <w:footnoteReference w:id="ID"/> later.
type footnoteEntry struct {
	ID     string
	Text   string
	Marker string
}

// addWarning records a unique soft-degradation signal. Same dedupe
// behaviour as the docxParser-side addWarning: one entry per code,
// since the user only cares "did images get dropped?", not "how many."
func (em *emitter) addWarning(code WarningCode, detail string) {
	if em.warningSet == nil {
		em.warningSet = make(map[WarningCode]struct{})
	}
	if _, seen := em.warningSet[code]; seen {
		return
	}
	em.warningSet[code] = struct{}{}
	em.warnings = append(em.warnings, Warning{Code: code, Detail: detail})
}

type linkRel struct {
	Marker string // {{__pmlink:N:open}} … {{__pmlink:N:close}}
	Href   string
}

// codeMarkSpan tracks one inline code-marked run. The open + close
// marker text runs flank the real run in document.xml so the
// post-process pass can locate the middle run and stamp
// <w:rStyle w:val="VerbatimChar"/> onto its <w:rPr>.
type codeMarkSpan struct {
	OpenMarker  string
	CloseMarker string
}

// bgColorSpan tracks one inline backgroundColor run. Hex is the
// 6-digit RRGGBB (no leading '#') that gets written verbatim into
// <w:shd w:fill="…">. Same marker-flanking shape as codeMarkSpan.
type bgColorSpan struct {
	OpenMarker  string
	CloseMarker string
	Hex         string
}

func newEmitter() *emitter {
	return &emitter{doc: document.New()}
}

// emitBlock dispatches on a block-level PMNode type. parentList is
// the WordZero list type we're inside (when called recursively from
// within a list item); listLevel is the current nesting depth.
func (em *emitter) emitBlock(node PMNode, listLevel int, parentList string) error {
	switch node.Type {
	case NodeTypeParagraph:
		return em.emitParagraph(node, listLevel, parentList)
	case NodeTypeHeading:
		return em.emitHeading(node)
	case NodeTypeBulletList:
		return em.emitList(node, listLevel, NodeTypeBulletList)
	case NodeTypeOrderedList:
		return em.emitList(node, listLevel, NodeTypeOrderedList)
	case NodeTypeBlockquote:
		return em.emitBlockquote(node)
	case NodeTypeCodeBlock:
		return em.emitCodeBlock(node)
	case NodeTypeTable:
		return em.emitTable(node)
	case NodeTypeImage:
		return em.emitImageBlock(node)
	default:
		return fmt.Errorf("translate: unsupported block node type %q", node.Type)
	}
}

// emitParagraph emits a normal paragraph (or, when called inside a
// list, the list-item's paragraph that carries the numId+ilvl into
// OOXML).
func (em *emitter) emitParagraph(node PMNode, listLevel int, parentList string) error {
	if parentList != "" {
		return em.emitListParagraph(node, listLevel, parentList)
	}
	p := em.doc.AddParagraph("")
	applyAlignIndent(p, node.Attrs)
	return em.emitInlineRuns(p, node.Content)
}

// applyAlignIndent writes textAlign and indent attrs onto a
// WordZero paragraph as <w:jc> and <w:ind w:left>. Defaults
// ("left" / 0) are silently no-ops so the produced pPr stays empty
// for the common case.
//
// Indent is set by manipulating the Indentation struct directly
// (instead of calling SetIndentation, which converts cm -> twips
// lossily). One PM level == 720 twips, matching the importer.
func applyAlignIndent(p *document.Paragraph, attrs map[string]any) {
	if p == nil || attrs == nil {
		return
	}
	if v, ok := attrs["textAlign"].(string); ok {
		if oox := pmAlignToOOXML(v); oox != "" {
			p.SetAlignment(document.AlignmentType(oox))
		}
	}
	if level := indentLevelFromAttrs(attrs); level > 0 {
		if p.Properties == nil {
			p.Properties = &document.ParagraphProperties{}
		}
		if p.Properties.Indentation == nil {
			p.Properties.Indentation = &document.Indentation{}
		}
		p.Properties.Indentation.Left = strconv.Itoa(level * twipsPerIndentLevel)
	}
}

// pmAlignToOOXML maps PM textAlign values to <w:jc w:val=…>. Empty
// string means "no attribute" — left is the default and we omit it
// so the resulting docx is byte-identical to one Word would have
// produced for an unaligned paragraph.
func pmAlignToOOXML(v string) string {
	switch v {
	case "center":
		return "center"
	case "right":
		return "right"
	case "justify":
		return "both"
	default:
		return ""
	}
}

// indentLevelFromAttrs extracts the indent level from a PM attrs
// map, clamped to 0..MaxIndentLevel. JSON decoded numbers arrive as
// float64; ints are handled too for direct in-process callers.
func indentLevelFromAttrs(attrs map[string]any) int {
	raw, ok := attrs["indent"]
	if !ok {
		return 0
	}
	var level int
	switch n := raw.(type) {
	case float64:
		level = int(n)
	case int:
		level = n
	default:
		return 0
	}
	if level < 0 {
		return 0
	}
	if level > MaxIndentLevel {
		return MaxIndentLevel
	}
	return level
}

// emitListParagraph appends one list-item paragraph. The first
// item of a brand-new logical list calls AddBulletList /
// AddNumberedList so WordZero's NumberingManager seeds the
// numbering.xml entry; subsequent items reuse that same numId
// directly (via Body.AddElement on a hand-built Paragraph), which
// keeps all items of one logical PM list grouped under one numId in
// OOXML — that's what the parser uses to reconstruct the list shape.
func (em *emitter) emitListParagraph(node PMNode, listLevel int, parentList string) error {
	var p *document.Paragraph
	if listLevel < len(em.listScope) && em.listScope[listLevel] != "" {
		// Reuse — append a paragraph whose numId we know.
		p = em.appendListParagraphReusingNumID(em.listScope[listLevel], listLevel)
	} else {
		// First item of this list — let WordZero allocate the numId.
		p = em.appendFirstListParagraph(parentList, listLevel)
		em.recordListNumID(listLevel, extractNumID(p))
	}
	return em.emitInlineRuns(p, node.Content)
}

// appendFirstListParagraph creates the first paragraph in a new
// logical list — used to coax WordZero into allocating a fresh numId
// and seeding numbering.xml.
func (em *emitter) appendFirstListParagraph(listType string, level int) *document.Paragraph {
	if listType == NodeTypeBulletList {
		return em.doc.AddBulletList("", level, document.BulletTypeDot)
	}
	return em.doc.AddNumberedList("", level, document.ListTypeDecimal)
}

// appendListParagraphReusingNumID appends a paragraph whose pPr
// references the given numId+ilvl, bypassing WordZero's numbering
// allocator (which would burn a fresh numId).
func (em *emitter) appendListParagraphReusingNumID(numID string, level int) *document.Paragraph {
	p := &document.Paragraph{
		Properties: &document.ParagraphProperties{
			NumberingProperties: &document.NumberingProperties{
				ILevel: &document.ILevel{Val: strconv.Itoa(level)},
				NumID:  &document.NumID{Val: numID},
			},
		},
	}
	em.doc.Body.AddElement(p)
	return p
}

// recordListNumID stores the numId for the current depth so the
// next sibling list-item at the same depth can reuse it.
func (em *emitter) recordListNumID(level int, numID string) {
	for len(em.listScope) <= level {
		em.listScope = append(em.listScope, "")
	}
	em.listScope[level] = numID
}

// extractNumID pulls the numId WordZero allocated for a list
// paragraph out of its ParagraphProperties. Returns "" if the
// structure is unexpected (which shouldn't happen for paragraphs
// returned by AddBulletList / AddNumberedList).
func extractNumID(p *document.Paragraph) string {
	if p == nil || p.Properties == nil || p.Properties.NumberingProperties == nil {
		return ""
	}
	if p.Properties.NumberingProperties.NumID == nil {
		return ""
	}
	return p.Properties.NumberingProperties.NumID.Val
}

// emitHeading adds a heading paragraph at the given level (clamped
// to 1..6 per the v1 schema), then re-applies the runs so each
// portion can carry its own marks.
func (em *emitter) emitHeading(node PMNode) error {
	level := 1
	if v, ok := node.Attrs["level"].(float64); ok {
		level = int(v)
	}
	if level < 1 {
		level = 1
	}
	if level > 6 {
		level = 6
	}
	p := em.doc.AddHeadingParagraph("", level)
	applyAlignIndent(p, node.Attrs)
	return em.emitInlineRuns(p, node.Content)
}

// emitList recursively emits a bulletList or orderedList. PM nests
// listItems containing paragraphs; OOXML uses a flat paragraph
// stream with shared numId. We collapse PM's structure onto a flat
// stream, propagating the level through nested recursive calls and
// reusing numIds within one logical list.
//
// The listScope slot at this depth is cleared on entry and reset
// when we leave the call; that way two sibling top-level lists each
// get their own numId (correct behavior — different lists shouldn't
// share numbering).
func (em *emitter) emitList(node PMNode, listLevel int, listType string) error {
	prevScope := em.listScope
	em.listScope = makeFreshScope(prevScope, listLevel)
	defer func() { em.listScope = prevScope }()

	// Resumed ordered list: if PM has marked this list with start > 1
	// AND we have a prior level-0 ordered-list numId available, seed
	// the scope with it so all items in this list reuse that same numId.
	// In OOXML, sharing a numId across visually separate lists is how
	// Word implements numbering continuation past nested interruptions.
	if listLevel == 0 && listType == NodeTypeOrderedList && em.lastOrderedNumIDAtLevel0 != "" {
		if startVal, ok := node.Attrs["start"]; ok && asInt(startVal) > 1 {
			em.recordListNumID(0, em.lastOrderedNumIDAtLevel0)
		}
	}

	for _, item := range node.Content {
		if item.Type != NodeTypeListItem {
			return fmt.Errorf("translate: %s child must be listItem, got %q", listType, item.Type)
		}
		for _, child := range item.Content {
			switch child.Type {
			case NodeTypeParagraph:
				if err := em.emitBlock(child, listLevel, listType); err != nil {
					return err
				}
			case NodeTypeBulletList, NodeTypeOrderedList:
				if err := em.emitList(child, listLevel+1, child.Type); err != nil {
					return err
				}
			default:
				return fmt.Errorf("translate: unsupported listItem child %q", child.Type)
			}
		}
	}

	// After emitting a level-0 ordered list, remember its numId so a
	// subsequent resumed list can reuse it.
	if listLevel == 0 && listType == NodeTypeOrderedList && listLevel < len(em.listScope) {
		if numID := em.listScope[0]; numID != "" {
			em.lastOrderedNumIDAtLevel0 = numID
		}
	}
	return nil
}

// asInt coerces a JSON-decoded number (float64) or int to int. Returns
// 0 for any other type.
func asInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	}
	return 0
}

// makeFreshScope returns a copy of prev with the slot at level
// (and all deeper slots) cleared. Used when entering a new logical
// list — we want to allocate a fresh numId for it, not reuse a
// previous sibling list's numId.
func makeFreshScope(prev []string, level int) []string {
	out := make([]string, len(prev))
	copy(out, prev)
	for i := level; i < len(out); i++ {
		out[i] = ""
	}
	return out
}

// emitBlockquote unwraps a blockquote into its child paragraphs,
// applying the "Quote" pStyle to each one. PM nests paragraphs
// inside the blockquote; OOXML has no real container element for
// blockquotes, so we mark each paragraph individually.
func (em *emitter) emitBlockquote(node PMNode) error {
	for _, child := range node.Content {
		switch child.Type {
		case NodeTypeParagraph:
			p := em.doc.AddParagraph("")
			p.SetStyle("Quote")
			if err := em.emitInlineRuns(p, child.Content); err != nil {
				return err
			}
		default:
			return fmt.Errorf("translate: unsupported blockquote child %q", child.Type)
		}
	}
	return nil
}

// emitCodeBlock emits a paragraph with pStyle="CodeBlock" carrying
// the node's plain-text content. The PM codeBlock schema doesn't
// allow inline marks, so we pass an empty TextFormat — no bold,
// italic, link, or comment marks flow through. On import, four
// pStyle aliases (CodeBlock / Code / HTMLPreformatted / Preformatted)
// all round-trip back to NodeTypeCodeBlock, but the exporter only
// writes the canonical "CodeBlock" name so a save normalizes the
// document to one consistent style.
func (em *emitter) emitCodeBlock(node PMNode) error {
	p := em.doc.AddParagraph("")
	p.SetStyle("CodeBlock")
	empty := &document.TextFormat{}
	for _, child := range node.Content {
		if child.Type != NodeTypeText {
			continue
		}
		if child.Text == "" {
			continue
		}
		p.AddFormattedText(child.Text, empty)
	}
	return nil
}

// emitTable creates a WordZero table sized to the PM rows/cols and
// pours each cell's content into AddCellParagraph / AddFormattedText.
//
// Column widths: PM tableCell.colwidth (px, one entry per spanned
// column) is converted back to dxa and seeded into the table's grid
// + per-cell <w:tcW>. We compute the per-column dxa array by walking
// the first row and unrolling each cell's colwidth across colspan
// slots. Cells with colspan > 1 are then merged with
// MergeCellsHorizontal so OOXML re-derives the same grid layout.
func (em *emitter) emitTable(node PMNode) error {
	rows := len(node.Content)
	if rows == 0 {
		return nil
	}
	cols, colDxa := tableGeometry(node)
	if cols == 0 {
		return nil
	}
	cfg := &document.TableConfig{Rows: rows, Cols: cols}
	if len(colDxa) == cols {
		cfg.ColWidths = colDxa
	}
	tbl, err := em.doc.AddTable(cfg)
	if err != nil {
		return fmt.Errorf("translate: create table: %w", err)
	}

	// Two-pass emit so vertical and horizontal merges don't interfere.
	//
	//   Pass A — emit content + collect merge plans. Walks rows and
	//     places each PM cell at its physical column index. Tracks
	//     vertically-covered columns via vCover[] so PM's "missing"
	//     cells under rowspan>1 starts don't shift the cursor. Records
	//     each colspan>1 cell as a deferred horizontal-merge, and each
	//     rowspan>1 cell as a deferred vertical-merge.
	//
	//   Pass B — apply all vertical merges first. WordZero's
	//     MergeCellsVertical doesn't change row cell counts (only
	//     stamps <w:vMerge> on the spanned-over cells), so it's safe
	//     to run before horizontal merges per-row.
	//
	//   Pass C — apply horizontal merges per-row, right-to-left.
	//     MergeCellsHorizontal splices cells out, so iterating in
	//     reverse keeps earlier merge indices valid.
	type hMerge struct{ row, start, end int }
	type vMerge struct{ startRow, endRow, col int }
	var hMerges []hMerge
	var vMerges []vMerge
	// vCover[c] = remaining rows after the current one that are still
	// covered by an earlier cell's rowspan at column c. Decremented at
	// the end of each row.
	vCover := make([]int, cols)
	for r, row := range node.Content {
		if row.Type != NodeTypeTableRow {
			continue
		}
		col := 0
		for _, cell := range row.Content {
			if cell.Type != NodeTypeTableCell {
				continue
			}
			// Skip columns that are vertically covered by a prior
			// rowspan>1 cell. PM omits the placeholder cells under a
			// rowspan, so we have to advance the cursor without
			// emitting anything.
			for col < cols && vCover[col] > 0 {
				col++
			}
			if col >= cols {
				break
			}
			span := cellColspan(cell)
			rspan := cellRowspan(cell)
			if err := em.emitTableCell(tbl, r, col, cell); err != nil {
				return err
			}
			if span > 1 {
				end := col + span - 1
				if end >= cols {
					end = cols - 1
				}
				hMerges = append(hMerges, hMerge{r, col, end})
			}
			if rspan > 1 {
				endRow := r + rspan - 1
				if endRow >= rows {
					endRow = rows - 1
				}
				if endRow > r {
					vMerges = append(vMerges, vMerge{r, endRow, col})
					// Record the rowspan coverage for every spanned
					// column so subsequent rows skip them.
					for c := col; c < col+span && c < cols; c++ {
						vCover[c] = (endRow - r) + 1
					}
				}
			}
			col += span
		}
		// End-of-row: decrement coverage so the next row sees one
		// fewer row of cover.
		for c := range vCover {
			if vCover[c] > 0 {
				vCover[c]--
			}
		}
	}

	// Pass B — vertical merges first (no cell-count change).
	for _, v := range vMerges {
		if err := tbl.MergeCellsVertical(v.startRow, v.endRow, v.col); err != nil {
			return fmt.Errorf("translate: merge cells vertical [%d..%d],%d: %w", v.startRow, v.endRow, v.col, err)
		}
	}

	// Pass C — horizontal merges per row, right-to-left.
	hByRow := make(map[int][]hMerge, len(hMerges))
	for _, m := range hMerges {
		hByRow[m.row] = append(hByRow[m.row], m)
	}
	for r := range node.Content {
		rowMerges := hByRow[r]
		for i := len(rowMerges) - 1; i >= 0; i-- {
			m := rowMerges[i]
			// Sum the spanned dxa widths so the surviving cell's <w:tcW>
			// reflects the full merged width. Without this, WordZero
			// keeps the start cell's own (unmerged) width and re-import
			// would split the visible width across gridSpan, halving
			// each spanned column's recorded size every round-trip.
			merged := 0
			if len(colDxa) == cols {
				for c := m.start; c <= m.end && c < len(colDxa); c++ {
					merged += colDxa[c]
				}
			}
			if err := tbl.MergeCellsHorizontal(m.row, m.start, m.end); err != nil {
				return fmt.Errorf("translate: merge cells %d,[%d..%d]: %w", m.row, m.start, m.end, err)
			}
			if merged > 0 {
				if c, err := tbl.GetCell(m.row, m.start); err == nil {
					if c.Properties == nil {
						c.Properties = &document.TableCellProperties{}
					}
					if c.Properties.TableCellW == nil {
						c.Properties.TableCellW = &document.TableCellW{Type: "dxa"}
					}
					c.Properties.TableCellW.W = strconv.Itoa(merged)
					c.Properties.TableCellW.Type = "dxa"
				}
			}
		}
	}
	return nil
}

// tableGeometry counts physical columns and computes a per-column dxa
// width array, both derived from the first row that carries colwidth
// data. Falls back to (max cell count across rows, no widths) when no
// row carries widths, which yields a default auto-sized table.
func tableGeometry(table PMNode) (int, []int) {
	maxCells := 0
	for _, row := range table.Content {
		if row.Type == NodeTypeTableRow {
			if c := len(row.Content); c > maxCells {
				maxCells = c
			}
		}
	}
	// Look for the first row that has colwidth on every cell — that's
	// the row we trust to define the physical grid. The first row of
	// a Word table almost always carries widths even if downstream
	// rows have merged cells; that's the row we want.
	for _, row := range table.Content {
		if row.Type != NodeTypeTableRow {
			continue
		}
		widths := []int{}
		ok := true
		totalCols := 0
		for _, cell := range row.Content {
			if cell.Type != NodeTypeTableCell {
				continue
			}
			span := cellColspan(cell)
			cw, hasCW := cellColwidthPx(cell)
			if !hasCW || len(cw) == 0 {
				ok = false
				break
			}
			// colwidth is per-spanned-col in PM. Translate each entry
			// back to dxa and place it into the column grid.
			for i := 0; i < span; i++ {
				if i < len(cw) {
					widths = append(widths, pxToDxa(cw[i]))
				} else {
					// Fewer colwidth entries than span — duplicate the
					// last one across the remainder.
					widths = append(widths, pxToDxa(cw[len(cw)-1]))
				}
			}
			totalCols += span
		}
		if ok && totalCols > 0 {
			if totalCols > maxCells {
				maxCells = totalCols
			}
			return totalCols, widths
		}
	}
	return maxCells, nil
}

// cellColspan reads colspan off a tableCell, defaulting to 1.
func cellColspan(cell PMNode) int {
	if cell.Attrs == nil {
		return 1
	}
	if v, ok := cell.Attrs["colspan"]; ok {
		if n := asInt(v); n > 0 {
			return n
		}
	}
	return 1
}

// cellRowspan reads rowspan off a tableCell, defaulting to 1. Parallel
// to cellColspan — rowspan>1 means the cell vertically spans the next
// (rowspan-1) rows, which gets emitted as <w:vMerge> via
// MergeCellsVertical.
func cellRowspan(cell PMNode) int {
	if cell.Attrs == nil {
		return 1
	}
	if v, ok := cell.Attrs["rowspan"]; ok {
		if n := asInt(v); n > 0 {
			return n
		}
	}
	return 1
}

// cellColwidthPx reads colwidth off a tableCell as an int slice (px).
// Returns (nil, false) if the attr is missing or shaped unexpectedly.
func cellColwidthPx(cell PMNode) ([]int, bool) {
	if cell.Attrs == nil {
		return nil, false
	}
	raw, ok := cell.Attrs["colwidth"]
	if !ok {
		return nil, false
	}
	arr, ok := raw.([]any)
	if !ok {
		// Already an []int (when called from internal Go code rather
		// than after JSON unmarshal).
		if a, ok2 := raw.([]int); ok2 {
			return a, true
		}
		return nil, false
	}
	out := make([]int, 0, len(arr))
	for _, v := range arr {
		out = append(out, asInt(v))
	}
	return out, true
}

// pxToDxa is the inverse of dxaToPx (1 dxa ≈ 1/15 px at 96 dpi).
func pxToDxa(px int) int {
	if px <= 0 {
		return 0
	}
	return px * 15
}

// emitTableCell writes one cell. We clear the default placeholder
// paragraph WordZero seeded into the cell, then append a paragraph
// per PM child paragraph and pour runs into it.
//
// Caveat: WordZero's ClearCellParagraphs + AddCellParagraph still
// leaves an extra empty <w:p> in each cell. The round-trip test
// works around this by concatenating text from all paragraphs in
// each cell — a faithful round-trip would need either a WordZero fix
// or hand-rolling the cell XML. Acceptable for v1 since the visible
// content survives intact.
func (em *emitter) emitTableCell(tbl *document.Table, row, col int, cell PMNode) error {
	if err := tbl.ClearCellParagraphs(row, col); err != nil {
		return fmt.Errorf("translate: clear cell %d,%d: %w", row, col, err)
	}
	for _, child := range cell.Content {
		if child.Type != NodeTypeParagraph {
			// The v1 .docx exporter can't represent block content other
			// than paragraphs inside a cell (e.g. a nested table or a
			// list). Rather than fail the whole conversion — which would
			// strand the document's realtime saves in an infinite retry
			// loop — flatten the child's text into a plain paragraph so
			// the visible content survives, and record a warning. Cells
			// with no extractable text are dropped silently.
			text := collectNodeText(child)
			if text != "" {
				para, err := tbl.AddCellParagraph(row, col, "")
				if err != nil {
					return fmt.Errorf("translate: add cell para: %w", err)
				}
				para.AddFormattedText(text, &document.TextFormat{})
			}
			em.addWarning(WarningCellContentFlattened,
				fmt.Sprintf("table cell %q content flattened to plain text", child.Type))
			continue
		}
		para, err := tbl.AddCellParagraph(row, col, "")
		if err != nil {
			return fmt.Errorf("translate: add cell para: %w", err)
		}
		if err := em.emitInlineRuns(para, child.Content); err != nil {
			return err
		}
	}
	// Borders + shading on the cell flow through to <w:tcBorders> /
	// <w:shd>. Both happen after the paragraph emission because
	// GetCell needs the cell to exist in the underlying table model.
	if borders := tcBordersFromAttr(cell.Attrs); borders != nil {
		c, err := tbl.GetCell(row, col)
		if err == nil && c != nil {
			if c.Properties == nil {
				c.Properties = &document.TableCellProperties{}
			}
			c.Properties.TcBorders = borders
		}
	}
	if shading := tcShadingFromAttr(cell.Attrs); shading != nil {
		c, err := tbl.GetCell(row, col)
		if err == nil && c != nil {
			if c.Properties == nil {
				c.Properties = &document.TableCellProperties{}
			}
			c.Properties.Shd = shading
		}
	}
	return nil
}

// collectNodeText walks a PM subtree and concatenates the text of every
// descendant text node, separating the contributions of distinct block
// children with a single space so e.g. a nested table's cells don't run
// together into one unreadable word. Inline siblings within one block
// are joined without a separator (they're already contiguous text). Used
// to salvage the visible content of cell children the v1 exporter can't
// represent structurally.
func collectNodeText(node PMNode) string {
	if node.Type == NodeTypeText {
		return node.Text
	}
	var parts []string
	for _, child := range node.Content {
		if t := collectNodeText(child); t != "" {
			parts = append(parts, t)
		}
	}
	return strings.Join(parts, " ")
}

// emitImageBlock embeds a block-level image. v1 supports data: URIs
// and embedded images via AddImageFromData. Network URLs are
// rejected for now (caller should pre-fetch); see report.
//
// PM attrs map to WordZero's ImageConfig:
//   - wrap="left"  -> Position: floatLeft,  WrapText: square
//   - wrap="right" -> Position: floatRight, WrapText: square
//   - wrap absent / "none" -> default inline drawing
//
// We choose `square` (not `tight`) for the wrap mode because square
// requires no wrap polygon and renders identically for rectangular
// images. tight requires a per-image polygon we don't store.
func (em *emitter) emitImageBlock(node PMNode) error {
	src, _ := node.Attrs["src"].(string)
	if src == "" {
		return fmt.Errorf("translate: image node missing src attr")
	}
	data, format, skip, err := em.decodeAndValidateImage(src)
	if err != nil {
		return err
	}
	if skip {
		return nil
	}
	cfg := &document.ImageConfig{}
	if alt, ok := node.Attrs["alt"].(string); ok && alt != "" {
		cfg.AltText = alt
	}
	if title, ok := node.Attrs["title"].(string); ok && title != "" {
		cfg.Title = title
	}
	applyImageWrap(cfg, node.Attrs)
	// PM JSON numbers unmarshal as float64; cast to int. Zero / absent
	// keeps the existing behaviour ("auto from image bytes"). WordZero
	// multiplies these pixel values by 9525 to fill <wp:extent cx/cy>
	// in EMUs, the inverse of docx_to_pm.go::emusToPixels.
	width := intAttr(node.Attrs, "width")
	height := intAttr(node.Attrs, "height")
	_, err = em.doc.AddImageFromData(data, deriveImageName(src, format), format, width, height, cfg)
	if err != nil {
		return fmt.Errorf("translate: add image: %w", err)
	}
	return nil
}

// intAttr reads a numeric PM attr that JSON unmarshalling has placed
// in the attrs map as float64 (PM JSON spec). Returns 0 when the attr
// is absent, non-numeric, or non-positive — callers treat 0 as "no
// explicit dimension; fall back to defaults".
func intAttr(attrs map[string]any, key string) int {
	v, ok := attrs[key]
	if !ok || v == nil {
		return 0
	}
	switch n := v.(type) {
	case float64:
		if n <= 0 {
			return 0
		}
		return int(n)
	case int:
		if n <= 0 {
			return 0
		}
		return n
	case int64:
		if n <= 0 {
			return 0
		}
		return int(n)
	}
	return 0
}

// decodeAndValidateImage runs the byte / MIME validation pipeline that
// sits between the client-supplied data: URI and WordZero's
// AddImageFromData. Returns (data, format, skip=true) when the image
// should be silently dropped with a warning attached — used for
// payloads that exceed MaxImageBytes or carry an unsupported media
// type (image/svg+xml etc.). A non-nil error means a malformed URI
// the caller should propagate.
//
// Note: validation is by declared MIME (data: header), not by sniffing
// magic bytes. A client that lies about its content type can still get
// the bytes embedded as long as the size cap is respected; WordZero
// then surfaces the format mismatch to Word at open time. We accept
// that risk in v1 since the only ingress is the editor's image-insert
// flow, which constructs the header from a typed File.
func (em *emitter) decodeAndValidateImage(src string) ([]byte, document.ImageFormat, bool, error) {
	if driveItemID, fileName, ok := parseDriveFileSrc(src); ok {
		return em.resolveDriveImage(src, driveItemID, fileName)
	}
	if strings.HasPrefix(src, "data:") {
		mediaType, _ := parseDataURIHeader(src)
		if mediaType != "" && !allowedImageMediaTypes[strings.ToLower(mediaType)] {
			em.addWarning(WarningUnsupportedImageType,
				fmt.Sprintf("image with media type %q dropped", mediaType))
			return nil, "", true, nil
		}
	}
	data, format, err := decodeImageSrc(src)
	if err != nil {
		return nil, "", false, err
	}
	if len(data) > MaxImageBytes {
		em.addWarning(WarningImageTooLarge,
			fmt.Sprintf("image of %d bytes exceeded %d-byte cap and was dropped", len(data), MaxImageBytes))
		return nil, "", true, nil
	}
	return data, format, false, nil
}

// resolveDriveImage fetches the bytes for an inserted drive-file image
// via em.imageResolver, infers the WordZero format from the file name's
// extension, and applies the same size cap as the data: URI path. With
// no resolver wired (non-server callers), a drive URL is unsupported —
// matching decodeImageSrc's data:-only contract.
func (em *emitter) resolveDriveImage(
	src, driveItemID, fileName string,
) ([]byte, document.ImageFormat, bool, error) {
	if em.imageResolver == nil {
		return nil, "", false, fmt.Errorf(
			"translate: drive-file image src %q has no resolver (only data: URIs supported without one)", src)
	}
	format := extensionToFormat(fileName)
	if format == "" {
		em.addWarning(WarningUnsupportedImageType,
			fmt.Sprintf("drive image %q has unsupported extension; dropped", fileName))
		return nil, "", true, nil
	}
	data, err := em.imageResolver(driveItemID, fileName)
	if err != nil {
		return nil, "", false, fmt.Errorf("translate: resolve drive image %s/%s: %w", driveItemID, fileName, err)
	}
	if len(data) > MaxImageBytes {
		em.addWarning(WarningImageTooLarge,
			fmt.Sprintf("image of %d bytes exceeded %d-byte cap and was dropped", len(data), MaxImageBytes))
		return nil, "", true, nil
	}
	return data, format, false, nil
}

// parseDriveFileSrc extracts (driveItemID, fileName) from a PocketBase
// drive-file URL of the form ".../api/files/drive_items/<id>/<file>",
// tolerating an absolute or relative URL and any query string (e.g. a
// stale ?token=). Returns ok=false for any other src shape.
func parseDriveFileSrc(src string) (driveItemID, fileName string, ok bool) {
	const marker = "/api/files/drive_items/"
	idx := strings.Index(src, marker)
	if idx < 0 {
		return "", "", false
	}
	rest := src[idx+len(marker):]
	if q := strings.IndexByte(rest, '?'); q >= 0 {
		rest = rest[:q]
	}
	slash := strings.IndexByte(rest, '/')
	if slash <= 0 {
		return "", "", false
	}
	driveItemID = rest[:slash]
	fileName = rest[slash+1:]
	if driveItemID == "" || fileName == "" || strings.Contains(fileName, "/") {
		return "", "", false
	}
	return driveItemID, fileName, true
}

// extensionToFormat maps a stored file name's extension to a WordZero
// ImageFormat, reusing mediaTypeToFormat so the accepted set stays in
// lockstep with the data: URI path.
func extensionToFormat(fileName string) document.ImageFormat {
	dot := strings.LastIndexByte(fileName, '.')
	if dot < 0 {
		return ""
	}
	switch strings.ToLower(fileName[dot+1:]) {
	case "png":
		return document.ImageFormatPNG
	case "jpg", "jpeg":
		return document.ImageFormatJPEG
	case "gif":
		return document.ImageFormatGIF
	default:
		return ""
	}
}

// parseDataURIHeader returns the media type from a data: URI without
// decoding the body. Returns ("", false) if the URI is malformed.
func parseDataURIHeader(src string) (string, bool) {
	if !strings.HasPrefix(src, "data:") {
		return "", false
	}
	comma := strings.IndexByte(src, ',')
	if comma < 0 {
		return "", false
	}
	header := src[len("data:"):comma]
	return strings.SplitN(header, ";", 2)[0], true
}

// applyImageWrap reads the image's `wrap` attribute and configures
// the WordZero ImageConfig to produce the matching anchor drawing.
// Unknown values (including the legacy "inline" literal) are treated
// as no-op (default inline drawing, <wp:inline>).
//
// Mode mapping:
//   - "left"  -> floatLeft anchor + wrapSquare (text wraps on the right)
//   - "right" -> floatRight anchor + wrapSquare (text wraps on the left)
//   - "break" -> floatLeft anchor + wrapTopAndBottom (Word's "Top and
//     Bottom"; the image takes its own line). WordZero v1.6.0 has no
//     Float-Center constant — Float Left is acceptable here because
//     <wp:wrapTopAndBottom> overrides horizontal flow regardless of
//     positionH, so the visible result is correct in Word and on our
//     editor (which centers via margin:auto on the data-wrap=break
//     wrapper).
func applyImageWrap(cfg *document.ImageConfig, attrs map[string]any) {
	wrap, _ := attrs["wrap"].(string)
	switch wrap {
	case "left":
		cfg.Position = document.ImagePositionFloatLeft
		cfg.WrapText = document.ImageWrapSquare
	case "right":
		cfg.Position = document.ImagePositionFloatRight
		cfg.WrapText = document.ImageWrapSquare
	case "break":
		cfg.Position = document.ImagePositionFloatLeft
		cfg.WrapText = document.ImageWrapTopAndBottom
	}
}

// decodeImageSrc accepts either a data: URI ("data:image/png;base64,…")
// or a file:// path. Returns the raw bytes plus the WordZero
// ImageFormat enum.
func decodeImageSrc(src string) ([]byte, document.ImageFormat, error) {
	if strings.HasPrefix(src, "data:") {
		return decodeDataURI(src)
	}
	return nil, "", fmt.Errorf("translate: unsupported image src %q (only data: URIs supported in v1)", src)
}

func decodeDataURI(src string) ([]byte, document.ImageFormat, error) {
	comma := strings.IndexByte(src, ',')
	if comma < 0 {
		return nil, "", fmt.Errorf("translate: malformed data URI")
	}
	header := src[:comma]
	body := src[comma+1:]
	mediaType := strings.TrimPrefix(header, "data:")
	mediaType = strings.SplitN(mediaType, ";", 2)[0]
	format := mediaTypeToFormat(mediaType)
	if format == "" {
		return nil, "", fmt.Errorf("translate: unsupported image media type %q", mediaType)
	}
	if !strings.Contains(header, "base64") {
		// raw URL-encoded content
		decoded, err := url.QueryUnescape(body)
		if err != nil {
			return nil, "", fmt.Errorf("translate: decode data URI: %w", err)
		}
		return []byte(decoded), format, nil
	}
	data, err := base64.StdEncoding.DecodeString(body)
	if err != nil {
		return nil, "", fmt.Errorf("translate: decode base64: %w", err)
	}
	return data, format, nil
}

func mediaTypeToFormat(media string) document.ImageFormat {
	switch strings.ToLower(media) {
	case "image/png":
		return document.ImageFormatPNG
	case "image/jpeg", "image/jpg":
		return document.ImageFormatJPEG
	case "image/gif":
		return document.ImageFormatGIF
	}
	return ""
}

// deriveImageName makes up a deterministic filename for the
// embedded media file. Using a sha1 of the src keeps the same image
// from being duplicated when the same data: URI appears twice.
func deriveImageName(src string, format document.ImageFormat) string {
	h := sha1.Sum([]byte(src))
	ext := "png"
	switch format {
	case document.ImageFormatJPEG:
		ext = "jpg"
	case document.ImageFormatGIF:
		ext = "gif"
	}
	return fmt.Sprintf("img_%x.%s", h[:6], ext)
}

// emitInlineRuns appends every PMNode child as an inline run on the
// supplied paragraph. Text nodes become AddFormattedText runs;
// link-marked text is wrapped in marker tokens that are post-
// processed into <w:hyperlink>; image nodes inside a paragraph are
// added via AddImageFromData and (when floated) transplanted onto
// the host paragraph so the resulting <w:p> contains both image and
// text — this is what lets the importer reconstruct the original
// "image inline with text" PM tree on round-trip.
func (em *emitter) emitInlineRuns(p *document.Paragraph, runs []PMNode) error {
	for _, r := range runs {
		switch r.Type {
		case NodeTypeText:
			if err := em.emitTextRun(p, r); err != nil {
				return err
			}
		case NodeTypeImage:
			if err := em.emitInlineImage(p, r); err != nil {
				return err
			}
		case NodeTypePageBreak:
			em.emitPageBreak(p)
		case NodeTypeFootnoteReference:
			em.emitNoteReference(p, r, true)
		case NodeTypeEndnoteReference:
			em.emitNoteReference(p, r, false)
		default:
			return fmt.Errorf("translate: unsupported inline node %q", r.Type)
		}
	}
	return nil
}

// emitPageBreak plants a marker text run inside the paragraph that the
// post-process pass will rewrite into <w:br w:type="page"/>. Doing the
// rewrite at the XML layer (rather than mutating WordZero's Run struct)
// avoids tying us to private fields of the dependency.
func (em *emitter) emitPageBreak(p *document.Paragraph) {
	em.pageBreakSeq++
	marker := pageBreakToken(em.pageBreakSeq)
	em.pageBreaks = append(em.pageBreaks, pageBreakMarker{Marker: marker})
	p.AddFormattedText(marker, &document.TextFormat{})
}

// emitNoteReference plants a marker text run and queues a footnote /
// endnote body for the post-process pass. Each marker rewrites into
// <w:footnoteReference w:id="N"/> (or endnoteReference); the bodies
// land in word/footnotes.xml / word/endnotes.xml.
//
// We pick monotonic IDs starting at 1 because Word reserves id 0 for
// the separator / continuation separator notes and rejects ids that
// collide.
func (em *emitter) emitNoteReference(p *document.Paragraph, node PMNode, footnote bool) {
	text, _ := node.Attrs["text"].(string)
	var marker, id string
	if footnote {
		em.footnoteSeq++
		id = strconv.Itoa(em.footnoteSeq)
		marker = footnoteToken(em.footnoteSeq)
		em.footnotes = append(em.footnotes, footnoteEntry{ID: id, Text: text, Marker: marker})
	} else {
		em.endnoteSeq++
		id = strconv.Itoa(em.endnoteSeq)
		marker = endnoteToken(em.endnoteSeq)
		em.endnotes = append(em.endnotes, footnoteEntry{ID: id, Text: text, Marker: marker})
	}
	p.AddFormattedText(marker, &document.TextFormat{})
}

func pageBreakToken(n int) string { return "{{__pmpb:" + strconv.Itoa(n) + "}}" }
func footnoteToken(n int) string  { return "{{__pmfn:" + strconv.Itoa(n) + "}}" }
func endnoteToken(n int) string   { return "{{__pmen:" + strconv.Itoa(n) + "}}" }
func codeOpenToken(n int) string {
	return "{{__pmcd:" + strconv.Itoa(n) + ":open}}"
}
func codeCloseToken(n int) string {
	return "{{__pmcd:" + strconv.Itoa(n) + ":close}}"
}
func bgColorOpenToken(n int) string {
	return "{{__pmbg:" + strconv.Itoa(n) + ":open}}"
}
func bgColorCloseToken(n int) string {
	return "{{__pmbg:" + strconv.Itoa(n) + ":close}}"
}

// bgColorHexFromMarks extracts the textStyle mark's backgroundColor
// attr and normalizes it to a 6-digit RRGGBB hex string (no leading
// '#'). Returns:
//
//   - (hex, "", true)    — a hex value (literal or normalized from rgb()/rgba())
//   - ("",  raw, false)  — a backgroundColor was set but could not be
//     normalized (caller should record a warning)
//   - ("",  "",  false)  — no backgroundColor on any textStyle mark
//
// OOXML's <w:shd w:fill="…"> only accepts hex, so anything we can't
// normalize is dropped on export. We normalize rgb()/rgba() to hex
// (dropping alpha) so the most common CSS-style inputs survive; named
// CSS colors and other forms surface a WarningBackgroundColorLost.
func bgColorHexFromMarks(marks []PMMark) (hex, raw string, ok bool) {
	for _, m := range marks {
		if m.Type != MarkTypeTextStyle {
			continue
		}
		c, isString := m.Attrs["backgroundColor"].(string)
		if !isString || c == "" {
			continue
		}
		if normalized, ok := normalizeColorToHex(c); ok {
			return normalized, "", true
		}
		return "", c, false
	}
	return "", "", false
}

// normalizeColorToHex converts a CSS color string to a 6-digit
// uppercase RRGGBB hex. Accepts:
//
//   - "#RRGGBB" / "RRGGBB" — passed through with case normalization
//   - "rgb(r,g,b)"          — converted; whitespace tolerated
//   - "rgba(r,g,b,a)"       — alpha dropped, RGB converted
//
// All other forms (named colors, hsl(), hwb(), color()) return ok=false.
// Named colors aren't normalized because the OOXML highlight palette
// is the only place we map names to hex, and that mapping is
// asymmetric with CSS (e.g. CSS darkgray=#A9A9A9 vs OOXML
// darkGray=#808080) — surfacing a warning is safer than guessing.
func normalizeColorToHex(value string) (string, bool) {
	v := strings.TrimSpace(value)
	if v == "" {
		return "", false
	}
	if strings.HasPrefix(v, "#") || isPlainHex(v) {
		hex := strings.TrimPrefix(v, "#")
		if len(hex) != 6 || !isPlainHex(hex) {
			return "", false
		}
		return strings.ToUpper(hex), true
	}
	lower := strings.ToLower(v)
	if strings.HasPrefix(lower, "rgb(") || strings.HasPrefix(lower, "rgba(") {
		open := strings.IndexByte(v, '(')
		close := strings.LastIndexByte(v, ')')
		if open < 0 || close <= open {
			return "", false
		}
		parts := strings.Split(v[open+1:close], ",")
		if len(parts) < 3 {
			return "", false
		}
		// rgba() may include an alpha — we drop it. We don't try to
		// blend onto white; doing so would change the visible color
		// in unexpected ways. The warning captures that loss.
		r, rOK := parseColorByte(parts[0])
		g, gOK := parseColorByte(parts[1])
		b, bOK := parseColorByte(parts[2])
		if !rOK || !gOK || !bOK {
			return "", false
		}
		return fmt.Sprintf("%02X%02X%02X", r, g, b), true
	}
	return "", false
}

// isPlainHex reports whether s consists entirely of 0-9 / a-f / A-F.
func isPlainHex(s string) bool {
	for _, ch := range s {
		isHex := (ch >= '0' && ch <= '9') ||
			(ch >= 'a' && ch <= 'f') ||
			(ch >= 'A' && ch <= 'F')
		if !isHex {
			return false
		}
	}
	return s != ""
}

// parseColorByte parses one CSS rgb()/rgba() component. Accepts
// integer 0–255 (the dominant form in tiptap output) and clamps. A
// trailing '%' switches to the 0-100 percent form. Returns ok=false
// on parse error or out-of-range.
func parseColorByte(s string) (uint8, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	if strings.HasSuffix(s, "%") {
		raw := strings.TrimSuffix(s, "%")
		f, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
		if err != nil || f < 0 || f > 100 {
			return 0, false
		}
		return uint8((f / 100.0) * 255.0), true
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 0 || n > 255 {
		return 0, false
	}
	return uint8(n), true
}

// hasCodeMark reports whether the given marks slice carries an
// inline `code` mark — used to decide whether to plant the
// open/close marker runs around a text run during emit.
func hasCodeMark(marks []PMMark) bool {
	for _, m := range marks {
		if m.Type == MarkTypeCode {
			return true
		}
	}
	return false
}
func commentOpenToken(n int) string {
	return "{{__pmcm:" + strconv.Itoa(n) + ":open}}"
}
func commentCloseToken(n int) string {
	return "{{__pmcm:" + strconv.Itoa(n) + ":close}}"
}

// queueCommentMarks builds the open/close marker pair for every
// MarkTypeComment mark on a run AND records the comment body so the
// post-process pass can write word/comments.xml. Returns the span set
// in mark order so the caller can flank the run's text in nesting
// order.
//
// Each PM mark produces a fresh range span (a fresh open/close marker
// pair in document.xml). The OOXML comment id is shared across all
// spans that carry the same input PM id — that way a single logical
// comment whose text the user has split across multiple PM runs still
// points to one entry in word/comments.xml. When the PM mark has no
// id attr we synthesize a monotonic one keyed at em.commentSeq.
func (em *emitter) queueCommentMarks(marks []PMMark) []commentSpan {
	if len(marks) == 0 {
		return nil
	}
	var spans []commentSpan
	if em.commentBodies == nil {
		em.commentBodies = map[string]commentBody{}
	}
	for _, m := range marks {
		if m.Type != MarkTypeComment {
			continue
		}
		id, _ := m.Attrs["id"].(string)
		if id == "" {
			em.commentIDSeq++
			id = strconv.Itoa(em.commentIDSeq)
		}
		em.commentSpanSeq++
		span := commentSpan{
			OpenMarker:  commentOpenToken(em.commentSpanSeq),
			CloseMarker: commentCloseToken(em.commentSpanSeq),
			ID:          id,
		}
		if _, exists := em.commentBodies[id]; !exists {
			body := commentBody{ID: id}
			body.Author, _ = m.Attrs["author"].(string)
			body.Text, _ = m.Attrs["text"].(string)
			body.Date, _ = m.Attrs["date"].(string)
			em.commentBodies[id] = body
		}
		em.commentSpans = append(em.commentSpans, span)
		spans = append(spans, span)
	}
	return spans
}

// emitTextRun is the workhorse: convert PM marks into a WordZero
// TextFormat and append the run. If the node carries a link mark,
// we wrap the text in linkOpen/linkClose marker tokens — those get
// rewritten into <w:hyperlink r:id=…> in postProcessLinks. Comment
// marks are similarly wrapped in {{__pmcm:…}} tokens for the post-
// process pass to rewrite into <w:commentRange*> markers + queue the
// comment body for word/comments.xml.
func (em *emitter) emitTextRun(p *document.Paragraph, node PMNode) error {
	if node.Text == "" {
		return nil
	}
	href, hasLink := linkHref(node.Marks)
	fmt := marksToTextFormat(node.Marks)
	px := fontSizePxFromMarks(node.Marks)
	empty := &document.TextFormat{}

	commentSpans := em.queueCommentMarks(node.Marks)
	for _, span := range commentSpans {
		p.AddFormattedText(span.OpenMarker, empty)
	}

	// bgColor markers wrap the actual run (outside code-mark markers,
	// inside link markers) so the same hyperlink-run that gets rStyle
	// from the code rewriter also gets <w:shd> from the bgColor
	// rewriter. Hex is captured here so the rewriter has it.
	var bgSpan *bgColorSpan
	if hex, raw, ok := bgColorHexFromMarks(node.Marks); ok {
		em.bgColorSeq++
		span := bgColorSpan{
			OpenMarker:  bgColorOpenToken(em.bgColorSeq),
			CloseMarker: bgColorCloseToken(em.bgColorSeq),
			Hex:         hex,
		}
		em.bgColorSpans = append(em.bgColorSpans, span)
		bgSpan = &span
	} else if raw != "" {
		// User-set color we couldn't normalize (named colors, hsl(),
		// etc.). Render preserves it in HTML but DOCX export drops
		// it. Surface a single de-duped warning so the caller (and
		// ultimately the UI) can tell the user.
		em.addWarning(WarningBackgroundColorLost, raw)
	}

	// Code-mark markers wrap the actual run so the post-process pass
	// can splice <w:rStyle w:val="VerbatimChar"/> onto its <w:rPr>.
	// Markers sit inside the link wrapper (when present) so the inner
	// hyperlink-run is the one that gets the rStyle injection.
	var codeSpan *codeMarkSpan
	if hasCodeMark(node.Marks) {
		em.codeMarkSeq++
		span := codeMarkSpan{
			OpenMarker:  codeOpenToken(em.codeMarkSeq),
			CloseMarker: codeCloseToken(em.codeMarkSeq),
		}
		em.codeMarks = append(em.codeMarks, span)
		codeSpan = &span
	}

	if hasLink {
		// Surround the run with markers; the post-process step
		// recognizes them in word/document.xml and rewrites the
		// flanking content.
		em.linkSeq++
		em.linkRels = append(em.linkRels, linkRel{
			Marker: linkMarkerID(em.linkSeq),
			Href:   href,
		})
		open := linkOpenToken(em.linkSeq)
		closeTok := linkCloseToken(em.linkSeq)
		// Each surrounding marker is its own bare text run so that
		// the post-processor can locate them in document.xml without
		// ambiguity. Pass an empty (not nil) TextFormat — WordZero's
		// AddFormattedText drops the text entirely when format==nil.
		p.AddFormattedText(open, empty)
		if bgSpan != nil {
			p.AddFormattedText(bgSpan.OpenMarker, empty)
		}
		if codeSpan != nil {
			p.AddFormattedText(codeSpan.OpenMarker, empty)
		}
		p.AddFormattedText(node.Text, fmt)
		patchLastRunFontSize(p, px)
		if codeSpan != nil {
			p.AddFormattedText(codeSpan.CloseMarker, empty)
		}
		if bgSpan != nil {
			p.AddFormattedText(bgSpan.CloseMarker, empty)
		}
		p.AddFormattedText(closeTok, empty)
	} else {
		if bgSpan != nil {
			p.AddFormattedText(bgSpan.OpenMarker, empty)
		}
		if codeSpan != nil {
			p.AddFormattedText(codeSpan.OpenMarker, empty)
		}
		p.AddFormattedText(node.Text, fmt)
		patchLastRunFontSize(p, px)
		if codeSpan != nil {
			p.AddFormattedText(codeSpan.CloseMarker, empty)
		}
		if bgSpan != nil {
			p.AddFormattedText(bgSpan.CloseMarker, empty)
		}
	}

	// Close spans in LIFO order so nested comments produce well-
	// balanced (innermost-first) commentRangeEnd markers.
	for i := len(commentSpans) - 1; i >= 0; i-- {
		p.AddFormattedText(commentSpans[i].CloseMarker, empty)
	}
	return nil
}

// emitInlineImage adds an image that appeared inside a paragraph's
// inline runs. WordZero's AddImageFromData always appends a NEW
// <w:p> to Body.Elements containing the drawing — that's the wrong
// shape for round-trip when the PM tree placed the image as a child
// of an existing paragraph (typical for wrap=left/right). To fix:
// we call AddImageFromData, then transplant its drawing run onto
// the host paragraph and drop the orphan paragraph from the body.
//
// Plain unwrapped inline images (no wrap attr) get the same
// treatment — keeping them inside their host paragraph matches what
// the parser produces and keeps the lifting/round-trip rules
// consistent. (At parse time, only unwrapped images get lifted into
// their own block; wrapped ones stay inline.)
func (em *emitter) emitInlineImage(p *document.Paragraph, node PMNode) error {
	bodyLenBefore := len(em.doc.Body.Elements)
	if err := em.emitImageBlock(node); err != nil {
		return err
	}
	bodyLenAfter := len(em.doc.Body.Elements)
	// When validation dropped the image (oversized / unsupported type),
	// emitImageBlock returns nil without adding a body element. The
	// warning has already been recorded; the host paragraph just keeps
	// its remaining inline runs.
	if bodyLenAfter == bodyLenBefore {
		return nil
	}
	// AddImageFromData appends exactly one Paragraph element on success.
	if bodyLenAfter != bodyLenBefore+1 {
		return fmt.Errorf("translate: emitInlineImage expected 1 new body element, got %d", bodyLenAfter-bodyLenBefore)
	}
	added, ok := em.doc.Body.Elements[bodyLenAfter-1].(*document.Paragraph)
	if !ok || added == nil || len(added.Runs) == 0 || added.Runs[0].Drawing == nil {
		return fmt.Errorf("translate: emitInlineImage could not locate WordZero-generated drawing")
	}
	// Splice the drawing run onto the host paragraph and drop the
	// orphan from the body.
	p.Runs = append(p.Runs, added.Runs[0])
	em.doc.Body.Elements = em.doc.Body.Elements[:bodyLenAfter-1]
	return nil
}

// marksToTextFormat builds a TextFormat reflecting the bold/italic/
// underline/textStyle marks. Link marks (which need href resolution)
// are handled separately in emitTextRun.
func marksToTextFormat(marks []PMMark) *document.TextFormat {
	if len(marks) == 0 {
		return nil
	}
	fmt := &document.TextFormat{}
	any := false
	// TextStyle attrs (color, fontSize, fontFamily) are applied first so
	// a subsequent Link mark (which forces the accent color + underline)
	// wins for hyperlinks — matches Word's behavior of hyperlinks always
	// rendering as accent blue regardless of any explicit color on the
	// same run. fontSize / fontFamily do NOT get overridden by Link.
	for _, m := range marks {
		if m.Type != MarkTypeTextStyle {
			continue
		}
		if c, ok := m.Attrs["color"].(string); ok && c != "" {
			fmt.FontColor = strings.TrimPrefix(c, "#")
			any = true
		}
		// fontSize is NOT poured into TextFormat.FontSize — that field
		// is whole points, and WordZero doubles it to half-points on
		// emit. For px like 10/14/18 the round-trip through whole
		// points loses precision (10px = 7.5pt rounds to 8pt and back
		// to 11px). emitTextRun calls patchLastRunFontSize after
		// AddFormattedText to write the exact half-points directly
		// onto the RunProperties.FontSize element.
		if f, ok := m.Attrs["fontFamily"].(string); ok && f != "" {
			// WordZero populates ascii/hAnsi/eastAsia/cs from this one
			// field — see pkg/document/document.go::AddFormattedParagraph.
			fmt.FontFamily = f
			any = true
		}
	}
	for _, m := range marks {
		switch m.Type {
		case MarkTypeBold:
			fmt.Bold = true
			any = true
		case MarkTypeItalic:
			fmt.Italic = true
			any = true
		case MarkTypeUnderline:
			fmt.Underline = true
			any = true
		case MarkTypeLink:
			// Link marks are emitted as a wrapping <w:hyperlink>;
			// they also conventionally render with underline + accent
			// color in Word, so we add those visual cues here.
			fmt.Underline = true
			fmt.FontColor = "0563C1"
			any = true
		}
	}
	if !any {
		return nil
	}
	return fmt
}

// fontSizePxFromAttrs reads the textStyle mark's fontSize attr. The
// editor (and the Word importer) store it as a CSS pixel string
// ("16px") to match @tiptap/extension-text-style/font-size's verbatim
// inline-style serialization. We also accept the numeric forms
// (float64 / int) so test fixtures and any historical PM JSON keep
// working. Returns 0 for missing / zero / unparseable / non-positive
// values.
func fontSizePxFromAttrs(attrs map[string]any) (int, bool) {
	v, ok := attrs["fontSize"]
	if !ok {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		if n <= 0 {
			return 0, false
		}
		return int(n), true
	case int:
		if n <= 0 {
			return 0, false
		}
		return n, true
	case string:
		px, ok := parsePxString(n)
		if !ok || px <= 0 {
			return 0, false
		}
		return px, true
	}
	return 0, false
}

// parsePxString reads a CSS px length like "16px" or "16.5px" and
// returns the rounded integer pixel value. Whitespace-trimmed; case-
// insensitive on the suffix. Returns ok=false for empty input,
// non-numeric prefixes, or units other than px (rem/em/% would
// require font-context to resolve and we don't carry that on the
// server side).
func parsePxString(raw string) (int, bool) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return 0, false
	}
	suffix := "px"
	lower := strings.ToLower(s)
	if !strings.HasSuffix(lower, suffix) {
		// Bare number — treat as px. Matches the editor's
		// permissiveness; users pasting an inline style without the
		// unit get the same behavior as if they'd included "px".
		f, err := strconv.ParseFloat(s, 64)
		if err != nil || f <= 0 {
			return 0, false
		}
		return int(math.Round(f)), true
	}
	numPart := strings.TrimSpace(s[:len(s)-len(suffix)])
	f, err := strconv.ParseFloat(numPart, 64)
	if err != nil || f <= 0 {
		return 0, false
	}
	return int(math.Round(f)), true
}

// fontSizePxFromMarks scans for the textStyle mark on a node and
// returns its fontSize attr as integer CSS px (or 0 if absent).
func fontSizePxFromMarks(marks []PMMark) int {
	for _, m := range marks {
		if m.Type != MarkTypeTextStyle {
			continue
		}
		if px, ok := fontSizePxFromAttrs(m.Attrs); ok {
			return px
		}
	}
	return 0
}

// patchLastRunFontSize writes the exact half-points value onto the
// most-recently-appended run's RunProperties.FontSize. Used to bypass
// WordZero's whole-point quantization (TextFormat.FontSize is int
// points; for px 10/14/18 we need 15/21/27 half-points which aren't
// representable as 2× whole points).
func patchLastRunFontSize(p *document.Paragraph, px int) {
	if px <= 0 || len(p.Runs) == 0 {
		return
	}
	hp := PxToHalfPoints(px)
	if hp <= 0 {
		return
	}
	run := &p.Runs[len(p.Runs)-1]
	if run.Properties == nil {
		run.Properties = &document.RunProperties{}
	}
	run.Properties.FontSize = &document.FontSize{Val: strconv.Itoa(hp)}
}

func linkHref(marks []PMMark) (string, bool) {
	for _, m := range marks {
		if m.Type == MarkTypeLink {
			if href, ok := m.Attrs["href"].(string); ok && href != "" {
				return href, true
			}
		}
	}
	return "", false
}

// linkMarkerID / linkOpenToken / linkCloseToken produce the
// placeholder strings that we wrap link runs with. Designed to be
// unlikely-as-real-text; postProcessLinks looks for these exact
// token strings in word/document.xml.
func linkMarkerID(n int) string { return strconv.Itoa(n) }
func linkOpenToken(n int) string {
	return "{{__pmlink:" + linkMarkerID(n) + ":open}}"
}
func linkCloseToken(n int) string {
	return "{{__pmlink:" + linkMarkerID(n) + ":close}}"
}

// postProcessLinks rewrites the docx zip in-place to convert
// linkOpen/linkClose marker text runs into proper <w:hyperlink>
// wrappers, and appends the matching Relationship rows to
// word/_rels/document.xml.rels.
func postProcessLinks(docxBytes []byte, rels []linkRel) ([]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(docxBytes), int64(len(docxBytes)))
	if err != nil {
		return nil, fmt.Errorf("translate: re-read for link postprocess: %w", err)
	}

	parts := map[string][]byte{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		buf, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			return nil, err
		}
		parts[f.Name] = buf
	}

	docXML, ok := parts["word/document.xml"]
	if !ok {
		return nil, fmt.Errorf("translate: word/document.xml missing in WordZero output")
	}
	relsXML := parts["word/_rels/document.xml.rels"]

	docXML, relsXML = applyLinkRewrites(docXML, relsXML, rels)

	parts["word/document.xml"] = docXML
	parts["word/_rels/document.xml.rels"] = relsXML

	return rezipParts(zr, parts)
}

// pendingRel is one rId+Href pair to inject into the rels XML;
// declared at package scope so it can flow through appendRelationships
// and applyLinkRewrites without compiler-confusing nested types.
type pendingRel struct {
	ID   string
	Href string
}

// applyLinkRewrites walks the marker token list, finds each
// open+content+close span in document.xml, and replaces it with a
// proper <w:hyperlink r:id="rIdN"> ... </w:hyperlink>. Also
// extends the rels XML with a Relationship row per link.
func applyLinkRewrites(docXML, relsXML []byte, rels []linkRel) ([]byte, []byte) {
	if len(rels) == 0 {
		return docXML, relsXML
	}
	doc := string(docXML)
	rid := nextRid(string(relsXML))
	var pending []pendingRel
	for _, l := range rels {
		open := linkOpenToken(parseMarkerSeq(l.Marker))
		closeMarker := linkCloseToken(parseMarkerSeq(l.Marker))
		// In document.xml each marker text becomes a
		// <w:r><w:t>{{__pmlink:N:open}}</w:t></w:r> run. We rewrite:
		//   <w:r>…<w:t>OPEN</w:t></w:r>
		//   <w:r>…<w:t>TEXT</w:t></w:r>
		//   <w:r>…<w:t>CLOSE</w:t></w:r>
		// into
		//   <w:hyperlink r:id="rIdN" w:history="1">
		//     <w:r>…<w:t>TEXT</w:t></w:r>
		//   </w:hyperlink>
		openRun, openIdx := findMarkerRun(doc, open)
		if openIdx < 0 {
			continue
		}
		closeRun, closeIdxRel := findMarkerRun(doc[openIdx+len(openRun):], closeMarker)
		if closeIdxRel < 0 {
			continue
		}
		closeStart := openIdx + len(openRun) + closeIdxRel
		closeEnd := closeStart + len(closeRun)
		inner := doc[openIdx+len(openRun) : closeStart]
		ridStr := "rId" + strconv.Itoa(rid)
		rid++
		hyper := `<w:hyperlink r:id="` + ridStr + `" w:history="1">` + inner + `</w:hyperlink>`
		doc = doc[:openIdx] + hyper + doc[closeEnd:]
		pending = append(pending, pendingRel{ID: ridStr, Href: l.Href})
	}
	relsOut := appendRelationships(string(relsXML), pending)
	return []byte(doc), []byte(relsOut)
}

// findMarkerRun locates a <w:r ...><w:t>marker</w:t></w:r> in the
// supplied haystack and returns (the matched run substring, its
// start offset). The marker may be wrapped in xml:space="preserve"
// or include attributes — we anchor on the marker text inside <w:t>.
//
// We carefully look back for the OPENING run tag (<w:r> or <w:r ...>),
// not for any token that happens to start with "<w:r" — the latter
// would also match <w:rPr> on the immediately-enclosing run, and we
// would chop the run open in the wrong place.
func findMarkerRun(haystack, marker string) (string, int) {
	needle := ">" + marker + "</w:t>"
	pos := strings.Index(haystack, needle)
	if pos < 0 {
		return "", -1
	}
	startOffset := lastRunOpen(haystack[:pos])
	if startOffset < 0 {
		return "", -1
	}
	endOffset := strings.Index(haystack[pos:], "</w:r>")
	if endOffset < 0 {
		return "", -1
	}
	endAbs := pos + endOffset + len("</w:r>")
	return haystack[startOffset:endAbs], startOffset
}

// lastRunOpen returns the offset of the last <w:r> or <w:r ...> tag
// in s — it ignores <w:rPr>, <w:rStyle>, etc. by requiring the
// character after "<w:r" to be ">" or whitespace.
func lastRunOpen(s string) int {
	for off := len(s); off > 0; {
		idx := strings.LastIndex(s[:off], "<w:r")
		if idx < 0 {
			return -1
		}
		if idx+4 < len(s) {
			next := s[idx+4]
			if next == '>' || next == ' ' || next == '\t' || next == '\n' || next == '\r' || next == '/' {
				return idx
			}
		}
		off = idx
	}
	return -1
}

// nextRid scans the rels XML for the highest existing rId number and
// returns the next free integer.
func nextRid(rels string) int {
	max := 0
	idx := 0
	for {
		i := strings.Index(rels[idx:], `Id="rId`)
		if i < 0 {
			break
		}
		i += idx
		j := strings.Index(rels[i+7:], `"`)
		if j < 0 {
			break
		}
		n, err := strconv.Atoi(rels[i+7 : i+7+j])
		if err == nil && n > max {
			max = n
		}
		idx = i + 7 + j
	}
	return max + 1
}

// appendRelationships injects new <Relationship> rows just before
// the closing </Relationships>.
func appendRelationships(rels string, pending []pendingRel) string {
	if len(pending) == 0 {
		return rels
	}
	closeTag := "</Relationships>"
	idx := strings.LastIndex(rels, closeTag)
	if idx < 0 {
		return rels
	}
	var sb strings.Builder
	sb.WriteString(rels[:idx])
	for _, p := range pending {
		sb.WriteString(`<Relationship Id="`)
		sb.WriteString(p.ID)
		sb.WriteString(`" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="`)
		sb.WriteString(xmlEscape(p.Href))
		sb.WriteString(`" TargetMode="External"/>`)
	}
	sb.WriteString(rels[idx:])
	return sb.String()
}

func xmlEscape(s string) string {
	var sb strings.Builder
	if err := xml.EscapeText(&sb, []byte(s)); err != nil {
		return s
	}
	return sb.String()
}

// parseMarkerSeq pulls the integer back out of a marker ID string.
func parseMarkerSeq(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

// rezipParts builds a new ZIP archive from the (mutated) parts map,
// preserving the original file ordering and storage method. Any keys
// in parts that didn't exist in the original (e.g. word/comments.xml
// that we just synthesized) are appended at the end with Deflate.
func rezipParts(orig *zip.Reader, parts map[string][]byte) ([]byte, error) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	seen := map[string]bool{}
	for _, f := range orig.File {
		header := &zip.FileHeader{
			Name:   f.Name,
			Method: f.Method,
		}
		// Preserve well-known DOS epoch timestamps WordZero uses.
		header.SetModTime(f.Modified)
		out, err := w.CreateHeader(header)
		if err != nil {
			return nil, err
		}
		if _, err := out.Write(parts[f.Name]); err != nil {
			return nil, err
		}
		seen[f.Name] = true
	}
	for name, data := range parts {
		if seen[name] {
			continue
		}
		out, err := w.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err := out.Write(data); err != nil {
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
