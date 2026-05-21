---
title: Pivot tables
summary: Summarizing rows of data by category
tags: [pivot, summary, aggregate, data]
order: 110
---

## What a pivot table is

A pivot table takes a source range with one row per record and turns it into a summary: counts, sums, or averages broken down by one or more category columns. The source is unchanged — the pivot lives elsewhere in the workbook and recomputes when you edit the source.

## To create a pivot table

1. Select the source range (including its header row).
2. Click the **Insert pivot table** button in the toolbar. A dialog opens with the range and a target sheet pre-filled.
3. Pick a target — a new sheet, or an existing sheet at a specific cell.
4. Click **Create**. The pivot lands in the target with no fields configured yet.

## Configuring fields

The pivot editor (a side panel) has four areas — drag column names from your source headers into:

- **Rows** — values to break down by, one per row of the output.
- **Columns** — values to break down by, one per column of the output.
- **Values** — what to aggregate, plus the function (Sum, Count, Average, Min, Max, Count unique).
- **Filters** — restrict which source rows the pivot includes. Click a filter field to choose specific values to keep.

The pivot regenerates as soon as you change anything.

## Totals

The editor exposes two toggles:

- **Grand totals** — adds a row and column with overall totals.
- **Subtotals** — adds a subtotal row for each row-group break.

## When the source changes

Pivots watch their source range. Add a new row in the source, change a value, or delete a row, and the pivot recomputes. Pivots are saved into the `.xlsx` file in Excel's native pivot-table XML, so they survive a round-trip through Excel.

## Removing a pivot table

Select any cell in the pivot's output range and choose **Delete pivot table** from its context menu. The output cells are cleared and the pivot definition is removed.

## See also

- [Sort and filter](help://calc:sort-and-filter)
- [Formulas](help://calc:formulas)
