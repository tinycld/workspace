// Lay a GroupedTree out as a 2D cell grid.
// Header layout:
//   - Top-left empty block: headerRowCount x headerColCount
//   - Above the data block: one header row per col field, plus one
//     extra "value labels" row when len(values) > 1.
//   - Left of the data block: one column per row field.
// Subtotal rows (rowSubtotals=true) appear inside the row band, grouped
// by the prefix tuple of the row keys. Grand totals are at the bottom /
// right; the corner cell is the row-grand total of all values.

import { applyNumFmt } from '../number-format/format'
import type { CellValue, PivotDefinition } from '../workbook-types'
import type { GroupedTree, RenderedPivot } from './types'

export function renderPivot(tree: GroupedTree, def: PivotDefinition): RenderedPivot {
    const valueCount = Math.max(1, def.values.length)
    const headerRowCount = def.cols.length + (def.values.length > 1 ? 1 : 0) || 1
    const headerColCount = def.rows.length

    // Row band: each row key produces a render-row; if rowSubtotals,
    // group by the first row field and emit a subtotal after each group.
    const renderRows = buildRenderRows(tree, def)
    const renderCols = buildRenderCols(tree, def)

    const totalRows =
        headerRowCount + renderRows.length + (def.colGrandTotals ? 1 : 0)
    const totalCols =
        headerColCount +
        renderCols.length * valueCount +
        (def.rowGrandTotals ? valueCount : 0)

    const cells = new Map<string, CellValue>()

    // ----- header band -----
    writeColHeaders(cells, def, renderCols, headerRowCount, headerColCount)
    if (def.rowGrandTotals) {
        const startCol = headerColCount + renderCols.length * valueCount
        for (let v = 0; v < valueCount; v++) {
            cells.set(
                `1:${startCol + v + 1}`,
                stringCell(valueCount > 1 ? '' : 'Grand Total')
            )
            if (valueCount > 1) {
                cells.set(
                    `${headerRowCount}:${startCol + v + 1}`,
                    stringCell(valueLabel(def, v))
                )
            }
        }
        if (valueCount === 1 && headerRowCount > 1) {
            cells.set(`${headerRowCount}:${startCol + 1}`, stringCell('Grand Total'))
        }
    }

    // ----- row band + data -----
    for (let i = 0; i < renderRows.length; i++) {
        const r = renderRows[i]
        const renderRowIdx = headerRowCount + i + 1
        writeRowHeaders(cells, def, r, renderRowIdx, headerColCount)
        for (let j = 0; j < renderCols.length; j++) {
            const c = renderCols[j]
            const colBase = headerColCount + j * valueCount + 1
            const folded =
                r.kind === 'data'
                    ? tree.cells.get(r.key)?.get(c.key)
                    : r.kind === 'subtotal'
                      ? subtotalCellValues(tree, def, r.prefixKey, c.key)
                      : undefined
            for (let v = 0; v < valueCount; v++) {
                cells.set(
                    `${renderRowIdx}:${colBase + v}`,
                    numericCell(folded?.[v], def, v)
                )
            }
        }
        if (def.rowGrandTotals) {
            const colBase = headerColCount + renderCols.length * valueCount + 1
            const totals =
                r.kind === 'data'
                    ? tree.rowTotals.get(r.key)
                    : r.kind === 'subtotal'
                      ? rowSubtotalGrand(tree, def, r.prefixKey)
                      : undefined
            for (let v = 0; v < valueCount; v++) {
                cells.set(
                    `${renderRowIdx}:${colBase + v}`,
                    numericCell(totals?.[v], def, v)
                )
            }
        }
    }

    // ----- grand-total row -----
    if (def.colGrandTotals) {
        const grandRow = headerRowCount + renderRows.length + 1
        cells.set(`${grandRow}:1`, stringCell('Grand Total'))
        for (let j = 0; j < renderCols.length; j++) {
            const c = renderCols[j]
            const colBase = headerColCount + j * valueCount + 1
            const totals = tree.colTotals.get(c.key)
            for (let v = 0; v < valueCount; v++) {
                cells.set(
                    `${grandRow}:${colBase + v}`,
                    numericCell(totals?.[v], def, v)
                )
            }
        }
        if (def.rowGrandTotals) {
            const colBase = headerColCount + renderCols.length * valueCount + 1
            for (let v = 0; v < valueCount; v++) {
                cells.set(
                    `${grandRow}:${colBase + v}`,
                    numericCell(tree.grandTotals[v], def, v)
                )
            }
        }
    }

    return {
        rows: totalRows,
        cols: totalCols,
        cells,
        headerRowCount,
        headerColCount,
    }
}

