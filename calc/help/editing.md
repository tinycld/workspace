---
title: Editing cells
summary: Entering values, navigating the grid, and undoing mistakes
tags: [edit, cells, selection, undo]
order: 20
---

## To enter a value

Click a cell and start typing. Press **Enter** to commit and move down, **Tab** to commit and move right, or **Esc** to discard.

To replace what's already there, just start typing — the existing content is overwritten. To edit in place without overwriting, double-click the cell (or press **F2** on web).

Calc figures out the cell's type from what you type:

- Numbers, percentages, and currency are stored as numbers.
- Anything starting with `=` is a formula.
- Recognizable dates (e.g. `2026-05-16`, `5/16/2026`) are stored as dates.
- Anything else is text.

## To select cells

- **One cell** — click it.
- **A range** — click and drag, or click the first cell and shift-click the last.
- **A whole row or column** — click the row number or column letter.
- **Everything** — click the corner cell (top-left, above row 1).
- **Disjoint cells** (web only) — hold ⌘ (Mac) or Ctrl (Windows) and click additional cells or ranges.
- **Extend with the keyboard** — hold Shift and use the arrow keys.

On iPad, drag the small **corner handles** at the edges of a selection to extend it — there's no shift key.

## Filling a series with the fill handle

Select one or more cells, then drag the small square at the bottom-right corner of the selection. Calc detects the pattern (sequential numbers, dates, weekdays, common lists) and fills the range. If no pattern is detected, the values repeat.

Hold **Shift** mid-drag (web only) to toggle between *copy* and *series* modes live.

## Undo and redo

- **Undo** — ⌘Z (web) or Edit → Undo.
- **Redo** — ⌘⇧Z or Edit → Redo.

Undo is per-user and works back through your own edits even when others are editing the same workbook concurrently.

## See also

- [Clipboard and paste-special](help://calc:clipboard)
- [Formulas and functions](help://calc:formulas)
- [Rows and columns](help://calc:rows-and-columns)
