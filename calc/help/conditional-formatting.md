---
title: Conditional formatting
summary: Coloring cells automatically based on their values
tags: [conditional-formatting, format, rules]
order: 100
---

## What it does

Conditional formatting applies styles — fill color, text color, bold — to cells *only when their value matches a rule*. Unlike static formatting, the styling updates automatically as values change or as new data is added.

## To add a rule

1. Select the range to format.
2. Choose **Format → Conditional formatting**. A side panel opens.
3. Click **Add rule**.
4. Pick a rule type:
   - **Cell value** — equals, greater than, less than, between, contains, starts with, …
   - **Empty / not empty**.
   - **Date** — is today, is before, is after.
   - **Formula** — a custom formula that returns `TRUE` for cells to format. Use `INDIRECT` or relative references to the current cell.
5. Choose the formatting to apply — fill color, text color, bold.
6. Click **Done**.

## Multiple rules

A range can have multiple rules. They're evaluated top-down — the first matching rule wins, so put more specific rules above more general ones. Drag rules to reorder.

## Editing or removing a rule

Open **Format → Conditional formatting** while a cell in the rule's range is selected. The panel lists the rules covering that cell. Click a rule to edit it, or the trash icon to delete it.

## Persistence

Rules are saved into the `.xlsx` file. They round-trip through Excel and other spreadsheet apps that support conditional formatting.

## See also

- [Formatting cells](help://calc:formatting)
- [Sort and filter](help://calc:sort-and-filter)
