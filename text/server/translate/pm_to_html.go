package translate

// PM-to-HTML rendering for the text package.
//
// PMJSONToHTML walks a ProseMirror document tree (the same JSON shape
// pm_to_docx.go consumes) and emits a sanitized HTML content fragment
// using the `tinycld-text*` class vocabulary. The output is a fragment
// (no <html>/<head>/<style>), suitable for inlining inside a preview
// iframe or a print envelope. The endpoint (render_endpoint.go) calls
// this then runs render.Sanitize() before writing the response.
//
// Class vocabulary
// ----------------
// Container:
//   - .tinycld-text                       wraps the document root
//
// Block nodes:
//   - .tinycld-text-p                     paragraph
//   - .tinycld-text-h1 … .tinycld-text-h6  heading levels
//   - .tinycld-text-blockquote            blockquote
//   - .tinycld-text-pre                   code block wrapper (<pre>)
//   - .tinycld-text-code-block            code block <code> child
//   - .tinycld-text-ul                    bullet list
//   - .tinycld-text-ol                    ordered list
//   - .tinycld-text-li                    list item
//   - .tinycld-text-table                 table (gets a <colgroup> when
//                                          colwidth data is available)
//   - .tinycld-text-tr                    table row
//   - .tinycld-text-th                    header cell (tableCell with isHeader)
//   - .tinycld-text-td                    body cell
//   - .tinycld-text-hr                    horizontal rule (pageBreak surrogate)
//   - .tinycld-text-img                   inline image
//   - .tinycld-text-img-wrap--left        floated-left image
//   - .tinycld-text-img-wrap--right       floated-right image
//   - .tinycld-text-img-wrap--break       full-width image with break
//
// Block-level alignment / indent modifiers (paragraph + heading):
//   - .tinycld-text-align--left
//   - .tinycld-text-align--center
//   - .tinycld-text-align--right
//   - .tinycld-text-align--justify
//   - .tinycld-text-indent--N             where N is 1..MaxIndentLevel
//
// Inline marks (applied to <span> wrappers around text runs):
//   - .tinycld-text-mark--bold
//   - .tinycld-text-mark--italic
//   - .tinycld-text-mark--underline
//   - .tinycld-text-mark--strike
//   - .tinycld-text-mark--code
//   - .tinycld-text-mark--link            anchor wrapper (`<a>`)
//   - .tinycld-text-mark--comment         comment-marked run (`<span data-comment-id="…">`)
//   - .tinycld-text-mark--text-style      generic textStyle (color/fontSize/fontFamily)
//
// Footnotes / endnotes are rendered as superscript references; their
// bodies are not currently included in the fragment (v1 deferral).
// Page breaks render as a horizontal rule placeholder.
//
// Supported PM node types
// -----------------------
// doc, paragraph, heading, blockquote, codeBlock, bulletList,
// orderedList, listItem, table, tableRow, tableCell, image, text,
// pageBreak, footnoteReference, endnoteReference.
//
// Supported PM marks
// ------------------
// bold, italic, underline, strike, link, textStyle, comment, code.
//
// Unknown nodes / marks are silently dropped in production. In dev
// (TINYCLD_DEV=1) an HTML comment "<!-- TODO: unsupported node 'foo' -->"
// is emitted so missing coverage is visible.
//
// Image transport mode
// --------------------
// The Images field in HTMLRenderOpts controls how image src attrs
// surface in the output:
//   - ImageModeURL (default): the renderer emits the src verbatim.
//     For docx-imported images this is a data: URI (the importer
//     always inlines bytes via resolveMediaSrc); for client-inserted
//     images it's a PocketBase file URL with a token query param.
//     Preview consumers want this mode — the iframe is same-origin
//     to PocketBase so token URLs resolve normally.
//   - ImageModeEmbed: the EmbedFetcher callback resolves any non-data
//     URL to bytes; those bytes are base64-encoded and emitted as a
//     data: URI. Required for native print (expo-print cannot load
//     external assets) and useful for web print reliability. data:
//     URIs that the source already carries pass through unchanged.

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
)

// ImageMode selects how image references in the source PM JSON are
// surfaced in the rendered HTML.
type ImageMode string

