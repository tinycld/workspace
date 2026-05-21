---
title: Printing a workbook
summary: Sending the active sheet to a printer or PDF
tags: [print, pdf, export]
order: 150
---

## To print

Choose **File → Print**. Calc paginates the active sheet for the page size your system reports and opens:

- On **web** — the browser's print dialog. From there you can pick a printer, save as PDF, or change orientation and paper size.
- On **iPad** — the iOS print sheet. Pick an AirPrint printer, or share the rendered output to Files, Mail, or any other share-sheet target.

## What gets printed

Only the **active sheet** prints. To print another sheet, switch to it first, then choose Print.

The print render preserves:

- All cell values, including formula results.
- Number formatting.
- Fonts, fills, borders, and alignment.
- Merged cells.
- Conditional formatting.

Row and column headers (A, B, C / 1, 2, 3) are *not* printed.

## Page breaks

Calc auto-paginates — it splits the sheet into pages that fit the paper size. Wide sheets break across multiple horizontal pages; long sheets break vertically. You can't currently set manual page breaks or scale the output.

## Pivot tables

Pivot table output cells print like any other cells — what's on screen is what prints.

## See also

- [Formatting cells](help://calc:formatting)
- [CSV import and export](help://calc:csv-import-export) — for sharing data instead of a printed view
