import type { CellStyle } from '../workbook-types'

// CFConditionType enumerates the conditions a single-color conditional
// formatting rule can express. Mirrors Sheets' builtin set plus a
// custom-formula escape hatch. The interpretation of value1/value2 is
// type-specific and lives in evaluate.ts.
//
// xlsxOpaque is a synthetic type used to round-trip rule kinds the
// authoring UI doesn't yet model (top-N, duplicates, average,
// time-period relative dates, color scales, data bars, icon sets).
// The original excelize options blob travels through on the rule's
// opaqueXlsx field so a save doesn't lose them.
export type CFConditionType =
    | 'isEmpty'
    | 'isNotEmpty'
    | 'textContains'
    | 'textDoesNotContain'
    | 'textStartsWith'
    | 'textEndsWith'
    | 'textEquals'
    | 'dateIs'
    | 'dateBefore'
    | 'dateAfter'
    | 'numberEquals'
    | 'numberNotEquals'
    | 'numberGreater'
    | 'numberGreaterOrEqual'
    | 'numberLess'
    | 'numberLessOrEqual'
    | 'numberBetween'
    | 'numberNotBetween'
    | 'customFormula'
    | 'xlsxOpaque'

export interface CFCondition {
    type: CFConditionType
    // value1 / value2 are stored as strings so date / number / text
    // share one wire shape. Coercion lives in evaluate.ts.
    value1?: string
    value2?: string
    // formula is populated only when type === 'customFormula'. Stored
    // without the leading `=` (same convention as cell formulas).
    formula?: string
    // opaqueXlsx carries the verbatim excelize options for rule kinds
    // the authoring UI doesn't model yet. Used only when type ===
    // 'xlsxOpaque'. The serializer round-trips this blob untouched so
    // an imported Excel/Sheets workbook survives a save unmodified.
    opaqueXlsx?: Record<string, unknown>
}

export interface CFRule {
    id: string
    // Sheet-relative A1 ranges. Examples: "A1:A100", "C:C", "B2",
    // "A1:A100,C1:C100". Comma-separated entries are NOT supported
    // here — the doc stores each range as a separate array element.
    ranges: string[]
    condition: CFCondition
    // The v1 authoring UI restricts this to font (bold/italic/under-
    // line/strike/color) + fill color. The render path honours any
    // CellStyle leaf the rule carries, so future expansion (alignment,
    // borders, numFmt) requires no wiring change here.
    style: CellStyle
}