const (
	// ImageModeURL emits image src attributes verbatim. data: URIs
	// pass through; PocketBase file URLs pass through with whatever
	// auth query params the caller supplied.
	ImageModeURL ImageMode = "url"
	// ImageModeEmbed resolves every non-data URL through the
	// EmbedFetcher callback and emits the result as a base64 data:
	// URI. Used by print.
	ImageModeEmbed ImageMode = "embed"
)

// EmbedFetcher resolves a URL to its content bytes + MIME type for
// the ImageModeEmbed transport. Returning an error causes the image
// to be dropped silently rather than aborting the whole render —
// losing one image is preferable to producing a 500 on every preview
// of a document whose image upload is broken.
//
// The endpoint provides a PocketBase-backed implementation; tests
// pass deterministic stubs.
type EmbedFetcher func(src string) (mimeType string, data []byte, err error)

// HTMLRenderOpts is the request-level renderer customization the
// HTTP handler passes through after parsing query parameters.
type HTMLRenderOpts struct {
	Images ImageMode
	// EmbedFetcher is consulted only when Images == ImageModeEmbed
	// and the image src is not already a data: URI. Optional even in
	// embed mode — when nil, non-data URLs pass through unchanged
	// (degrades gracefully to URL semantics).
	EmbedFetcher EmbedFetcher
}

// PMJSONToHTML translates a ProseMirror JSON tree into an HTML
// content fragment. The fragment is wrapped in `<article
// class="tinycld-text">…</article>` and never includes <html>/<head>/
// <style> — clients (preview iframe, print envelope) supply their
// own CSS.
//
// The output is **not** yet sanitized — callers (the HTTP endpoint)
// run render.Sanitize() before writing the response so any future
// stray emit-time bug can't smuggle a <script> into a preview.
//
// Hard errors (malformed JSON, root != "doc") return errors; soft
// degradations (unknown nodes, unresolvable images) drop silently
// in prod and emit `<!-- TODO: … -->` comments in dev.
func PMJSONToHTML(pmJSON []byte, opts HTMLRenderOpts) (string, error) {
	var root PMNode
	if err := json.Unmarshal(pmJSON, &root); err != nil {
		return "", fmt.Errorf("translate: unmarshal pmJSON: %w", err)
	}
	return pmNodeToHTML(root, opts)
}

// pmNodeToHTML walks an in-memory PMNode tree → HTML. Shared by
// PMJSONToHTML (JSON-in entry) and DocxToHTML (parser-in entry); the
// latter skips JSON encoding entirely.
func pmNodeToHTML(root PMNode, opts HTMLRenderOpts) (string, error) {
	if root.Type != NodeTypeDoc {
		return "", fmt.Errorf("translate: pmJSON root must be type=doc, got %q", root.Type)
	}
	r := newHTMLRenderer(opts)
	r.b.WriteString(`<article class="tinycld-text">`)
	for _, child := range root.Content {
		r.writeBlock(child)
	}
	r.b.WriteString(`</article>`)
	return r.b.String(), nil
}

// htmlRenderer holds per-render state: the output builder, the
// resolved options, and dev-mode toggles.
type htmlRenderer struct {
	b       strings.Builder
	opts    HTMLRenderOpts
	devMode bool
}

func newHTMLRenderer(opts HTMLRenderOpts) *htmlRenderer {
	return &htmlRenderer{opts: opts, devMode: isDevMode()}
}

// isDevMode toggles dev-only diagnostic emission (TODO comments for
// unsupported nodes/marks). The env-var gate matches the convention
// used elsewhere in the package; production deployments leave it
// unset.
func isDevMode() bool {
	v := os.Getenv("TINYCLD_DEV")
	return v == "1" || strings.EqualFold(v, "true")
}

