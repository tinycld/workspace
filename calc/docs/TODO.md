# Calc MVP Gap Assessment

Comparison of the current `@tinycld/calc` implementation against leading online
spreadsheets (Google Sheets, Excel Online) to identify what's missing for a
minimum viable product.

## What's already solid

The collaborative core is in good shape:

- Yjs-backed real-time sync with presence cursors
- Threaded comments persisted in PocketBase
- Undo/redo wired to the right Y.Maps
- HyperFormula with ~390 functions including cross-sheet refs
- 13 number-format presets
- Full font / border / alignment / wrap styling
- Insert / delete rows + columns
- Multi-range selection
- Fill handle (drag-to-fill): linear-number/date/formula, suffix-int strings, month/weekday name series
- `.xlsx` as the on-disk format

## MUST-HAVE gaps (block basic usability)

These block the basic "open a spreadsheet and get work done" flow. Listed in
recommended implementation order.

1. ~~**Formula reference rewriting on insert/delete**~~ — **done.** Each
   `insertRows` / `insertColumns` / `deleteRows` / `deleteColumns` now rewrites
   formula refs (across all sheets, including cross-sheet refs into the mutated
   sheet) atomically with the cell shift inside the same `doc.transact`. See
   `lib/formula/rewrite-on-structural-mutation.ts`.

2. **Copy / Cut / Paste** — `hooks/grid-store.ts` has no clipboard handlers at
   all. The #1 usability blocker. Users can't move data around, can't paste from
   email / web / another sheet, can't duplicate rows. Needs Cmd-C/X/V,
   paste-from-system-clipboard (TSV from Excel/Sheets, plain text, internal rich
   format with styles + formulas + ref-shifting).

3. ~~**Fill handle / autofill**~~ — **done.** Drag the green dot at the
   bottom-right of the selection to fill a series across the destination
   cells. Supports linear numeric / date series, suffix-int strings,
   month and weekday name series, formula refs (rewritten per
   destination via the same shift mechanic the clipboard paste uses),
   and `copy` as the fallback when no series is detected. Shift-drag
   on web is the escape hatch for the legacy "extend selection without
   filling" gesture; the long-press cell context menu is the touch-side
   fallback. See `lib/fill/detect-series.ts` and `lib/fill/apply-fill.ts`.

4. **Find & replace** — For this we need to investigate how keyboard shortcuts
   work and hook into the standard ctrl-f and control-r. We also need to add a
   toolbar magnifying glass icon for find.

5. **Sort & filter** — neither exists. A sheet of more than ~30 rows is useless
   without at minimum: sort range by column asc/desc, and a filter view (header
   dropdowns hiding rows by value).

6. **Freeze rows/columns** — absent. Any sheet wider than a screen needs a
   frozen header row to be navigable.

7. **Sheet management UI** — `components/SheetTabs.tsx` only renders selection;
   add / rename / delete / duplicate / reorder aren't wired up. New workbooks
   are stuck with whatever sheets the xlsx import produced.

8. **Merge cells** — absent. Even basic title rows in templates assume this
   exists.

9. **Keyboard shortcuts for formatting** — Cmd-B / Cmd-I / Cmd-U for bold /
   italic / underline. Trivial to add, glaring when missing.

10. **CSV export (and ideally import)** — the only format is xlsx round-trip.
    Users routinely need CSV for downstream tools; one-evening add.

## Strong second tier (expected, not strictly MVP)

Not ship-blockers, but the difference between "MVP" and "competitive":

- ~~Conditional formatting~~ — **done.** Per-sheet rules with 18 condition
  types (Sheets parity) plus custom formulas, authored in a right-side
  drawer. Font + fill styles overlay on top of any explicit cell style;
  first matching rule wins. Round-trips through excelize on save/import;
  rule kinds the authoring UI doesn't yet model (top-N, duplicates,
  color scales, data bars, icon sets, time-period relative dates)
  round-trip as opaque so an imported Excel/Sheets workbook isn't
  corrupted on save. See `lib/conditional-format/` and
  `server/conditional_format.go`.
- Data validation (dropdowns especially)
- Named ranges
- Print / PDF export
- Image embedding

## Third tier

- Charts
- Pivot tables
- Protected ranges
- Drawing / shapes

## Recommendation

The first six items in the MUST-HAVE list get to "I can actually use this for a
real task." The rest get to "I'm not embarrassed to demo this next to Sheets."

Items 1 (formula rewrite on structural mutation) and 3 (fill handle /
autofill) have shipped. Items 2 and 4–6 are the remaining MUST-HAVE work to
reach "I can actually use this for a real task."
