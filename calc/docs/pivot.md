# Pivot tables

Calc supports a "Standard" feature subset of pivot tables: rows, columns,
values (with sum / average / count / countNums / max / min / product /
stdDev / stdDevp / var / varp), filters with discrete selections, per-value
number format, grand totals, and row/column subtotals.

## Live recompute model

Pivot definitions live in the Y.Doc under `doc.getMap('pivots')`. Each
pivot owns a **dedicated sheet** identified by a `pivotId` meta key.
The grid renders that sheet from the engine output rather than from
its `cells` Y.Map. Every peer recomputes locally from the source range
+ definition; nothing is mirrored across the wire.

## xlsx round-trip

On `.xlsx` open:

- Each `<pivotTable>` from any sheet is read via `excelize.GetPivotTables`
  and converted into a `PivotDefinitionDTO`.
- If the xlsx pivot was anchored on a sheet that **also contains source
  data**, calc promotes the pivot to a new dedicated sheet named
  `<anchor> pivot` (suffix-incremented for uniqueness). The original
  anchor sheet keeps its source cells unchanged.
- The xlsx's **cached rendered cells** are dropped — the engine recomputes
  from the source range on first render.

On save:

- The pivot's target sheet is written **empty**. Excel re-renders the
  grid from the definition + source data on open.
- The pivot's source data and definition are the only authoritative state
  in the resulting `.xlsx`.

## Known divergences from Excel

| Area | Excel | Calc |
|---|---|---|
| Label sort order | Excel uses locale-aware compare. | Calc uses JS string compare (`<` / `>`). |
| `(blank)` label | Excel renders the literal string `(blank)`. | Calc renders an empty cell. |
| Multi-value column header text | Excel uses `"Values"` as a row header. | Calc renders the per-value labels directly without a "Values" header row. |
| In-sheet anchored pivots | Excel allows pivots anywhere on any sheet. | Calc v1 only supports **dedicated** pivot sheets. |
| Per-value `numFmt` round-trip | Pivot value fields carry a built-in numFmt ID (excelize: `PivotTableField.NumFmt int`). | Calc stores a free-form numFmt **string** (e.g. `'#,##0.00'`) used by the live engine; this field is **not written to xlsx** and is **not read back from xlsx**. Custom formats survive within calc (and across `.xlsx` save/load via the Y.Doc state once realtime is wired) but do **not** propagate to Excel-side rendering. |
| Calculated fields | Supported. | Not in v1. |
| Date grouping (month/quarter/year) | Supported. | Not in v1. |
| Drill-down to source rows | Supported (double-click a value). | Not in v1. |
| Pivot styles | Full library. | v1 reads/writes the style name only — visual styling matches calc's default theme. |

These divergences are documented divergences, not bugs.

## Toolbar / authoring

The "Pivot table" button in the toolbar opens a small dialog (source range
+ new sheet name), creates a new dedicated sheet, and opens the side
panel at the empty-state card. Drag fields into Rows / Columns / Values /
Filters from the **Available fields** list. The rendered grid updates as
each change writes to the Y.Doc.
