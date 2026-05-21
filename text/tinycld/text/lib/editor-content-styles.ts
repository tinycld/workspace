// CSS rules that style the ProseMirror content area for the document
// editor. Shared by the web in-page editor (use-document-editor.web.tsx)
// and the WebView editor used on native (webview-editor/source/styles.ts).
//
// Why this exists: Tailwind/Uniwind preflight strips browser defaults
// from headings, lists, links, blockquotes, and tables. Without these
// rules, an imported .docx renders as a flat wall of 14px text — no
// heading hierarchy, no bullets/numbers, no link styling. These rules
// put the document semantics back.
//
// Colors come from CSS custom properties so light/dark mode works on
// the web side. The host (web or WebView entry) is responsible for
// setting the variables before rules are applied:
//
//   --editor-foreground:    body text color
//   --editor-muted:         secondary text (blockquote, captions)
//   --editor-border:        table/blockquote borders
//   --editor-link:          hyperlink color
//   --editor-placeholder:   placeholder text when empty
//
// On the web side these are set via inline style on the wrapper, fed
// from useThemeColor(). The WebView is light-mode only today and
// supplies hardcoded fallbacks at the :root level.
export const EDITOR_CONTENT_STYLES = `
.ProseMirror {
    outline: none;
    min-height: 200px;
    color: var(--editor-foreground, #1a1a1a);
    /* 15px is visually equivalent to Word's 11pt body size; declaring
       11pt directly is correct in CSS but browsers compute it to
       14.667px, which renders blurrier than a whole-pixel size. */
    font: 15px / 1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    /* Cap the content area at roughly a US Letter page's usable width
       (8.5in - 2*1in margins = 6.5in, ≈ 624px at 96dpi, plus a small
       fudge for breathing room) and center it. This is the same choice
       Google Docs / Notion / Word's "Web Layout" make: tables, images,
       and lines of text render at the same proportions a Word user sees
       on a printed page, instead of stretching to fill the editor pane.
       Tables imported from .docx use absolute dxa widths, so anchoring
       the surrounding canvas to a page-equivalent width is what makes
       those widths look right. */
    max-width: 680px;
    width: 100%;
    margin-left: auto;
    margin-right: auto;
}
.ProseMirror p {
    margin: 0 0 0.75em 0;
}
.ProseMirror h1 {
    font-size: 2em;
    font-weight: 700;
    line-height: 1.2;
    margin: 0.67em 0 0.4em;
}
.ProseMirror h2 {
    font-size: 1.5em;
    font-weight: 700;
    line-height: 1.25;
    margin: 0.8em 0 0.4em;
}
.ProseMirror h3 {
    font-size: 1.17em;
    font-weight: 700;
    line-height: 1.3;
    margin: 0.8em 0 0.4em;
}
.ProseMirror h4 {
    font-size: 1em;
    font-weight: 700;
    margin: 1em 0 0.4em;
}
.ProseMirror h5 {
    font-size: 0.9em;
    font-weight: 700;
    margin: 1em 0 0.4em;
}
.ProseMirror h6 {
    font-size: 0.8em;
    font-weight: 700;
    margin: 1em 0 0.4em;
}
.ProseMirror blockquote {
    border-left: 3px solid var(--editor-border, #ccc);
    margin: 0 0 0.75em 0;
    padding-left: 1em;
    color: var(--editor-muted, #555);
}
.ProseMirror ul,
.ProseMirror ol {
    padding-left: 2.5em;
    margin: 0 0 0.75em 0;
}
/* Nested lists indent further (Word's default abstractNum
   adds ~0.25" / 360 twips per level over the parent). */
.ProseMirror li > ul,
.ProseMirror li > ol {
    padding-left: 2em;
    margin: 0;
}
.ProseMirror ul {
    list-style: disc;
}
.ProseMirror ol {
    list-style: decimal;
}
.ProseMirror ul ul {
    list-style: circle;
}
.ProseMirror ul ul ul {
    list-style: square;
}
.ProseMirror li {
    display: list-item;
    margin: 0.15em 0;
}
.ProseMirror li > p {
    margin: 0;
}
.ProseMirror a {
    color: var(--editor-link, #1d4ed8);
    text-decoration: underline;
}
.ProseMirror table {
    border-collapse: collapse;
    margin: 0 0 0.75em 0;
    /* TipTap's TableView writes inline style.width from the summed
       per-cell colwidth attributes (one entry per column) and inserts
       a <colgroup> sized to match. Tables imported from .docx carry
       their original column widths through that pipeline, so we let
       the inline style win instead of forcing every table to 100%
       width. Tables authored in the editor without explicit widths
       still get a sensible auto-layout via the TableView fallback. */
    table-layout: fixed;
}
.ProseMirror th,
.ProseMirror td {
    /* Anchors the absolutely-positioned .column-resize-handle (rendered
       by Tiptap's columnResizing plugin) to the cell's trailing edge.
       Without this, the handle escapes to the nearest positioned
       ancestor and the teal indicator appears at the page border. */
    position: relative;
    border: 1px solid var(--editor-border, #ddd);
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
}
.ProseMirror th {
    background: var(--editor-table-header, #f3f4f6);
    font-weight: 600;
}
/* Column resize affordance. Tiptap's columnResizing plugin renders a
   .column-resize-handle inside each cell on the trailing edge while
   hovering or dragging; it sets body.cursor via .resize-cursor while
   a drag is active. Tint with the brand primary so the handle is
   visible in both light and dark mode. The handle's width is set by
   Table.configure({ handleWidth }) on the JS side; the CSS only
   controls color + cursor. */
.ProseMirror .column-resize-handle {
    position: absolute;
    right: -2px;
    top: 0;
    bottom: -2px;
    width: 4px;
    background-color: var(--editor-primary-color, #14b8a6);
    pointer-events: none;
}
.ProseMirror.resize-cursor {
    cursor: col-resize;
}
/* TableView wraps each <table> in a .tableWrapper div so it can host
   the absolutely-positioned resize handle without escaping the cell.
   Make sure overflow scrolls horizontally on narrow viewports instead
   of clipping the handle. */
.ProseMirror .tableWrapper {
    overflow-x: auto;
    margin: 0 0 0.75em 0;
}
.ProseMirror .tableWrapper > table {
    margin: 0;
}
/* Multi-cell selection (CellSelection from prosemirror-tables). Drives
   the visual highlight when the user shift-drags across cells. Without
   this the selection is invisible and merge-cells UI feels broken. */
.ProseMirror .selectedCell {
    background-color: color-mix(in srgb, var(--editor-primary-color, #14b8a6) 18%, transparent);
}
.ProseMirror img {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 0.5em 0;
}
/* The web editor renders images through ImageNodeView, which wraps the
   img in a [data-node-view-wrapper] span and copies the wrap attr onto
   it as data-wrap. Float the WRAPPER (not the img) — text only wraps
   around a floated direct child of the paragraph. Sizing comes from
   the inline width/height the NodeView sets on the wrapper, so the
   cap below is just a safety net for oversized fixtures. */
.ProseMirror [data-node-view-wrapper][data-wrap='left'] {
    float: left;
    margin: 0.25em 1em 0.5em 0;
    max-width: 50%;
}
.ProseMirror [data-node-view-wrapper][data-wrap='right'] {
    float: right;
    margin: 0.25em 0 0.5em 1em;
    max-width: 50%;
}
/* Break mode (Word's "Top and Bottom"): the image takes its own line,
   floats above are cleared, text below resumes on a fresh row. Centered
   horizontally via auto margins so users who pick break mode get the
   centered layout Word writers expect. */
.ProseMirror [data-node-view-wrapper][data-wrap='break'] {
    display: block;
    float: none;
    clear: both;
    margin: 0.75em auto;
    max-width: 100%;
}
/* Legacy selectors for the native WebView editor, which still renders
   images as bare <img>s with data-wrap on the element itself (no
   NodeView wrapping). Keep these in sync with the wrapper rules above
   so behavior on native matches the web. */
.ProseMirror img[data-wrap='left'] {
    float: left;
    display: inline;
    margin: 0.25em 1em 0.5em 0;
    max-width: 50%;
}
.ProseMirror img[data-wrap='right'] {
    float: right;
    display: inline;
    margin: 0.25em 0 0.5em 1em;
    max-width: 50%;
}
.ProseMirror img[data-wrap='break'] {
    display: block;
    float: none;
    clear: both;
    margin: 0.75em auto;
    max-width: 100%;
}
/* Block-level / break-mode elements clear preceding floats. The break-mode
   image is in this list because it should never sit beside a float — that's
   the contract of Word's "Top and Bottom" mode. */
.ProseMirror h1,
.ProseMirror h2,
.ProseMirror h3,
.ProseMirror h4,
.ProseMirror h5,
.ProseMirror h6,
.ProseMirror table,
.ProseMirror [data-node-view-wrapper][data-wrap='break'],
.ProseMirror img[data-wrap='break'] {
    clear: both;
}
/* Inline code mark. A subtle monospace span with a muted background,
   matching the GitHub / Discord render of <code> in prose. Border
   radius keeps the corners tidy when the run sits mid-sentence. */
.ProseMirror code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
    font-size: 0.9em;
    padding: 1px 4px;
    border-radius: 3px;
    background-color: var(--editor-code-bg, rgba(127, 127, 127, 0.15));
}
/* Code block. Tiptap renders this as <pre><code>; the <code> child
   sits inside a block-level <pre> so we reset the inline padding /
   background above and apply the block presentation here. white-
   space: pre-wrap keeps long lines from forcing horizontal scroll
   while still preserving authored indentation and line breaks. */
.ProseMirror pre {
    margin: 0 0 0.75em 0;
    padding: 12px;
    border-radius: 6px;
    background-color: var(--editor-code-bg, rgba(127, 127, 127, 0.15));
    overflow-x: auto;
}
.ProseMirror pre code {
    display: block;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
    font-size: 0.9em;
    padding: 0;
    background: transparent;
    border-radius: 0;
    white-space: pre-wrap;
    word-break: break-word;
}
.ProseMirror.is-editor-empty:first-child::before {
    content: attr(data-placeholder);
    color: var(--editor-placeholder, #999);
    pointer-events: none;
    float: left;
    height: 0;
}
/* Find/replace match highlighting. The find-replace plugin paints
   every match with .text-find-match and the currently focused match
   with .text-find-match-active. The colors are derived from theme
   tokens via CSS vars so light/dark mode tracks the rest of the UI. */
.ProseMirror .text-find-match {
    background-color: var(--editor-find-match, rgba(255, 213, 79, 0.45));
    border-radius: 2px;
}
.ProseMirror .text-find-match-active {
    background-color: var(--editor-find-match-active, rgba(255, 152, 0, 0.7));
    border-radius: 2px;
}
/* Comment marks. A subtle yellow underline keeps the anchored range
   visible without overwhelming the surrounding text. Hover paints a
   matching highlight so it's clear a click will target the mark. The
   span is inserted by the tinycldComment Mark with class
   .tinycld-comment. */
.ProseMirror .tinycld-comment {
    border-bottom: 2px solid var(--editor-comment-underline, rgba(250, 204, 21, 0.85));
    cursor: pointer;
}
.ProseMirror .tinycld-comment:hover {
    background-color: var(--editor-comment-highlight, rgba(250, 204, 21, 0.22));
}
`
