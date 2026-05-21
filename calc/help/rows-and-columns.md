---
title: Rows and columns
summary: Inserting, deleting, resizing, and hiding rows and columns
tags: [rows, columns, resize, insert, delete]
order: 50
---

## Inserting rows and columns

Right-click a row number or column letter (long-press on iPad) and choose:

- **Insert 1 above** / **Insert 1 below** — for rows.
- **Insert 1 left** / **Insert 1 right** — for columns.

Select multiple rows or columns first to insert that many at once.

When you insert, formulas elsewhere in the workbook that reference cells *below* or *to the right* of the insertion point are rewritten automatically so they still point at the right data.

## Deleting rows and columns

Right-click a row number or column letter and choose **Delete row** / **Delete column**. References to deleted cells become `#REF!` errors.

## Resizing

- **Drag the border** between two row numbers or column letters to resize.
- **Double-click the border** to auto-fit to the widest content in that row/column.
- **Right-click → Resize** to type an exact pixel size.

Resizes are remembered per-sheet and synced across collaborators.

## Hiding rows and columns

Right-click a row or column and choose **Hide**. The row/column collapses to zero width but still participates in formulas. To unhide, select the rows/columns on either side of the hidden one and choose **Unhide** from the context menu.

## Fill handle for series

When you drag the small square at the bottom-right of a selection, Calc detects patterns in the source cells and fills the target range:

- **Numbers** — `1, 2, 3` extends to `4, 5, 6`. `2, 4, 6` extends to `8, 10, 12`.
- **Dates** — `2026-01-01, 2026-02-01` extends by month.
- **Weekdays / months** — `Mon, Tue` extends to `Wed, Thu, …`.
- **Mixed text + number** — `Item 1, Item 2` extends to `Item 3, Item 4`.

If no pattern is found, values repeat. See [editing](help://calc:editing) for the fill handle in context.

## See also

- [Editing cells](help://calc:editing)
- [Formulas](help://calc:formulas)
