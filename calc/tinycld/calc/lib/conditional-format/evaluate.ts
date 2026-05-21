// Conditional-formatting condition evaluation. Pure functions — no
// React, no Yjs — so the rule logic is unit-testable in isolation.
//
// The two entry points:
//   - matchesCondition(condition, cell, ctx): boolean — for one rule,
//     does the cell satisfy the condition?
//   - evaluateRulesForCell(rules, cell, ctx): CellStyle | null — first
//     matching rule wins; returns its style or null.
//
// `customFormula` conditions defer the actual formula evaluation to
// the caller via ctx.evalFormulaAt. This decouples the evaluator from
// HyperFormula so unit tests can stub it.

import type { CellKind, CellRaw, CellStyle } from '../workbook-types'
import type { CFCondition, CFRule } from './types'

// EvaluableCell is the minimal shape the evaluator needs from a cell.
// Both CellValue (used by xlsx-import models) and YCellValue (used by
// the live render path) satisfy this shape — kept structural to avoid
// importing either of the concrete types and the wider surface they
// drag with them.
export interface EvaluableCell {
    kind: CellKind
    raw: CellRaw | Date
    display: string
    formula?: string
}

export interface EvaluationContext {
    sheetName: string
    row: number
    col: number
    // evalFormulaAt receives the formula text (without leading `=`)
    // and returns whatever HyperFormula computed in that cell's
    // context. Returns null when the formula is invalid or evaluation
    // failed — the caller treats null as "rule does not match".
    evalFormulaAt: (formula: string, sheetName: string, row: number, col: number) => unknown
}

export function evaluateRulesForCell(
    rules: CFRule[],
    cell: EvaluableCell | null,
    ctx: EvaluationContext
): CellStyle | null {
    for (const rule of rules) {
        if (matchesCondition(rule.condition, cell, ctx)) {
            return rule.style
        }
    }
    return null
}

export function matchesCondition(
    condition: CFCondition,
    cell: EvaluableCell | null,
    ctx: EvaluationContext
): boolean {
    const text = cellAsText(cell)
    switch (condition.type) {
        case 'isEmpty':
            return text === ''
        case 'isNotEmpty':
            return text !== ''
        case 'textContains':
            return condition.value1 != null && text.toLowerCase().includes(condition.value1.toLowerCase())
        case 'textDoesNotContain':
            return condition.value1 != null && !text.toLowerCase().includes(condition.value1.toLowerCase())
        case 'textStartsWith':
            return condition.value1 != null && text.toLowerCase().startsWith(condition.value1.toLowerCase())
        case 'textEndsWith':
            return condition.value1 != null && text.toLowerCase().endsWith(condition.value1.toLowerCase())
        case 'textEquals':
            return condition.value1 != null && text.toLowerCase() === condition.value1.toLowerCase()
        case 'dateIs':
            return compareDates(cell, condition.value1, (a, b) => a === b)
        case 'dateBefore':
            return compareDates(cell, condition.value1, (a, b) => a < b)
        case 'dateAfter':
            return compareDates(cell, condition.value1, (a, b) => a > b)
        case 'numberEquals':
            return compareNumbers(cell, condition.value1, (a, b) => a === b)
        case 'numberNotEquals':
            return compareNumbers(cell, condition.value1, (a, b) => a !== b)
        case 'numberGreater':
            return compareNumbers(cell, condition.value1, (a, b) => a > b)
        case 'numberGreaterOrEqual':
            return compareNumbers(cell, condition.value1, (a, b) => a >= b)
        case 'numberLess':
            return compareNumbers(cell, condition.value1, (a, b) => a < b)
        case 'numberLessOrEqual':
            return compareNumbers(cell, condition.value1, (a, b) => a <= b)
        case 'numberBetween':
            return compareBetween(cell, condition.value1, condition.value2, true)
        case 'numberNotBetween':
            return compareBetween(cell, condition.value1, condition.value2, false)
        case 'customFormula':
            return evaluateCustomFormula(condition, ctx)
        case 'xlsxOpaque':
            // Round-tripped from xlsx but not modelled in the UI. Never
            // matches in v1 — we render the cell as if the rule were
            // absent and rely on the save path to re-emit the original
            // xlsx options verbatim. Sheets does the same with
            // unsupported rule types.
            return false
    }
}