// ---------- render-row planning ----------

type RenderRow =
    | { kind: 'data'; tuple: string[]; key: string }
    | { kind: 'subtotal'; prefix: string[]; prefixKey: string }

function buildRenderRows(tree: GroupedTree, def: PivotDefinition): RenderRow[] {
    if (tree.rowKeys.length === 0) {
        return [{ kind: 'data', tuple: [], key: JSON.stringify([]) }]
    }
    const out: RenderRow[] = []
    if (!def.rowSubtotals || def.rows.length < 2) {
        for (const t of tree.rowKeys) {
            out.push({ kind: 'data', tuple: t, key: JSON.stringify(t) })
        }
        return out
    }
    let prevPrefix: string | null = null
    let prevPrefixTuple: string[] = []
    for (const t of tree.rowKeys) {
        const prefix = t.slice(0, 1)
        const prefixKey = JSON.stringify(prefix)
        if (prevPrefix != null && prefixKey !== prevPrefix) {
            out.push({
                kind: 'subtotal',
                prefix: prevPrefixTuple,
                prefixKey: prevPrefix,
            })
        }
        out.push({ kind: 'data', tuple: t, key: JSON.stringify(t) })
        prevPrefix = prefixKey
        prevPrefixTuple = prefix
    }
    if (prevPrefix != null) {
        out.push({
            kind: 'subtotal',
            prefix: prevPrefixTuple,
            prefixKey: prevPrefix,
        })
    }
    return out
}

function buildRenderCols(
    tree: GroupedTree,
    _def: PivotDefinition
): Array<{ tuple: string[]; key: string }> {
    if (tree.colKeys.length === 0) {
        return [{ tuple: [], key: JSON.stringify([]) }]
    }
    return tree.colKeys.map((t) => ({ tuple: t, key: JSON.stringify(t) }))
}

// ---------- header writers ----------

function writeColHeaders(
    cells: Map<string, CellValue>,
    def: PivotDefinition,
    renderCols: Array<{ tuple: string[] }>,
    headerRowCount: number,
    headerColCount: number
): void {
    const valueCount = Math.max(1, def.values.length)
    // Each col-field row prints the per-tuple component, spanning
    // valueCount cells.
    for (let level = 0; level < def.cols.length; level++) {
        for (let j = 0; j < renderCols.length; j++) {
            const tuple = renderCols[j].tuple
            const text = tuple[level] ?? ''
            const colBase = headerColCount + j * valueCount + 1
            cells.set(`${level + 1}:${colBase}`, stringCell(text))
        }
    }
    if (def.values.length > 1) {
        // Last header row prints "Sum of <field>" per value.
        const lastRow = headerRowCount
        for (let j = 0; j < renderCols.length; j++) {
            const colBase = headerColCount + j * valueCount + 1
            for (let v = 0; v < def.values.length; v++) {
                cells.set(
                    `${lastRow}:${colBase + v}`,
                    stringCell(valueLabel(def, v))
                )
            }
        }
    } else if (def.cols.length === 0 && def.values.length === 1) {
        // No col fields, single value — emit the value label as the
        // single column heading.
        cells.set(`1:${headerColCount + 1}`, stringCell(valueLabel(def, 0)))
    }
}

