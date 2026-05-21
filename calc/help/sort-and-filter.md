---
title: Sort and filter
summary: Reordering rows and showing only the ones that match a condition
tags: [sort, filter, data]
order: 90
---

## Sorting a range

Select the range you want to sort, then choose **Data → Sort range**. A dialog appears:

- Choose which column to sort by.
- Pick **A → Z** (ascending) or **Z → A** (descending).
- Toggle **Data has header row** so the header isn't sorted into the body.

You can add multiple sort keys — the secondary key breaks ties from the primary, and so on.

Sorting moves the rows themselves; formulas that reference moved cells follow them.

## Creating a filter

Select the range (including the header row), then choose **Data → Create a filter**. A small filter button appears in each column header. Click it to open the filter menu:

- **By value** — uncheck the values you want to hide.
- **By condition** — text contains, number greater than, date is before, etc.

Rows that don't match are hidden. Their data still exists and still participates in formulas — they're just not visible.

## Removing a filter

Choose **Data → Remove filter** to clear all active filter rules and show every row again.

## See also

- [Conditional formatting](help://calc:conditional-formatting) — coloring rows by value instead of hiding them
- [Pivot tables](help://calc:pivot-tables) — summarizing rather than filtering
