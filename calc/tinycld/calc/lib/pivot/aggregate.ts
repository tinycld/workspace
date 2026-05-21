// Group + aggregate a SourceTable into a GroupedTree.
// Pure function: no Yjs, no DOM, no time-based ordering.
//
// Keys are JSON.stringify-encoded tuples of stringified raw values, so
// row/col keys can be compared and sorted by their canonical form.

import type { CellValue, PivotAggregation, PivotDefinition } from '../workbook-types'
import type { GroupedTree, SourceTable } from './types'

export function aggregate(table: SourceTable, def: PivotDefinition): GroupedTree {
    const filtered = applyFilters(table.rows, def)

    const rowKeySet = new Set<string>()
    const colKeySet = new Set<string>()
    const cells = new Map<string, Map<string, number[]>>()

    const nValues = def.values.length
    for (const row of filtered) {
        const rk = keyFromTuple(def.rows.map((f) => stringifyRaw(row[f.sourceColumn])))
        const ck = keyFromTuple(def.cols.map((f) => stringifyRaw(row[f.sourceColumn])))
        rowKeySet.add(rk)
        colKeySet.add(ck)
        let byCol = cells.get(rk)
        if (byCol == null) {
            byCol = new Map<string, number[]>()
            cells.set(rk, byCol)
        }
        // Per-value-field accumulator: we push raw extracted numbers /
        // sentinels here, then fold once at the end.
        let bucket = byCol.get(ck)
        if (bucket == null) {
            bucket = newBucket(nValues)
            byCol.set(ck, bucket)
        }
        for (let i = 0; i < nValues; i++) {
            const cell = row[def.values[i].sourceColumn]
            updateBucket(bucket, i, cell)
        }
    }

    const rowKeys = Array.from(rowKeySet)
        .map((s) => JSON.parse(s) as string[])
        .sort(tupleCompare)
    const colKeys = Array.from(colKeySet)
        .map((s) => JSON.parse(s) as string[])
        .sort(tupleCompare)

    // Fold per-cell buckets into per-value aggregation results.
    const foldedCells = new Map<string, Map<string, number[]>>()
    for (const [rk, byCol] of cells) {
        const folded = new Map<string, number[]>()
        for (const [ck, bucket] of byCol) {
            folded.set(ck, foldBucket(bucket, def.values))
        }
        foldedCells.set(rk, folded)
    }

    // Subtotals + grand totals: re-aggregate from filtered rows using
    // each axis's prefix tuples. Cheaper than summing folded values
    // because non-additive aggregations (avg, stdDev) don't compose.
    const rowTotals = subtotalByAxis(filtered, def, 'rows')
    const colTotals = subtotalByAxis(filtered, def, 'cols')
    const grandTotals = subtotalGrand(filtered, def)

    return {
        rowKeys,
        colKeys,
        cells: foldedCells,
        rowTotals,
        colTotals,
        grandTotals,
    }
}

// Bucket layout — one slot per accumulator, per value field.
const IDX_SUM = 0
const IDX_COUNT = 1 // non-empty
const IDX_COUNT_NUM = 2
const IDX_MIN = 3
const IDX_MAX = 4
const IDX_PRODUCT = 5
const IDX_SUM_SQ = 6
const BUCKET_FIELDS = 7

function newBucket(nValues: number): number[] {
    const b = new Array(nValues * BUCKET_FIELDS).fill(0)
    for (let i = 0; i < nValues; i++) {
        b[i * BUCKET_FIELDS + IDX_MIN] = Number.POSITIVE_INFINITY
        b[i * BUCKET_FIELDS + IDX_MAX] = Number.NEGATIVE_INFINITY
        b[i * BUCKET_FIELDS + IDX_PRODUCT] = 1
    }
    return b
}

function updateBucket(bucket: number[], i: number, cell: CellValue): void {
    const base = i * BUCKET_FIELDS
    const isEmpty = cell.raw == null || cell.raw === ''
    if (!isEmpty) bucket[base + IDX_COUNT]++
    if (typeof cell.raw === 'number' && Number.isFinite(cell.raw)) {
        const n = cell.raw
        bucket[base + IDX_SUM] += n
        bucket[base + IDX_COUNT_NUM]++
        if (n < bucket[base + IDX_MIN]) bucket[base + IDX_MIN] = n
        if (n > bucket[base + IDX_MAX]) bucket[base + IDX_MAX] = n
        bucket[base + IDX_PRODUCT] *= n
        bucket[base + IDX_SUM_SQ] += n * n
    }
}