// writeBlock emits one block-level node. Recursive: lists, tables,
// and blockquotes recurse into their children via writeBlock; text-
// containing blocks recurse into writeInline.
func (r *htmlRenderer) writeBlock(n PMNode) {
	switch n.Type {
	case NodeTypeParagraph:
		r.writeParagraph(n)
	case NodeTypeHeading:
		r.writeHeading(n)
	case NodeTypeBlockquote:
		r.writeBlockquote(n)
	case NodeTypeCodeBlock:
		r.writeCodeBlock(n)
	case NodeTypeBulletList:
		r.writeList(n, "ul", "tinycld-text-ul")
	case NodeTypeOrderedList:
		r.writeList(n, "ol", "tinycld-text-ol")
	case NodeTypeListItem:
		r.writeListItem(n)
	case NodeTypeTable:
		r.writeTable(n)
	case NodeTypePageBreak:
		r.b.WriteString(`<hr class="tinycld-text-hr">`)
	case NodeTypeImage:
		// A standalone image at block level shouldn't normally happen
		// (the docx parser wraps liftable images in a paragraph) but
		// we tolerate it by emitting a wrapping paragraph.
		r.b.WriteString(`<p class="tinycld-text-p">`)
		r.writeImage(n)
		r.b.WriteString(`</p>`)
	default:
		r.writeUnsupported("block", n.Type)
	}
}

func (r *htmlRenderer) writeParagraph(n PMNode) {
	classes := []string{"tinycld-text-p"}
	classes = appendAlignIndentClasses(classes, n.Attrs)
	if wrap := paragraphFloatSide(n); wrap != "" {
		classes = append(classes, "tinycld-text-p-with-float--"+wrap)
	}
	r.openTag("p", classes, nil)
	for _, child := range n.Content {
		r.writeInline(child)
	}
	r.b.WriteString(`</p>`)
}

// paragraphFloatSide returns "left" or "right" when the paragraph
// contains a floated image (wrap=left|right), and "" otherwise. The
// emitter tags such paragraphs with a marker class so the preview CSS
// can clear the side and start a fresh block formatting context — a
// floated image inside a paragraph that's still inside a prior float's
// wrap zone gets positioned alongside the prior float instead of at
// the container's left edge. Clearing the paragraph (not just the
// img) is what restores the "new image row starts flush left" shape.
// "break" wrap doesn't need this — it's already display:block with
// clear:both on the img — so we ignore it here.
func paragraphFloatSide(p PMNode) string {
	for _, c := range p.Content {
		if c.Type != NodeTypeImage {
			continue
		}
		wrap, _ := c.Attrs["wrap"].(string)
		if wrap == "left" || wrap == "right" {
			return wrap
		}
	}
	return ""
}

func (r *htmlRenderer) writeHeading(n PMNode) {
	level := intAttrOr(n.Attrs, "level", 1)
	if level < 1 {
		level = 1
	}
	if level > 6 {
		level = 6
	}
	tag := fmt.Sprintf("h%d", level)
	classes := []string{fmt.Sprintf("tinycld-text-h%d", level)}
	classes = appendAlignIndentClasses(classes, n.Attrs)
	r.openTag(tag, classes, nil)
	for _, child := range n.Content {
		r.writeInline(child)
	}
	r.b.WriteString(`</`)
	r.b.WriteString(tag)
	r.b.WriteString(`>`)
}

func (r *htmlRenderer) writeBlockquote(n PMNode) {
	r.b.WriteString(`<blockquote class="tinycld-text-blockquote">`)
	for _, child := range n.Content {
		r.writeBlock(child)
	}
	r.b.WriteString(`</blockquote>`)
}

// writeCodeBlock emits the standard <pre><code>…</code></pre> shape
// browsers and accessibility tools expect. PM's codeBlock node carries
// plain text children only (no inline marks; see the comment on
// NodeTypeCodeBlock in types.go), so we walk the text content directly
// rather than re-entering writeInline (which would wrap each run in a
// <span> redundantly).
func (r *htmlRenderer) writeCodeBlock(n PMNode) {
	r.b.WriteString(`<pre class="tinycld-text-pre"><code class="tinycld-text-code-block">`)
	for _, child := range n.Content {
		if child.Type == NodeTypeText {
			r.b.WriteString(escapeHTML(child.Text))
		}
	}
	r.b.WriteString(`</code></pre>`)
}

func (r *htmlRenderer) writeList(n PMNode, tag, listClass string) {
	classes := []string{listClass}
	var attrs map[string]string
	// Only <ol> honors `start`. Word frequently emits sibling ordered
	// lists with a non-1 start when a list is interrupted by a nested
	// bullet sub-list (the second half resumes the original
	// numbering); without `start` the resumed half would restart at 1.
	if tag == "ol" {
		if start := intAttrOr(n.Attrs, "start", 0); start > 1 {
			attrs = map[string]string{"start": strconv.Itoa(start)}
		}
	}
	r.openTag(tag, classes, attrs)
	for _, child := range n.Content {
		if child.Type == NodeTypeListItem {
			r.writeListItem(child)
		}
	}
	r.b.WriteString(`</`)
	r.b.WriteString(tag)
	r.b.WriteString(`>`)
}

