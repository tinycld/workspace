---
title: Keyboard shortcuts
summary: Every keyboard shortcut the text editor binds, with what each one actually does
tags: [keyboard, shortcuts, hotkeys, reference]
order: 80
---

Shortcuts are shown for whichever platform you're reading from — on Windows or Linux, **Ctrl** and **Shift** stand in for the Mac modifier keys automatically.

## Inline formatting

These toggle character-level formatting on the current selection. With no selection, the next text you type takes the format.

| Shortcut | What it does |
|---|---|
| **⌘B** | Toggles **bold** on the selection — or starts a bold run from the caret. |
| **⌘I** | Toggles _italic_ on the selection. |
| **⌘U** | Toggles underline on the selection. |
| **⌘`** | Toggles inline `code` — a monospace span with a muted background, for variable names and short snippets. See [Formatting code](help://text:code-blocks). |
| **⌘K** | Opens the link popover for the selection. Paste or type a URL and press Enter to insert. With a link already in the selection, this edits it. |
| **⌘Z** | Undoes the last edit. Edits are collaborative-aware, so you only undo your own changes, not your collaborators'. |
| **⌘⇧Z** | Redoes an undone edit. |

## Block formatting

These act on the entire paragraph (or heading) containing the caret — no need to select the whole line.

| Shortcut | What it does |
|---|---|
| **⌘⇧L** | Left-aligns the current paragraph. |
| **⌘⇧E** | Centers the current paragraph. |
| **⌘⇧R** | Right-aligns the current paragraph. |
| **⌘⇧J** | Justifies the current paragraph (left + right edges align). See [Aligning and indenting paragraphs](help://text:alignment-indent). |
| **⌘]** | Increases the paragraph's left-indent by one level (36 px). |
| **⌘[** | Decreases the paragraph's left-indent by one level. Disabled at the leftmost stop. |
| **⌘⇧`** | Toggles the current line into (or out of) a code block — a multi-line monospace box for code listings or command output. |

## Inserting content

| Shortcut | What it does |
|---|---|
| **/** | Opens the slash menu at the caret. Type to filter, ↑/↓ to navigate, Enter to insert a heading, list, table, image, or other block. See [Inserting blocks with the slash menu](help://text:slash-menu). |

## Navigation & document

| Shortcut | What it does |
|---|---|
| **⌘F** | Opens the Find / Replace bar. Enter cycles forward through matches; Shift+Enter cycles backward. |
| **⌘P** | Opens the print dialog with the document rendered as a printable page. |
| **⌘/** | Opens the help search palette. Type any topic title or keyword to jump to a topic. |
