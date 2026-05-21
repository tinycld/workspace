import { cellInRange, parseSheetRange, type ParsedCellRange } from './a1'
import type { CFRule } from './types'

// RuleRangeIndex pre-parses each rule's A1 ranges once so the cell
// render hot path can answer "does this rule apply to (row, col)?"
// without re-parsing strings on every render. Built per (sheet, rules-
// array) pair and memoized in the hook layer.
//
// v1 is a linear scan — typical workbooks carry <50 rules, the visible
// viewport is ~25 cells, and a spatial index is unnecessary at that
// scale. If/when rules-per-sheet climbs into the hundreds we can
// replace with an R-tree without touching the call sites.
export interface IndexedRule {
    rule: CFRule
    ranges: ParsedCellRange[]
}

export function buildRuleRangeIndex(rules: CFRule[]): IndexedRule[] {
    const out: IndexedRule[] = []
    for (const rule of rules) {
        const ranges: ParsedCellRange[] = []
        for (const r of rule.ranges) {
            const parsed = parseSheetRange(r)
            if (parsed != null) ranges.push(parsed)
        }
        if (ranges.length === 0) continue
        out.push({ rule, ranges })
    }
    return out
}

// filterRulesForCell returns the rules whose ranges contain the given
// cell, preserving the input order (which encodes rule priority — the
// first match wins, per Sheets).
export function filterRulesForCell(
    index: IndexedRule[],
    row: number,
    col: number
): CFRule[] {
    const out: CFRule[] = []
    for (const entry of index) {
        for (const range of entry.ranges) {
            if (cellInRange(range, row, col)) {
                out.push(entry.rule)
                break
            }
        }
    }
    return out
}

// anyRuleOverlapsRect returns true when at least one of the given
// rules has a range that overlaps the given rectangle. Used by the
// context menus to flip their label between "Conditional formatting…"
// (no rules on the selection) and "Edit conditional formatting…"
// (existing rules cover at least part of the selection).
export function anyRuleOverlapsRect(
    rules: CFRule[],
    rect: { startRow: number; startCol: number; endRow: number; endCol: number }
): boolean {
    const index = buildRuleRangeIndex(rules)
    for (const entry of index) {
        for (const r of entry.ranges) {
            const overlapsRows = r.startRow <= rect.endRow && r.endRow >= rect.startRow
            const overlapsCols = r.startCol <= rect.endCol && r.endCol >= rect.startCol
            if (overlapsRows && overlapsCols) return true
        }
    }
    return false
}