func (r *htmlRenderer) writeListItem(n PMNode) {
	r.b.WriteString(`<li class="tinycld-text-li">`)
	for _, child := range n.Content {
		r.writeBlock(child)
	}
	r.b.WriteString(`</li>`)
}

func (r *htmlRenderer) writeTable(n PMNode) {
	r.b.WriteString(`<table class="tinycld-text-table">`)
	r.writeTableColgroup(n)
	r.b.WriteString(`<tbody>`)
	for _, row := range n.Content {
		if row.Type != NodeTypeTableRow {
			continue
		}
		r.b.WriteString(`<tr class="tinycld-text-tr">`)
		for _, cell := range row.Content {
			if cell.Type != NodeTypeTableCell {
				continue
			}
			r.writeTableCell(cell)
		}
		r.b.WriteString(`</tr>`)
	}
	r.b.WriteString(`</tbody></table>`)
}

// writeTableColgroup emits a <colgroup> of <col> elements with inline
// width styles derived from the first row that carries colwidth on
// every cell. Combined with `table-layout: fixed` in the preview CSS,
// this preserves the per-column widths that came from the source
// document (Word's <w:tblGrid>) instead of collapsing every imported
// table to a uniform auto layout. When no row carries widths the
// colgroup is omitted entirely and the table falls back to the CSS
// max-width / auto sizing.
func (r *htmlRenderer) writeTableColgroup(n PMNode) {
	widths := firstRowColumnWidthsPx(n)
	if len(widths) == 0 {
		return
	}
	r.b.WriteString(`<colgroup>`)
	for _, w := range widths {
		if w > 0 {
			r.b.WriteString(`<col style="width: `)
			r.b.WriteString(strconv.Itoa(w))
			r.b.WriteString(`px">`)
		} else {
			r.b.WriteString(`<col>`)
		}
	}
	r.b.WriteString(`</colgroup>`)
}

// firstRowColumnWidthsPx walks a table's rows to find the first row
// in which every cell carries a `colwidth` attribute, then unrolls
// each cell's per-spanned-column widths into a flat slice. Returns
// nil if no such row exists, matching the table emitter's behavior
// in pm_to_docx.go::tableGeometry — both must agree on which row
// defines the physical grid so round-trips don't drift.
func firstRowColumnWidthsPx(table PMNode) []int {
	for _, row := range table.Content {
		if row.Type != NodeTypeTableRow {
			continue
		}
		var widths []int
		ok := true
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
			for i := 0; i < span; i++ {
				if i < len(cw) {
					widths = append(widths, cw[i])
				} else {
					widths = append(widths, cw[len(cw)-1])
				}
			}
		}
		if ok && len(widths) > 0 {
			return widths
		}
	}
	return nil
}

// writeTableCell emits one cell. The cell tag is <th> when the cell
// carries isHeader=true (matching tiptap's table-header convention)
// and <td> otherwise. colspan / rowspan attrs are passed through when
// they exceed 1; the sanitizer's allowlist permits both on td/th.
func (r *htmlRenderer) writeTableCell(n PMNode) {
	tag := "td"
	cls := "tinycld-text-td"
	if isHeader, _ := n.Attrs["isHeader"].(bool); isHeader {
		tag = "th"
		cls = "tinycld-text-th"
	}
	attrs := map[string]string{}
	if colspan := intAttrOr(n.Attrs, "colspan", 0); colspan > 1 {
		attrs["colspan"] = strconv.Itoa(colspan)
	}
	if rowspan := intAttrOr(n.Attrs, "rowspan", 0); rowspan > 1 {
		attrs["rowspan"] = strconv.Itoa(rowspan)
	}
	r.openTag(tag, []string{cls}, attrs)
	for _, child := range n.Content {
		r.writeBlock(child)
	}
	r.b.WriteString(`</`)
	r.b.WriteString(tag)
	r.b.WriteString(`>`)
}