function foldBucket(bucket: number[], values: PivotDefinition['values']): number[] {
    return values.map((v, i) => foldOne(bucket, i, v.aggregation))
}

function foldOne(bucket: number[], i: number, agg: PivotAggregation): number {
    const base = i * BUCKET_FIELDS
    const sum = bucket[base + IDX_SUM]
    const count = bucket[base + IDX_COUNT]
    const countNum = bucket[base + IDX_COUNT_NUM]
    const min = bucket[base + IDX_MIN]
    const max = bucket[base + IDX_MAX]
    const product = bucket[base + IDX_PRODUCT]
    const sumSq = bucket[base + IDX_SUM_SQ]
    switch (agg) {
        case 'sum':
            return sum
        case 'average':
            return countNum > 0 ? sum / countNum : 0
        case 'count':
            return count
        case 'countNums':
            return countNum
        case 'max':
            return countNum > 0 ? max : 0
        case 'min':
            return countNum > 0 ? min : 0
        case 'product':
            return countNum > 0 ? product : 0
        case 'var':
        case 'stdDev': {
            if (countNum < 2) return 0
            const mean = sum / countNum
            const variance = (sumSq - countNum * mean * mean) / (countNum - 1)
            return agg === 'var' ? variance : Math.sqrt(Math.max(0, variance))
        }
        case 'varp':
        case 'stdDevp': {
            if (countNum < 1) return 0
            const mean = sum / countNum
            const variance = (sumSq - countNum * mean * mean) / countNum
            return agg === 'varp' ? variance : Math.sqrt(Math.max(0, variance))
        }
    }
}

function applyFilters(
    rows: Array<Record<string, CellValue>>,
    def: PivotDefinition
): Array<Record<string, CellValue>> {
    if (def.filters.length === 0) return rows
    const active = new Map<string, Set<string>>()
    for (const f of def.filters) {
        const sel = def.filterSelections[f.sourceColumn]
        if (sel != null && sel.length > 0) {
            active.set(f.sourceColumn, new Set(sel))
        }
    }
    if (active.size === 0) return rows
    return rows.filter((row) => {
        for (const [col, allowed] of active) {
            if (!allowed.has(stringifyRaw(row[col]))) return false
        }
        return true
    })
}

function subtotalByAxis(
    rows: Array<Record<string, CellValue>>,
    def: PivotDefinition,
    axis: 'rows' | 'cols'
): Map<string, number[]> {
    const fields = axis === 'rows' ? def.rows : def.cols
    const out = new Map<string, number[]>()
    const buckets = new Map<string, number[]>()
    for (const row of rows) {
        const key = keyFromTuple(fields.map((f) => stringifyRaw(row[f.sourceColumn])))
        let b = buckets.get(key)
        if (b == null) {
            b = newBucket(def.values.length)
            buckets.set(key, b)
        }
        for (let i = 0; i < def.values.length; i++) {
            updateBucket(b, i, row[def.values[i].sourceColumn])
        }
    }
    for (const [key, b] of buckets) {
        out.set(key, foldBucket(b, def.values))
    }
    return out
}

function subtotalGrand(
    rows: Array<Record<string, CellValue>>,
    def: PivotDefinition
): number[] {
    const b = newBucket(def.values.length)
    for (const row of rows) {
        for (let i = 0; i < def.values.length; i++) {
            updateBucket(b, i, row[def.values[i].sourceColumn])
        }
    }
    return foldBucket(b, def.values)
}

function stringifyRaw(cell: CellValue | undefined): string {
    if (cell == null) return ''
    if (cell.raw == null) return ''
    if (cell.raw instanceof Date) return cell.raw.toISOString()
    return String(cell.raw)
}

function keyFromTuple(parts: string[]): string {
    return JSON.stringify(parts)
}

function tupleCompare(a: string[], b: string[]): number {
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) {
        if (a[i] < b[i]) return -1
        if (a[i] > b[i]) return 1
    }
    return a.length - b.length
}
