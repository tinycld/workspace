// CellStyle mirrors the OOXML / SpreadsheetML cell-style shape that
// excelize uses natively on the server side, so attributes copy
// through with minimal translation when the server reads the source
// .xlsx into a WorkbookModel and again when SaveRoom writes the doc
// back out.
//
// Every field is optional, and every nested group is optional. Absence
// is significant: a missing field means "this attribute is not tracked
// by the doc", which the serializer interprets as "leave whatever the
// source .xlsx already has on that attribute alone". This is what
// allows the doc to carry (e.g.) only bold without overwriting an
// existing fill color the source workbook had.
//
// Today only `font.bold` is wired all the way through. New attributes
// land additively: add a field here, mirror it in CellStyle (Go),
// teach the server reader to extract it, and teach the serializer's
// per-group merger to apply it. Nothing in between needs to know.
export interface CellFont {
    bold?: boolean
    italic?: boolean
    underline?: boolean
    strike?: boolean
    size?: number
    name?: string
    color?: string
}

export interface CellFill {
    type?: 'pattern'
    pattern?: string
    fgColor?: string
    bgColor?: string
}

export interface CellAlignment {
    horizontal?: 'left' | 'center' | 'right'
    vertical?: 'top' | 'middle' | 'bottom'
    wrapText?: boolean
}

// CellBorderLineStyle enumerates the line-style codes the toolbar's
// border line picker offers. The value is what survives end-to-end:
// stored in the YDoc, lands in the snapshot pipeline, and translates
// to an excelize border style code on save.
export type CellBorderLineStyle = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double'

// CellBorderEdge describes one edge's appearance: line style + color.
// Both fields are optional. Absence means "use the renderer's default"
// (1px solid #000000) — but the toolbar always writes both together,
// so partial objects only appear in legacy data.
export interface CellBorderEdge {
    style?: CellBorderLineStyle
    color?: string
}

// CellBorders stores per-edge appearance. Each edge is one of:
//   - undefined: this edge is not tracked by the doc; the serializer
//     leaves the on-disk xlsx alone, and the renderer falls back to
//     the cell's natural look.
//   - false: explicit clear; the serializer deletes any existing edge
//     on disk, and the renderer paints no border on this side.
//   - CellBorderEdge object: paint this edge with the given style +
//     color; missing fields default to thin / #000000.
//
// Merge contract: setYCellStyle replaces each edge wholesale rather
// than deep-merging into it. The toolbar always sends a complete
// {style, color} pair on every write, so a deep merge would be
// pointless complexity. Code that constructs a CellBorders patch
// must include both fields on every CellBorderEdge it sets.
export interface CellBorders {
    top?: CellBorderEdge | false
    right?: CellBorderEdge | false
    bottom?: CellBorderEdge | false
    left?: CellBorderEdge | false
}

export interface CellStyle {
    font?: CellFont
    fill?: CellFill
    alignment?: CellAlignment
    borders?: CellBorders
    numFmt?: string
}

// CellKind tags the semantic type of a cell's value, separate from
// `typeof raw`, so an ISO date string ("2024-01-15") is distinguishable
// from a literal text "2024-01-15" the user prepended `'` to. The Go
// serializer dispatches on `kind` to pick excelize's number / boolean /
// date / formula write path. See ~/Documents/plans/2026-05-08-calc-cell-types.md.
export type CellKind = 'string' | 'number' | 'boolean' | 'date' | 'formula'

// CellRaw is the in-doc representation of a cell's value, constrained
// to types Yjs serializes natively. Dates are stored as ISO strings
// (Yjs doesn't serialize JS Date), formulas store `null` (or a cached
// scalar from xlsx import) since the formula text lives separately.
export type CellRaw = string | number | boolean | null

export interface CellValue {
    kind: CellKind
    raw: CellRaw | Date
    display: string
    formula?: string
    style?: CellStyle
}