// writeInline emits one inline child of a block. Text nodes get
// (optionally) wrapped in mark elements; image nodes emit <img>; an
// unknown inline type drops silently (with a dev-mode TODO).
func (r *htmlRenderer) writeInline(n PMNode) {
	switch n.Type {
	case NodeTypeText:
		r.writeText(n)
	case NodeTypeImage:
		r.writeImage(n)
	case NodeTypeFootnoteReference:
		r.writeFootnoteReference(n, "footnote")
	case NodeTypeEndnoteReference:
		r.writeFootnoteReference(n, "endnote")
	case NodeTypePageBreak:
		// PM emits page breaks at block level (handled by writeBlock)
		// but a stray inline one renders as an inline <hr> fallback.
		r.b.WriteString(`<hr class="tinycld-text-hr">`)
	default:
		r.writeUnsupported("inline", n.Type)
	}
}

// writeText emits a (possibly mark-wrapped) text run. Marks nest from
// outermost to innermost in the order returned by sortMarks — link
// outside, then comment, then formatting marks. Stable ordering keeps
// snapshots deterministic.
func (r *htmlRenderer) writeText(n PMNode) {
	marks := sortMarks(n.Marks)
	opens := make([]string, 0, len(marks))
	closes := make([]string, 0, len(marks))
	for _, m := range marks {
		open, close := r.markTags(m)
		if open == "" {
			// Mark dropped (unsupported / unsafe URL); render the text
			// without the wrap.
			continue
		}
		opens = append(opens, open)
		closes = append(closes, close)
	}
	for _, o := range opens {
		r.b.WriteString(o)
	}
	r.b.WriteString(escapeHTML(n.Text))
	for i := len(closes) - 1; i >= 0; i-- {
		r.b.WriteString(closes[i])
	}
}

// markTags returns the (open, close) tag pair for a single mark.
// Returns empty open string for unsupported / unsafe marks; the
// caller drops the wrap but still emits the text content.
func (r *htmlRenderer) markTags(m PMMark) (string, string) {
	switch m.Type {
	case MarkTypeBold:
		return `<span class="tinycld-text-mark--bold">`, `</span>`
	case MarkTypeItalic:
		return `<span class="tinycld-text-mark--italic">`, `</span>`
	case MarkTypeUnderline:
		return `<span class="tinycld-text-mark--underline">`, `</span>`
	case MarkTypeStrike:
		return `<span class="tinycld-text-mark--strike">`, `</span>`
	case MarkTypeCode:
		return `<code class="tinycld-text-mark--code">`, `</code>`
	case MarkTypeLink:
		href := stringAttr(m.Attrs, "href")
		if !linkURLAllowed(href) {
			// Drop unsafe scheme; keep the text content.
			return "", ""
		}
		return fmt.Sprintf(
			`<a class="tinycld-text-mark--link" href="%s" rel="noopener noreferrer">`,
			escapeAttr(href),
		), `</a>`
	case MarkTypeComment:
		id := stringAttr(m.Attrs, "id")
		if id == "" {
			return `<span class="tinycld-text-mark--comment">`, `</span>`
		}
		// data-comment-id is allowed on span by the sanitizer (see
		// render/sanitize.go); preserved here so future link-to-thread
		// enhancements can address the run.
		return fmt.Sprintf(
			`<span class="tinycld-text-mark--comment" data-comment-id="%s">`,
			escapeAttr(id),
		), `</span>`
	case MarkTypeTextStyle:
		// textStyle carries color / fontSize / fontFamily on a single
		// mark. We surface them as an inline `style="…"` attribute —
		// the shared sanitizer's safe-property allowlist passes
		// color / font-size / font-family through unchanged, and
		// browsers honor inline style universally (the earlier
		// `data-color` + CSS-attribute-selector approach left the
		// values in the DOM but produced no visible effect because
		// `attr()` outside `content:` isn't supported cross-browser).
		var decls []string
		if color := stringAttr(m.Attrs, "color"); color != "" && isSafeColor(color) {
			decls = append(decls, "color: "+color)
		}
		if bg := stringAttr(m.Attrs, "backgroundColor"); bg != "" && isSafeColor(bg) {
			decls = append(decls, "background-color: "+bg)
		}
		if sz := intAttrAny(m.Attrs, "fontSize"); sz > 0 {
			decls = append(decls, fmt.Sprintf("font-size: %dpx", sz))
		}
		if ff := stringAttr(m.Attrs, "fontFamily"); ff != "" {
			// Wrap in single quotes so multi-word families ("Times
			// New Roman") parse as one token. Strip any quote chars
			// from the input first; the sanitizer would otherwise
			// drop the whole style attribute if it sees a stray
			// quote that breaks CSS parsing.
			safe := strings.ReplaceAll(strings.ReplaceAll(ff, "'", ""), `"`, "")
			decls = append(decls, "font-family: '"+safe+"'")
		}
		if len(decls) == 0 {
			// Empty textStyle: no visible effect. Skip the wrapper to
			// keep the output compact.
			return "", ""
		}
		return fmt.Sprintf(
			`<span class="tinycld-text-mark--text-style" style="%s">`,
			escapeAttr(strings.Join(decls, "; ")),
		), `</span>`
	}
	r.writeUnsupported("mark", m.Type)
	return "", ""
}

