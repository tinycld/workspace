---
title: Find and replace
summary: Searching for and substituting text across the workbook
tags: [find, replace, search]
order: 80
---

## Opening the find bar

Press **⌘F** or choose **Edit → Find and replace**. A bar appears at the top of the grid.

Type to search. Matching cells highlight as you type. The bar shows the count of matches and which one is currently active.

## Navigating between matches

- **Enter** or **▼** — next match.
- **Shift+Enter** or **▲** — previous match.
- **Esc** — close the find bar.

Matches are visited in row-then-column order across all sheets in the workbook.

## Replacing

Click the **Replace** toggle to reveal a second input. Type the replacement text, then:

- **Replace** — substitute the current match and advance.
- **Replace all** — substitute every match in the workbook.

## Match options

The find bar exposes:

- **Match case** — distinguishes `abc` from `ABC`.
- **Whole cell** — only match cells whose entire content equals the search term.
- **Search in formulas** — match against the formula text rather than the displayed value.

Without **Search in formulas**, find looks at what's *visible* in each cell — the displayed result of a formula, with formatting applied.

## See also

- [Editing cells](help://calc:editing)
- [Keyboard shortcuts](help://calc:keyboard-shortcuts)
