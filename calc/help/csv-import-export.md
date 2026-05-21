---
title: CSV import and export
summary: Bringing CSV data in and getting sheets out as CSV
tags: [csv, import, export, download]
order: 140
---

## Importing a CSV

Two paths bring CSV data into a workbook:

- **File → Import** — pick a `.csv` file from your device. Calc reads it and offers a choice between *replacing the current sheet* or *adding a new sheet* with the data. A preview shows you the parsed result and lets you correct the delimiter (comma, tab, semicolon, pipe) before committing.
- **Paste CSV** — copy CSV text from anywhere and paste it into a cell. Calc detects the CSV shape and opens the same preview dialog.

The import respects quoted fields, escaped quotes (`""`), and standard CSV line endings.

## Exporting as CSV

From **File → Download as CSV** choose:

- **Current sheet** — downloads only the active sheet as a single `.csv`.
- **All sheets** — downloads every sheet as a zipped bundle (`workbook.zip`), one `.csv` per sheet.

On **web**, the file lands in your browser's Downloads folder. On **iPad**, the iOS share sheet opens so you can pick where to send it — Files, AirDrop, Mail, etc.

## What's preserved

CSV is a plain-text format — it preserves cell *values* only. The following are dropped:

- Formulas (the computed value is exported, not the formula text).
- Number formatting (a date formatted as `Jan 16, 2026` exports as the underlying ISO date).
- Fonts, colors, borders, fills.
- Comments.
- Multiple sheets (per file — use "All sheets" to get every sheet as separate files).

If you need a lossless export, the underlying `.xlsx` blob in Drive is always available — download it from the file's row in Drive.

## See also

- [File actions](help://calc:file-actions)
- [Clipboard and paste](help://calc:clipboard)