// writeImage emits one <img> tag. wrap → modifier class; alt / title
// passthrough; width / height attrs surface only when set; src goes
// through resolveImageSrc which honors HTMLRenderOpts.Images.
func (r *htmlRenderer) writeImage(n PMNode) {
	src := stringAttr(n.Attrs, "src")
	resolved := r.resolveImageSrc(src)
	if resolved == "" {
		return
	}
	classes := []string{"tinycld-text-img"}
	switch stringAttr(n.Attrs, "wrap") {
	case "left":
		classes = append(classes, "tinycld-text-img-wrap--left")
	case "right":
		classes = append(classes, "tinycld-text-img-wrap--right")
	case "break":
		classes = append(classes, "tinycld-text-img-wrap--break")
	}
	attrs := map[string]string{"src": resolved}
	if alt := stringAttr(n.Attrs, "alt"); alt != "" {
		attrs["alt"] = alt
	}
	if title := stringAttr(n.Attrs, "title"); title != "" {
		attrs["title"] = title
	}
	if w := intAttrAny(n.Attrs, "width"); w > 0 {
		attrs["width"] = strconv.Itoa(w)
	}
	if h := intAttrAny(n.Attrs, "height"); h > 0 {
		attrs["height"] = strconv.Itoa(h)
	}
	attrs["loading"] = "lazy"
	attrs["decoding"] = "async"
	r.openTag("img", classes, attrs)
	// <img> is void — no close tag.
}

// resolveImageSrc maps a PM image src to the final emitted src
// according to HTMLRenderOpts.Images:
//
//   - data: URI in any mode → pass through unchanged.
//   - any other URL in ImageModeURL → pass through unchanged.
//   - any other URL in ImageModeEmbed → fetch via EmbedFetcher; if
//     the callback succeeds, emit a data: URI with the returned
//     bytes; if it fails (or no fetcher supplied), the image is
//     dropped (empty return).
func (r *htmlRenderer) resolveImageSrc(src string) string {
	if src == "" {
		return ""
	}
	if strings.HasPrefix(src, "data:") {
		return src
	}
	if r.opts.Images != ImageModeEmbed {
		return src
	}
	if r.opts.EmbedFetcher == nil {
		return src
	}
	mimeType, data, err := r.opts.EmbedFetcher(src)
	if err != nil || len(data) == 0 {
		return ""
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data)
}

// writeFootnoteReference emits a superscript reference (e.g. "[1]") for
// footnote / endnote markers. v1 doesn't include the body — emitting
// just the marker preserves the visual cue without committing to a
// notes-section layout we'd then have to keep in sync with the editor.
func (r *htmlRenderer) writeFootnoteReference(n PMNode, kind string) {
	id := stringAttr(n.Attrs, "id")
	if id == "" {
		id = "?"
	}
	r.b.WriteString(fmt.Sprintf(
		`<sup class="tinycld-text-%s-ref">[%s]</sup>`,
		kind, escapeHTML(id),
	))
}

func (r *htmlRenderer) writeUnsupported(kind, name string) {
	if !r.devMode {
		return
	}
	// Comment text is escaped to avoid premature "-->" sequences from
	// a hostile node name. The sanitizer strips comments anyway, so
	// this output is dev-only.
	r.b.WriteString("<!-- TODO: unsupported ")
	r.b.WriteString(kind)
	r.b.WriteString(" '")
	r.b.WriteString(strings.ReplaceAll(name, "-->", "--"))
	r.b.WriteString("' -->")
}

