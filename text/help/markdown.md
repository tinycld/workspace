---
title: Markdown import and export
summary: Paste Markdown into a document and download a document as Markdown
tags: [markdown, import, export, paste, download]
order: 75
---

The text editor stores documents as `.docx`, but you can move content in and out as Markdown — useful for pasting in a README, a chat message, or a snippet from another tool, and for sending a document somewhere that wants plain Markdown.

## To paste Markdown into a document

1. Copy the Markdown source from wherever it lives (a `.md` file, a chat message, a code review).
2. Place the caret where you want it to land.
3. Pick **Edit → Paste as Markdown**.

The clipboard contents are parsed as Markdown and inserted as structured content — a `# Heading` line becomes a real heading, `- item` lines become a bullet list, a fenced ` ``` ` block becomes a [code block](help://text:code-blocks), and so on. The caret ends up after the inserted content.

If you press **⌘V** instead, the editor uses the standard paste path: HTML on the clipboard wins (so copying from a web page keeps its formatting), and plain text drops in as a paragraph. Reach for **Edit → Paste as Markdown** when you want Markdown source to land as structured content rather than as literal `#` and `*` characters.

## To download a document as Markdown

1. Open **File → Download (.md)**.

The current document is converted to Markdown and saved to your downloads folder as `<document name>.md`. The file is regenerated from the live editor state each time — it always matches what you see on screen.

`File → Download (.docx)` is still there next to it; `.docx` is the canonical format and round-trips every formatting feature the editor supports. Use `.md` when the destination wants Markdown.

## What survives the round-trip

These constructs map cleanly to Markdown and back:

| In the editor | Markdown |
| --- | --- |
| Paragraph | plain line |
| Headings 1–6 | `#` through `######` |
| Bullet list | `- item` |
| Numbered list | `1. item` |
| Blockquote | `> text` |
| Code block (fenced) | triple-backtick fence |
| Table | GFM pipe table |
| Image (URL) | `![alt](https://…)` |
| Page break | `---` (thematic break) |
| Bold | `**bold**` |
| Italic | `*italic*` |
| Inline code | `` `code` `` |
| Link | `[label](href)` |

## What does not survive an export to Markdown

Markdown has no syntax for these, so they are dropped from the `.md` file. They stay on the underlying document — close the `.md` you exported, keep editing in the editor, and they are still there. They simply do not appear in the Markdown copy.

- **Underline** — Markdown has no underline syntax.
- **Font color, size, and family** — Markdown is unstyled.
- **Paragraph alignment and indent** — center / right / justify and left-indent all flatten to a regular paragraph.
- **Comments** — comments stay attached to the document, but the `.md` file only contains the underlying text.
- **Footnotes and endnotes** — dropped.
- **Image dimensions and text wrap** — every image emits as `![alt](src)` at its natural size, with no wrap.
- **Table cell shading and cell borders** — pipe tables have no styling; cells emit as plain text. See [Shading table cells](help://text:table-shading) for the editor-side feature.

If you need any of these preserved, download as `.docx` instead.

## What does not survive paste from Markdown

Anything outside the supported subset above becomes plain text. In particular:

- Raw HTML embedded in the Markdown source (`<div>`, `<span style="…">`, etc.) is inserted verbatim as text rather than parsed — Markdown's HTML pass-through is not honored.
- Markdown extensions outside CommonMark + GFM tables (footnotes, task lists, definition lists, math) drop to plain text.
- Multi-paragraph table cells collapse to a single line — pipe tables can only hold inline content.

The simplest way to confirm what you'll get: paste, glance at the result, and undo with **⌘Z** if it isn't what you wanted.