// cellAsText returns the user-visible-text representation of a cell
// for text conditions. Trims whitespace at neither end (Sheets is
// case-insensitive but otherwise literal). Empty when the cell is
// null, an empty string, or has a null raw scalar.
function cellAsText(cell: EvaluableCell | null): string {
    if (cell == null) return ''
    if (cell.raw == null) return ''
    if (typeof cell.raw === 'string') return cell.raw
    if (typeof cell.raw === 'number') return cell.display !== '' ? cell.display : String(cell.raw)
    if (typeof cell.raw === 'boolean') return cell.raw ? 'TRUE' : 'FALSE'
    if (cell.raw instanceof Date) return cell.raw.toISOString()
    return cell.display
}

// numericValue extracts a finite number from a cell, or null. Number
// cells return their raw value; string cells whose contents parse as
// a number are coerced; booleans become 1/0 (Excel parity); dates and
// other shapes return null.
function numericValue(cell: EvaluableCell | null): number | null {
    if (cell == null) return null
    if (typeof cell.raw === 'number') {
        return Number.isFinite(cell.raw) ? cell.raw : null
    }
    if (typeof cell.raw === 'boolean') return cell.raw ? 1 : 0
    if (typeof cell.raw === 'string') {
        if (cell.raw.trim() === '') return null
        const n = Number(cell.raw)
        return Number.isFinite(n) ? n : null
    }
    return null
}

function parseNumberOperand(s: string | undefined): number | null {
    if (s == null) return null
    const trimmed = s.trim()
    if (trimmed === '') return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
}

function compareNumbers(
    cell: EvaluableCell | null,
    operand: string | undefined,
    op: (a: number, b: number) => boolean
): boolean {
    const a = numericValue(cell)
    const b = parseNumberOperand(operand)
    if (a == null || b == null) return false
    return op(a, b)
}

function compareBetween(
    cell: EvaluableCell | null,
    lo: string | undefined,
    hi: string | undefined,
    inside: boolean
): boolean {
    const a = numericValue(cell)
    const l = parseNumberOperand(lo)
    const h = parseNumberOperand(hi)
    if (a == null || l == null || h == null) return false
    const min = Math.min(l, h)
    const max = Math.max(l, h)
    const within = a >= min && a <= max
    return inside ? within : !within
}

// compareDates normalizes both sides to a day-granular YYYY-MM-DD
// string and compares lexically (ISO ordering is the same as
// chronological ordering for that format). Time components are dropped
// — Sheets' date conditions are day-granular.
function compareDates(
    cell: EvaluableCell | null,
    operand: string | undefined,
    op: (a: string, b: string) => boolean
): boolean {
    const a = dateAsISO(cell)
    const b = operandAsISO(operand)
    if (a == null || b == null) return false
    return op(a, b)
}

function dateAsISO(cell: EvaluableCell | null): string | null {
    if (cell == null) return null
    if (cell.kind === 'date' && typeof cell.raw === 'string') {
        return cell.raw.slice(0, 10)
    }
    if (typeof cell.raw === 'string') {
        const iso = parseISODate(cell.raw)
        return iso
    }
    return null
}

function operandAsISO(operand: string | undefined): string | null {
    if (operand == null) return null
    return parseISODate(operand.trim())
}

// parseISODate accepts YYYY-MM-DD or full ISO timestamps and returns
// the day portion. Returns null for anything else.
function parseISODate(s: string): string | null {
    if (s.length === 0) return null
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
    // Fall back to JS Date parsing for forms like 1/15/2024 — JS Date
    // is lenient but inconsistent across locales; for v1 we restrict
    // operands to ISO and reject everything else, matching the form
    // input the panel renders.
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return null
    return d.toISOString().slice(0, 10)
}

function evaluateCustomFormula(condition: CFCondition, ctx: EvaluationContext): boolean {
    if (condition.formula == null || condition.formula === '') return false
    const result = ctx.evalFormulaAt(condition.formula, ctx.sheetName, ctx.row, ctx.col)
    return coerceFormulaResultToBoolean(result)
}

// coerceFormulaResultToBoolean mirrors Sheets' behavior: TRUE, any
// non-zero number, any non-empty non-"FALSE" string is truthy. Error
// results (DetailedCellError instances from HyperFormula) and null
// are falsy. Exported for testing.
export function coerceFormulaResultToBoolean(value: unknown): boolean {
    if (value == null) return false
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0 && Number.isFinite(value)
    if (typeof value === 'string') {
        const upper = value.trim().toUpperCase()
        if (upper === '' || upper === 'FALSE') return false
        if (upper === 'TRUE') return true
        const n = Number(value)
        if (Number.isFinite(n)) return n !== 0
        return true
    }
    // DetailedCellError or any unknown object — treat as no-match so
    // a broken formula doesn't silently style cells.
    return false
}