// openTag writes "<tag class=\"…\" attr=\"…\" …>" with attribute
// values HTML-escaped. Attrs are sorted by key for deterministic
// output (snapshot tests). The class list survives intact; the
// sanitizer's class-filter pass enforces the tinycld-* prefix later.
func (r *htmlRenderer) openTag(tag string, classes []string, attrs map[string]string) {
	r.b.WriteByte('<')
	r.b.WriteString(tag)
	if len(classes) > 0 {
		r.b.WriteString(` class="`)
		r.b.WriteString(strings.Join(classes, " "))
		r.b.WriteByte('"')
	}
	if len(attrs) > 0 {
		keys := make([]string, 0, len(attrs))
		for k := range attrs {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			r.b.WriteByte(' ')
			r.b.WriteString(k)
			r.b.WriteString(`="`)
			r.b.WriteString(escapeAttr(attrs[k]))
			r.b.WriteByte('"')
		}
	}
	r.b.WriteByte('>')
}

// sortMarks orders marks so the outermost wrapper is link, then
// comment, then formatting marks. Inside each group marks sort by
// Type alphabetically so snapshots are stable. The Tiptap schema does
// not promise a stable in-input order so we impose one here.
func sortMarks(in []PMMark) []PMMark {
	if len(in) <= 1 {
		return in
	}
	out := make([]PMMark, len(in))
	copy(out, in)
	sort.SliceStable(out, func(i, j int) bool {
		return markPriority(out[i].Type) < markPriority(out[j].Type)
	})
	return out
}

// markPriority returns the outer-to-inner sort key. Lower numbers
// nest farther from the text content (outer); ties fall back to type
// name for determinism.
func markPriority(t string) int {
	switch t {
	case MarkTypeLink:
		return 1
	case MarkTypeComment:
		return 2
	case MarkTypeBold:
		return 3
	case MarkTypeItalic:
		return 4
	case MarkTypeUnderline:
		return 5
	case MarkTypeStrike:
		return 6
	case MarkTypeCode:
		return 7
	case MarkTypeTextStyle:
		return 8
	}
	return 100
}

// appendAlignIndentClasses adds .tinycld-text-align--X and
// .tinycld-text-indent--N modifier classes to a block's class list
// based on its textAlign / indent attrs. Defaults ("left" / 0) are
// silently dropped — the base class already styles them correctly.
func appendAlignIndentClasses(classes []string, attrs map[string]any) []string {
	if attrs == nil {
		return classes
	}
	if align := stringAttr(attrs, "textAlign"); align != "" && align != "left" {
		switch align {
		case "center", "right", "justify":
			classes = append(classes, "tinycld-text-align--"+align)
		}
	}
	if indent := intAttrOr(attrs, "indent", 0); indent > 0 {
		if indent > MaxIndentLevel {
			indent = MaxIndentLevel
		}
		classes = append(classes, "tinycld-text-indent--"+strconv.Itoa(indent))
	}
	return classes
}

// linkURLAllowed mirrors the sanitizer's URL allowlist for hyperlink
// href attributes. http(s) and mailto: are permitted; javascript:,
// vbscript:, data:, file:, and anything unrecognised are dropped.
//
// Duplicated here at emit time (defense in depth) so a dropped mark
// becomes a "render text without the wrapper" rather than "render
// the wrapper and rely on the sanitizer to strip it later" — the
// sanitizer's URL check covers <img src>, not <a href>.
func linkURLAllowed(raw string) bool {
	s := strings.TrimSpace(raw)
	if s == "" {
		return false
	}
	// In-document fragment anchor (TOC entries, footnote refs, etc.).
	// Stays in the current page, no network request, no scheme.
	if s[0] == '#' {
		return true
	}
	// url.Parse tolerates inputs with leading control characters that
	// would confuse a simple prefix check (e.g. "\tjavascript:alert(1)").
	parsed, err := url.Parse(s)
	if err != nil {
		return false
	}
	switch strings.ToLower(parsed.Scheme) {
	case "http", "https", "mailto":
		return true
	}
	return false
}

