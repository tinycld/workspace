---
title: Copy, cut, and paste
summary: Moving and duplicating cells, including paste-special variants
tags: [clipboard, copy, paste, cut]
order: 70
---

## Basic copy / cut / paste

- **Copy** — ⌘C (or Edit → Copy).
- **Cut** — ⌘X (or Edit → Cut).
- **Paste** — ⌘V (or Edit → Paste).

Copy includes both the values and the formatting. Cut moves the cells — the source range is cleared once you paste.

After a cut, the source range gets a **marching-ants** dashed border that animates until you paste or press **Esc** to cancel.

## Paste special

When you only want part of what's on the clipboard, use **Edit → Paste special**:

- **Values only** (⌘⇧V) — paste just the computed values; formulas and formatting are dropped.
- **Formulas only** (⌘⌥V) — paste the formula text; formatting is dropped.
- **Format only** (⌘⌥⇧V) — paste fonts, fills, borders, and number formats; cell values are untouched.
- **Transposed** (⌘⌥T) — swap rows and columns. A 3-row × 2-column range becomes 2-row × 3-column.

## Pasting from outside Calc

Calc accepts TSV (tab-separated) and HTML clipboard content from other apps — spreadsheets, web tables, plain text files. Each tab becomes a column break and each newline becomes a row break.

## Pasting CSV

Pasting a CSV-shaped block opens a small import dialog so you can pick the delimiter (comma, tab, semicolon, pipe) before the data lands in the grid.

## See also

- [CSV import and export](help://calc:csv-import-export)
- [Editing cells](help://calc:editing)
- [Keyboard shortcuts](help://calc:keyboard-shortcuts)