// formatCell computes the user-visible text for a cell from its kind,
// raw value, optional formula text, and optional numFmt. Used by both
// the xlsx-import path (to populate the `display` cache written to the
// doc) and the live render path. The cache call sites pass no numFmt
// — the cache is the kind-only baseline so old peers and serializers
// still render correctly. The live render path passes
// cell.style?.numFmt so any applied format takes effect immediately.
//
// The implementation lives in lib/number-format/format.ts; this
// wrapper preserves the (kind, raw, formula?) signature existing
// callers were built against.
import { applyNumFmt } from './number-format/format'

export function formatCell(
    kind: CellKind,
    raw: CellRaw | Date,
    formula?: string,
    numFmt?: string
): string {
    return applyNumFmt(kind, raw, numFmt, formula)
}

export interface WorksheetModel {
    name: string
    rowCount: number
    colCount: number
    cells: Record<string, CellValue>
    // Optional tab color (e.g. "#FF0000"). Imported from the source
    // xlsx; absent when the source has no tab color set.
    color?: string
    // Optional hidden flag. When true, useYSheets filters this sheet
    // out of the public list while the sheet-management UI still sees
    // it via useAllYSheets.
    hidden?: boolean
    // Optional list of merged cell rectangles. Imported from xlsx via
    // excelize's GetMergeCells; persisted back via MergeCell. Absent on
    // sheets without merges.
    merges?: MergeRangeModel[]
    // Optional freeze counts read from the xlsx <pane> on import.
    // Bootstrap copies these straight onto the sheet's Y.Map so the
    // grid renders the freeze on first open. Absent / 0 = no freeze.
    frozenRows?: number
    frozenCols?: number
    // Optional list of conditional-formatting rules imported from the
    // xlsx. Bootstrap seeds these into the sheet's
    // conditionalFormats Y.Array; round-trips back through the
    // snapshot pipeline. The shape lives in
    // lib/conditional-format/types.ts; declared as a structural type
    // here to avoid a require-cycle through workbook-types.
    conditionalFormats?: ConditionalFormatRuleModel[]
}

// ConditionalFormatRuleModel is the import-time shape of one CF rule.
// Kept structurally separate from the doc-side CFRule (which uses the
// same shape) so workbook-types stays free of doc/Yjs dependencies.
export interface ConditionalFormatRuleModel {
    id: string
    ranges: string[]
    condition: ConditionalFormatConditionModel
    style: CellStyle
}

export interface ConditionalFormatConditionModel {
    type: string
    value1?: string
    value2?: string
    formula?: string
    opaqueXlsx?: Record<string, unknown>
}

export interface MergeRangeModel {
    anchorRow: number
    anchorCol: number
    rowSpan: number
    colSpan: number
}

export interface WorkbookModel {
    sheets: WorksheetModel[]
    pivots?: PivotDefinition[]
}

export function cellKey(row: number, col: number): string {
    return `${row}:${col}`
}

export function columnLabel(col: number): string {
    let n = col
    let label = ''
    while (n > 0) {
        const rem = (n - 1) % 26
        label = String.fromCharCode(65 + rem) + label
        n = Math.floor((n - 1) / 26)
    }
    return label || 'A'
}

export type PivotAggregation =
    | 'sum'
    | 'average'
    | 'count'
    | 'countNums'
    | 'max'
    | 'min'
    | 'product'
    | 'stdDev'
    | 'stdDevp'
    | 'var'
    | 'varp'

export interface PivotField {
    sourceColumn: string
    displayName?: string
}

export interface PivotValueField extends PivotField {
    aggregation: PivotAggregation
    numFmt?: string
}

export interface PivotDefinition {
    id: string
    sourceRange: string
    targetSheetName: string
    rows: PivotField[]
    cols: PivotField[]
    values: PivotValueField[]
    filters: PivotField[]
    filterSelections: Record<string, string[]>
    rowGrandTotals: boolean
    colGrandTotals: boolean
    rowSubtotals: boolean
    colSubtotals: boolean
    styleName?: string
}
