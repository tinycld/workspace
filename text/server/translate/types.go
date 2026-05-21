// Package translate converts between ProseMirror JSON (the editor's
// native format) and OOXML (.docx) bytes. The package is the heart of
// @tinycld/text: every save sends Y.Doc -> ProseMirror JSON -> OOXML
// -> Drive, and every bootstrap sends OOXML -> ProseMirror JSON -> Y.Doc.
//
// Round-trip fidelity is load-bearing: text uses the .docx file as
// canonical source of truth, so any property dropped in PM->OOXML or
// OOXML->PM compounds with every save. The supported node and mark
// sets below are the load-bearing contract; round-trip tests live in
// roundtrip_test.go.
package translate

// PMNode is a ProseMirror tree node, mirroring the JSON shape Tiptap
// emits/consumes. The Type field is restricted to a fixed enum (see
// SupportedNodeTypes); marks to SupportedMarks. Translator code must
// not produce or accept node/mark types outside this set without
// extending all four of: editor schema, translator, WordZero coverage,
// and round-trip golden tests.
type PMNode struct {
	Type    string         `json:"type"`
	Attrs   map[string]any `json:"attrs,omitempty"`
	Content []PMNode       `json:"content,omitempty"`
	Text    string         `json:"text,omitempty"`
	Marks   []PMMark       `json:"marks,omitempty"`
}

// PMMark is a ProseMirror inline mark applied to a text node — bold,
// italic, underline, or link. Attrs holds mark-specific properties
// (e.g. link href). Type is restricted to SupportedMarks.
type PMMark struct {
	Type  string         `json:"type"`
	Attrs map[string]any `json:"attrs,omitempty"`
}

// Node type constants. Keep this list in sync with the editor schema
// in @tinycld/core/lib/editor/use-document-editor.web.tsx.
const (
	NodeTypeDoc               = "doc"
	NodeTypeParagraph         = "paragraph"
	NodeTypeHeading           = "heading"
	NodeTypeBulletList        = "bulletList"
	NodeTypeOrderedList       = "orderedList"
	NodeTypeListItem          = "listItem"
	NodeTypeBlockquote        = "blockquote"
	NodeTypeTable             = "table"
	NodeTypeTableRow          = "tableRow"
	NodeTypeTableCell         = "tableCell"
	NodeTypeImage             = "image"
	NodeTypeText              = "text"
	NodeTypePageBreak         = "pageBreak"
	NodeTypeFootnoteReference = "footnoteReference"
	NodeTypeEndnoteReference  = "endnoteReference"
	// NodeTypeCodeBlock is a preformatted block whose text content is
	// rendered monospace and verbatim — Tiptap's <pre><code> structure
	// on the editor side, a paragraph with pStyle="CodeBlock" on the
	// OOXML side. The PM node carries plain text children only (no
	// inline marks); the importer recognises Word's "Code" /
	// "HTMLPreformatted" / "Preformatted" pStyle aliases too.
	NodeTypeCodeBlock = "codeBlock"
)

// SupportedNodeTypes is the load-bearing contract: any node type
// outside this set is unrepresentable end-to-end. The OOXML parser
// degrades unknown elements (with WarningUnsupportedNode); the
// emitter rejects them as a programmer error.
var SupportedNodeTypes = map[string]bool{
	NodeTypeDoc: true, NodeTypeParagraph: true, NodeTypeHeading: true,
	NodeTypeBulletList: true, NodeTypeOrderedList: true, NodeTypeListItem: true,
	NodeTypeBlockquote: true, NodeTypeTable: true, NodeTypeTableRow: true,
	NodeTypeTableCell: true, NodeTypeImage: true, NodeTypeText: true,
	NodeTypePageBreak: true, NodeTypeFootnoteReference: true, NodeTypeEndnoteReference: true,
	NodeTypeCodeBlock: true,
}

