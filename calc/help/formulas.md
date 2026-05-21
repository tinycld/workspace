---
title: Formulas and functions
summary: Writing formulas and finding the function you need
tags: [formula, functions, formula-bar]
order: 30
---

## Writing a formula

Start a cell with `=`. Everything after is treated as a formula:

```
=SUM(A1:A10)
=IF(B2 > 100, "big", "small")
=VLOOKUP(D2, Sheet2!A:C, 3, FALSE)
```

Press **Enter** to commit. The cell displays the computed value; the formula bar shows the source.

While typing a formula, Calc autocompletes function names as you type. Use **↑ / ↓** to move through suggestions and **Tab** to accept.

## Referencing cells

- `A1` — a single cell on the current sheet.
- `A1:B10` — a rectangular range.
- `Sheet2!A1` — a cell on another sheet (use single quotes around the sheet name if it contains spaces: `'Q1 Sales'!A1`).
- `$A$1`, `$A1`, `A$1` — absolute / mixed references. The `$` pins the column or row when the formula is filled or copied.

## The formula bar

The strip above the grid shows the active cell. It always displays the underlying *formula*, while the cell shows the computed *result*. Edit either by clicking — they're synchronized.

## Finding a function

Open **Help → Function list** to see the full [function reference](help://calc:functions) — every built-in function grouped by category, with a one-line description and syntax for each. Use **⌘F** within the page to jump to a specific name, or open the global help search with **⌘/** and type the function name. Calc supports the standard set you'd expect from a spreadsheet — math, statistics, lookup, text, date, logical, financial.

## What happens when rows or columns move

When you [insert or delete rows/columns](help://calc:rows-and-columns) or move cells, formulas elsewhere in the workbook are rewritten automatically so references still point at the right cells. References to deleted cells become `#REF!` errors.

## Errors

Common errors and what they mean:

- `#REF!` — the formula references a cell that no longer exists (deleted row/column).
- `#NAME?` — an unknown function name or label.
- `#DIV/0!` — division by zero.
- `#VALUE!` — wrong type of argument (e.g. text where a number was expected).
- `#N/A` — a lookup didn't find a match.

## See also

- [Editing cells](help://calc:editing)
- [Keyboard shortcuts](help://calc:keyboard-shortcuts)