// isSafeColor accepts the limited subset of CSS color values that PM's
// textStyle mark emits:
//
//   - 3/4/6/8-digit hex: #RGB, #RGBA, #RRGGBB, #RRGGBBAA.
//   - rgb()/rgba() tuples with strictly numeric content (digits,
//     commas, spaces, dots, percent — no parens, letters, or other
//     CSS function-call payload).
//   - A small whitelist of CSS-named colors (the common ones tiptap
//     emits).
//
// SAFETY CRITICAL: the previous implementation allowed any
// alphanumeric + parens + commas string, which let `url(javascript:…)`
// pass through (only `j`, `a`, `v`, etc., parens, and a colon would
// be needed — colon was already excluded but `urljavascript` style
// without scheme could still embed in another context). Tightening
// to explicit patterns removes the smuggling surface entirely.
func isSafeColor(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" || len(s) > 32 {
		return false
	}
	if s[0] == '#' {
		hex := s[1:]
		switch len(hex) {
		case 3, 4, 6, 8:
		default:
			return false
		}
		for i := 0; i < len(hex); i++ {
			c := hex[i]
			switch {
			case c >= '0' && c <= '9',
				c >= 'a' && c <= 'f',
				c >= 'A' && c <= 'F':
			default:
				return false
			}
		}
		return true
	}
	lower := strings.ToLower(s)
	if strings.HasPrefix(lower, "rgb(") || strings.HasPrefix(lower, "rgba(") {
		if !strings.HasSuffix(s, ")") {
			return false
		}
		open := strings.IndexByte(s, '(')
		inner := s[open+1 : len(s)-1]
		for i := 0; i < len(inner); i++ {
			c := inner[i]
			switch {
			case c >= '0' && c <= '9',
				c == ',', c == ' ', c == '.', c == '%':
			default:
				return false
			}
		}
		return true
	}
	// Named colors — narrow whitelist. tiptap's text-style extension
	// occasionally emits "transparent"/"inherit"; the rest are common
	// editor swatches.
	switch lower {
	case "transparent", "inherit", "currentcolor",
		"black", "white", "red", "green", "blue", "yellow", "orange",
		"purple", "pink", "gray", "grey", "cyan", "magenta", "brown":
		return true
	}
	return false
}

// escapeAttr escapes HTML attribute values. The five-char set matches
// escapeHTML below; alias for readability at call sites.
func escapeAttr(s string) string {
	return escapeHTML(s)
}

// escapeHTML is the five-char HTML escape used for both text and
// attribute content. Mirrors render/sanitize.go::escapeHTML.
func escapeHTML(s string) string {
	if !needsEscape(s) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s) + 8)
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '&':
			b.WriteString("&amp;")
		case '<':
			b.WriteString("&lt;")
		case '>':
			b.WriteString("&gt;")
		case '"':
			b.WriteString("&quot;")
		case '\'':
			b.WriteString("&#39;")
		default:
			b.WriteByte(s[i])
		}
	}
	return b.String()
}

func needsEscape(s string) bool {
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '&', '<', '>', '"', '\'':
			return true
		}
	}
	return false
}

// stringAttr returns attrs[key] if present and string-typed. Empty
// string fallback covers both absent keys and non-string values; the
// renderer treats both identically.
func stringAttr(attrs map[string]any, key string) string {
	if attrs == nil {
		return ""
	}
	v, ok := attrs[key]
	if !ok {
		return ""
	}
	s, _ := v.(string)
	return s
}

// intAttrOr returns attrs[key] as a non-negative int with a caller-
// supplied default for absent / non-numeric values. PM JSON encodes
// integers as float64 (Go's default for json.Number-less unmarshal),
// so we accept float64 and round. The "Or" suffix distinguishes this
// from pm_to_docx.go's intAttr, which is a zero-default variant.
func intAttrOr(attrs map[string]any, key string, def int) int {
	if attrs == nil {
		return def
	}
	v, ok := attrs[key]
	if !ok {
		return def
	}
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	case string:
		// tolerate string-encoded integers for forward compat.
		i, err := strconv.Atoi(n)
		if err != nil {
			return def
		}
		return i
	}
	return def
}

// intAttrAny is intAttrOr's "give me whatever number is there"
// variant. Returns 0 for absent / non-numeric values.
func intAttrAny(attrs map[string]any, key string) int {
	return intAttrOr(attrs, key, 0)
}