// Mark type constants.
const (
	MarkTypeBold      = "bold"
	MarkTypeItalic    = "italic"
	MarkTypeUnderline = "underline"
	// MarkTypeStrike is the strike-through (line-through) inline mark.
	// Tiptap's StarterKit ships the matching `strike` mark; the HTML
	// renderer surfaces it as <span class="tinycld-text-mark--strike">
	// styled with `text-decoration: line-through` in preview-css.ts and
	// the print stylesheets. Strike does not currently round-trip
	// through OOXML — pm_to_docx silently drops the mark on export and
	// docx_to_pm doesn't import <w:strike/>. Full round-trip is tracked
	// separately; the HTML renderer's coverage here ensures previews
	// and prints of editor-only documents render the formatting.
	MarkTypeStrike = "strike"
	MarkTypeLink   = "link"
	// MarkTypeTextStyle carries the @tiptap/extension-text-style mark.
	// Attributes supported on the mark:
	//   - color:      Word <w:color w:val="RRGGBB"> ⇄ "#RRGGBB" hex
	//   - fontSize:   Word <w:sz w:val="half-points"> ⇄ integer CSS px
	//   - fontFamily: Word <w:rFonts w:ascii="…"> ⇄ family name string
	// All three live on a single mark instance per run so a run with
	// e.g. {color, fontSize, fontFamily} stays one mark, not three —
	// matches how @tiptap/extension-text-style attaches attributes to a
	// single <span style="…"> on the DOM side.
	MarkTypeTextStyle = "textStyle"
	// MarkTypeComment is applied to the run-spans covered by a
	// <w:commentRangeStart>…<w:commentRangeEnd> pair in word/document.xml.
	// Attrs carry the resolved metadata from word/comments.xml: id (string),
	// author, text (plain text body of the comment), date (ISO timestamp).
	// On export the comment XML part + body markers + reference run are
	// regenerated from these attrs, so dropping or editing the mark
	// removes the comment cleanly.
	MarkTypeComment = "comment"
	// MarkTypeCode is the inline equivalent of NodeTypeCodeBlock — a
	// monospaced verbatim span. Round-trips through OOXML as a
	// <w:rStyle w:val="VerbatimChar"/> on the run's <w:rPr>. Tiptap's
	// StarterKit ships the matching `code` inline mark (<code>…</code>
	// on the DOM side).
	MarkTypeCode = "code"
)

// SupportedMarks is the analog of SupportedNodeTypes for inline marks.
var SupportedMarks = map[string]bool{
	MarkTypeBold:      true,
	MarkTypeItalic:    true,
	MarkTypeUnderline: true,
	MarkTypeStrike:    true,
	MarkTypeLink:      true,
	MarkTypeTextStyle: true,
	MarkTypeComment:   true,
	MarkTypeCode:      true,
}

// Paragraph alignment + indent. textAlign is "left" | "center" |
// "right" | "justify" on paragraph and heading nodes; indent is a
// non-negative integer level (0..MaxIndentLevel) on the same nodes.
// Defaults ("left" / 0) are omitted from the PM JSON to keep the
// 99% of paragraphs that don't carry either compact.
//
// twipsPerIndentLevel is Word's standard half-inch tab indent (1440
// twips = 1 inch, so 720 twips = 0.5 inch). Importer round-trips
// existing Word indents to nearest level. The editor's CSS render
// uses indentPxPerLevel = 36 px/level — slightly narrower than the
// Word default 48 px (0.5 inch) so deeply indented paragraphs don't
// crowd the right margin in the 680px-wide editor canvas.
const (
	MaxIndentLevel      = 8
	twipsPerIndentLevel = 720
)

// Warning is a typed signal that an OOXML import succeeded but
// dropped or simplified some content. Surfaced to the client via
// MsgServerHello on bootstrap; rendered as a dismissable banner.
type Warning struct {
	Code    WarningCode    `json:"code"`
	Detail  string         `json:"detail,omitempty"`
	Context map[string]any `json:"context,omitempty"`
}

// WarningCode is the string-typed enum for Warning.Code. See the
// constants below for the supported set.
type WarningCode string

const (
	WarningTrackedChanges       WarningCode = "trackedChanges"
	WarningComments             WarningCode = "comments"
	WarningContentControls      WarningCode = "contentControls"
	WarningUnsupportedStyle     WarningCode = "unsupportedStyle"
	WarningUnsupportedNode      WarningCode = "unsupportedNode"
	WarningImageTooLarge        WarningCode = "imageTooLarge"
	WarningUnsupportedImageType WarningCode = "unsupportedImageType"
	// WarningBackgroundColorLost is emitted when a textStyle mark's
	// backgroundColor isn't a 6-digit hex (or a normalizable rgb()/
	// rgba() value). OOXML's <w:shd w:fill="…"> only accepts hex, so
	// the run gets emitted without a background. The HTML render
	// preserves the original color; the .docx loses it.
	WarningBackgroundColorLost WarningCode = "backgroundColorLost"
	// WarningCellContentFlattened is emitted when a table cell holds
	// block content the v1 .docx exporter can't represent natively
	// (e.g. a nested table or a list). Rather than fail the whole
	// conversion, the exporter flattens that child's text into a
	// plain paragraph inside the cell so the visible content survives.
	// Structure (nested rows, list bullets) is lost in the .docx.
	WarningCellContentFlattened WarningCode = "cellContentFlattened"
)