function writeRowHeaders(
    cells: Map<string, CellValue>,
    def: PivotDefinition,
    r: RenderRow,
    rowIdx: number,
    _headerColCount: number
): void {
    if (r.kind === 'data') {
        for (let level = 0; level < def.rows.length; level++) {
            cells.set(`${rowIdx}:${level + 1}`, stringCell(r.tuple[level] ?? ''))
        }
        // Pure no-rows pivot — no row-label column to write.
    } else {
        cells.set(`${rowIdx}:1`, stringCell(`${r.prefix[0]} Total`))
        // Subsequent row-header columns are left blank.
        for (let level = 1; level < def.rows.length; level++) {
            cells.set(`${rowIdx}:${level + 1}`, stringCell(''))
        }
    }
}

// ---------- subtotal numeric folds ----------
//
// rowTotals/colTotals already contain the per-row / per-col grand totals.
// For row subtotals at the prefix-tuple level, we walk the tree and sum
// only the data cells whose row tuple starts with `prefix`. This re-fold
// is good enough for v1 where subtotals are only shown for additive
// aggregations (sum/count/min/max/product/countNums) — non-additive
// aggregations (average, stdDev, var) don't compose this way and will
// be revisited when subtotals graduate beyond additive folds.

function subtotalCellValues(
    tree: GroupedTree,
    def: PivotDefinition,
    prefixKey: string,
    colKey: string
): number[] | undefined {
    const prefix = JSON.parse(prefixKey) as string[]
    const result = new Array(def.values.length).fill(0)
    let touched = false
    for (const [rk, byCol] of tree.cells) {
        const tuple = JSON.parse(rk) as string[]
        if (!tupleStartsWith(tuple, prefix)) continue
        const folded = byCol.get(colKey)
        if (folded == null) continue
        for (let v = 0; v < def.values.length; v++) {
            result[v] += folded[v]
        }
        touched = true
    }
    return touched ? result : undefined
}

function rowSubtotalGrand(
    tree: GroupedTree,
    def: PivotDefinition,
    prefixKey: string
): number[] {
    const prefix = JSON.parse(prefixKey) as string[]
    const result = new Array(def.values.length).fill(0)
    for (const [rk, totals] of tree.rowTotals) {
        const tuple = JSON.parse(rk) as string[]
        if (!tupleStartsWith(tuple, prefix)) continue
        for (let v = 0; v < def.values.length; v++) {
            result[v] += totals[v]
        }
    }
    return result
}

function tupleStartsWith(tuple: string[], prefix: string[]): boolean {
    if (prefix.length > tuple.length) return false
    for (let i = 0; i < prefix.length; i++) {
        if (tuple[i] !== prefix[i]) return false
    }
    return true
}

// ---------- cell builders ----------

function stringCell(s: string): CellValue {
    return { kind: 'string', raw: s, display: s }
}

function numericCell(
    n: number | undefined,
    def: PivotDefinition,
    valueIdx: number
): CellValue {
    if (n == null || !Number.isFinite(n)) {
        return { kind: 'string', raw: '', display: '' }
    }
    const numFmt = def.values[valueIdx]?.numFmt
    const display = applyNumFmt('number', n, numFmt)
    return {
        kind: 'number',
        raw: n,
        display,
        style: numFmt ? { numFmt } : undefined,
    }
}

function valueLabel(def: PivotDefinition, valueIdx: number): string {
    const v = def.values[valueIdx]
    if (v == null) return ''
    const verb = aggregationVerb(v.aggregation)
    const label = v.displayName ?? v.sourceColumn
    return `${verb} of ${label}`
}

function aggregationVerb(
    agg: PivotDefinition['values'][number]['aggregation']
): string {
    switch (agg) {
        case 'sum':
            return 'Sum'
        case 'average':
            return 'Average'
        case 'count':
            return 'Count'
        case 'countNums':
            return 'Count Nums'
        case 'max':
            return 'Max'
        case 'min':
            return 'Min'
        case 'product':
            return 'Product'
        case 'stdDev':
            return 'StdDev'
        case 'stdDevp':
            return 'StdDevP'
        case 'var':
            return 'Var'
        case 'varp':
            return 'VarP'
    }
}
