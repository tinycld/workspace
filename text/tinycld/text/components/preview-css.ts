// preview-css.ts is the styling layer for the text preview surface.
// The server emits stable `tinycld-text*` class names; this file
// turns those into a theme-aware visual treatment for the read-only
// preview iframe.
//
// The iframe is sandboxed (no scripts, same-origin) so we cannot pull
// theme tokens from the parent. We embed both light and dark palettes
// and switch via `@media (prefers-color-scheme)` — the OS-level
// preference closely matches what the app would pick anyway, and the
// preview is short-lived enough that drift between the two is
// uninteresting.
//
// Class vocabulary documented at server/translate/pm_to_html.go.
//
// Design intent: "Google-Docs-readable in either theme." Sane line
// length, comfortable line height, no decorative chrome. Inline marks
// (bold/italic/etc.) carry their own class so we can target them
// regardless of which tiptap node they're attached to.
export const PREVIEW_CSS = `
:root {
    color-scheme: light dark;
    --tc-fg: #18181b;
    --tc-bg: #ffffff;
    --tc-muted: #71717a;
    --tc-border: #e4e4e7;
    --tc-quote-bar: #d4d4d8;
    --tc-code-bg: #f4f4f5;
    --tc-table-header-bg: #fafafa;
    --tc-link: #2563eb;
    --tc-comment-bg: rgba(250, 204, 21, 0.25);
}
@media (prefers-color-scheme: dark) {
    :root {
        --tc-fg: #fafafa;
        --tc-bg: #09090b;
        --tc-muted: #a1a1aa;
        --tc-border: #27272a;
        --tc-quote-bar: #3f3f46;
        --tc-code-bg: #18181b;
        --tc-table-header-bg: #18181b;
        --tc-link: #60a5fa;
        --tc-comment-bg: rgba(250, 204, 21, 0.18);
    }
}
html, body { margin: 0; padding: 0; }
body {
    font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.55;
    color: var(--tc-fg);
    background: var(--tc-bg);
}
.tinycld-text {
    max-width: 760px;
    margin: 0 auto;
    padding: 24px 32px;
}
.tinycld-text-p {
    margin: 0 0 0.75em 0;
}
.tinycld-text-h1, .tinycld-text-h2, .tinycld-text-h3,
.tinycld-text-h4, .tinycld-text-h5, .tinycld-text-h6 {
    margin: 1.2em 0 0.4em 0;
    font-weight: 700;
    line-height: 1.25;
    /* Headings always start their own row: a preceding floated image
     * must not push the heading text into the float's wrap column.
     * Matches the ProseMirror editor's rule (editor-content-styles.ts)
     * so the preview and the editor agree on where a new section starts. */
    clear: both;
}
.tinycld-text-h1 { font-size: 1.9em; }
.tinycld-text-h2 { font-size: 1.55em; }
.tinycld-text-h3 { font-size: 1.3em; }
.tinycld-text-h4 { font-size: 1.15em; }
.tinycld-text-h5 { font-size: 1em; }
.tinycld-text-h6 { font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.04em; }
.tinycld-text-align--left { text-align: left; }
.tinycld-text-align--center { text-align: center; }
.tinycld-text-align--right { text-align: right; }
.tinycld-text-align--justify { text-align: justify; }
.tinycld-text-indent--1 { padding-left: 36px; }
.tinycld-text-indent--2 { padding-left: 72px; }
.tinycld-text-indent--3 { padding-left: 108px; }
.tinycld-text-indent--4 { padding-left: 144px; }
.tinycld-text-indent--5 { padding-left: 180px; }
.tinycld-text-indent--6 { padding-left: 216px; }
.tinycld-text-indent--7 { padding-left: 252px; }
.tinycld-text-indent--8 { padding-left: 288px; }
.tinycld-text-blockquote {
    border-left: 4px solid var(--tc-quote-bar);
    padding: 0.25em 0 0.25em 1em;
    margin: 0 0 0.75em 0;
    color: var(--tc-muted);
}
.tinycld-text-pre {
    background: var(--tc-code-bg);
    border-radius: 6px;
    padding: 12px 14px;
    margin: 0 0 0.75em 0;
    overflow-x: auto;
}
.tinycld-text-code-block,
.tinycld-text-mark--code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9em;
}
.tinycld-text-mark--code {
    background: var(--tc-code-bg);
    padding: 1px 5px;
    border-radius: 3px;
}
.tinycld-text-ul, .tinycld-text-ol {
    margin: 0 0 0.75em 0;
    padding-left: 1.6em;
}
/* Word frequently emits a bullet sub-list as a sibling of its
 * containing ordered list (separate numId per list style), so the PM
 * tree has the ul next to the ol rather than nested. Indenting bullet
 * lists deeper restores the visual hierarchy of "outline + sub-points"
 * without needing structural surgery on the parsed PM document. */
.tinycld-text-ul {
    padding-left: 3.2em;
}
.tinycld-text-li {
    margin: 0.15em 0;
}
.tinycld-text-li > .tinycld-text-p {
    margin: 0;
}
.tinycld-text-hr {
    border: none;
    border-top: 1px solid var(--tc-border);
    margin: 1em 0;
    clear: both;
}
.tinycld-text-table {
    border-collapse: collapse;
    margin: 0 0 0.75em 0;
    table-layout: fixed;
    max-width: 100%;
    /* Tables, like headings, start their own row beneath any preceding
     * floated image. */
    clear: both;
}
.tinycld-text-tr {
    border: none;
}
.tinycld-text-th, .tinycld-text-td {
    border: 1px solid var(--tc-border);
    padding: 6px 10px;
    vertical-align: top;
    text-align: left;
}
.tinycld-text-th {
    background: var(--tc-table-header-bg);
    font-weight: 600;
}
.tinycld-text-img {
    max-width: 100%;
    height: auto;
}
.tinycld-text-img-wrap--left {
    float: left;
    margin: 0.25em 1em 0.5em 0;
}
.tinycld-text-img-wrap--right {
    float: right;
    margin: 0.25em 0 0.5em 1em;
}
.tinycld-text-img-wrap--break {
    display: block;
    clear: both;
    margin: 0.5em 0;
}
/* A paragraph that hosts a left/right-floated image starts a fresh
 * block formatting context AND clears the matching side. Without
 * this, the second image in a sequence of float-with-text paragraphs
 * (Word's classic "image with caption" pattern repeated down a page)
 * gets placed against the previous float's right edge rather than at
 * the container's left edge: clear on the img alone moves it down
 * vertically but the paragraph's line box has already been narrowed
 * by the prior float, and the new float pops in at that narrowed x.
 * Clearing the paragraph drops the paragraph past the prior float
 * first, so its inner float starts from a fresh x=0. */
.tinycld-text-p-with-float--left {
    clear: left;
}
.tinycld-text-p-with-float--right {
    clear: right;
}
.tinycld-text-mark--bold { font-weight: 700; }
.tinycld-text-mark--italic { font-style: italic; }
.tinycld-text-mark--underline { text-decoration: underline; }
.tinycld-text-mark--strike { text-decoration: line-through; }
.tinycld-text-mark--link {
    color: var(--tc-link);
    text-decoration: underline;
}
.tinycld-text-mark--comment {
    background: var(--tc-comment-bg);
    border-bottom: 1px dashed var(--tc-muted);
    padding: 0 1px;
}
/* .tinycld-text-mark--text-style: color / font-size / font-family
 * are projected by the renderer as an inline style attribute on
 * the span; the sanitizer's safe-property allowlist passes those
 * properties through. No CSS rule is required here. */
.tinycld-text-footnote-ref, .tinycld-text-endnote-ref {
    font-size: 0.75em;
    color: var(--tc-muted);
    margin-left: 1px;
}
`
