---
title: Formatting code
summary: Mark inline code spans and full code blocks for verbatim text
tags: [code, monospace, formatting]
order: 50
---

## To format inline code

Use this for short snippets that sit inline with regular prose — variable names, file paths, short commands.

1. Select the text you want to mark.
2. Either:
   - Click the **inline code** button in the toolbar (the `<>` icon),
   - Open **Format → Text → Inline code**,
   - Or press **⌘`** (Cmd/Ctrl + backtick).

The text renders in a monospace font with a muted background.

## To create a code block

Use this for multi-line examples — code listings, command output, configuration files.

There are three ways to start one:

- **Toolbar / menu** — place the caret on an empty line, then click the **code block** button or pick **Format → Text → Code block**.
- **Keyboard shortcut** — **⌘⇧`** (Cmd/Ctrl + Shift + backtick).
- **Markdown shortcut** — type three backticks `` ``` `` at the start of a line and press **Enter**. The line becomes a code block.

A code block is a single paragraph rendered as a monospace box. Press **Enter** at the end to leave the block and return to normal paragraphs.

## What's preserved on save

Inline code writes the OOXML `VerbatimChar` character style; code blocks write a `CodeBlock` paragraph style. Imports also recognize Word's `Code`, `HTMLPreformatted`, and `Preformatted` style names so docs authored elsewhere with those styles open as code blocks.

Syntax highlighting and language selection are not yet supported.
