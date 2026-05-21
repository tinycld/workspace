// Y.Doc binding for pivot definitions. Owns the encoding from a plain
// PivotDefinition (POJO) to the Y.Map / Y.Array tree under
// doc.getMap('pivots'), and the inverse read path. Scalars are Y.Map
// keys (LWW per key); rows/cols/values/filters are Y.Arrays so
// concurrent additions interleave gracefully (see Q8 in design).

import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import * as Y from 'yjs'
import type {
    PivotAggregation,
    PivotDefinition,
    PivotField,
    PivotValueField,
} from '../workbook-types'
import { PIVOTS_MAP } from './keys'

export function readPivotIds(doc: Y.Doc): string[] {
    const map = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP)
    return Array.from(map.keys())
}

export function readPivot(doc: Y.Doc, id: string): PivotDefinition | null {
    const map = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP)
    const entry = map.get(id)
    if (!(entry instanceof Y.Map)) return null
    return readPivotFromMap(id, entry)
}

export function readPivotFromMap(
    id: string,
    entry: Y.Map<unknown>
): PivotDefinition {
    return {
        id,
        sourceRange: readString(entry, 'sourceRange'),
        targetSheetName: readString(entry, 'targetSheetName'),
        rows: readFields(entry, 'rows'),
        cols: readFields(entry, 'cols'),
        values: readValueFields(entry),
        filters: readFields(entry, 'filters'),
        filterSelections: readFilterSelections(entry),
        rowGrandTotals: readBool(entry, 'rowGrandTotals'),
        colGrandTotals: readBool(entry, 'colGrandTotals'),
        rowSubtotals: readBool(entry, 'rowSubtotals'),
        colSubtotals: readBool(entry, 'colSubtotals'),
        styleName: readOptionalString(entry, 'styleName'),
    }
}

export function writePivot(doc: Y.Doc, def: PivotDefinition): void {
    const map = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP)
    doc.transact(() => {
        const entry = new Y.Map<unknown>()
        entry.set('sourceRange', def.sourceRange)
        entry.set('targetSheetName', def.targetSheetName)
        entry.set('rows', buildFieldArray(def.rows))
        entry.set('cols', buildFieldArray(def.cols))
        entry.set('values', buildValueFieldArray(def.values))
        entry.set('filters', buildFieldArray(def.filters))
        entry.set('filterSelections', buildFilterSelections(def.filterSelections))
        entry.set('rowGrandTotals', def.rowGrandTotals)
        entry.set('colGrandTotals', def.colGrandTotals)
        entry.set('rowSubtotals', def.rowSubtotals)
        entry.set('colSubtotals', def.colSubtotals)
        if (def.styleName != null && def.styleName !== '') {
            entry.set('styleName', def.styleName)
        }
        map.set(def.id, entry)
    }, LOCAL_ORIGIN)
}

export function deletePivot(doc: Y.Doc, id: string): void {
    const map = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP)
    doc.transact(() => {
        map.delete(id)
    }, LOCAL_ORIGIN)
}

// ---------- helpers ----------

function buildFieldArray(fields: PivotField[]): Y.Array<Y.Map<unknown>> {
    const arr = new Y.Array<Y.Map<unknown>>()
    for (const f of fields) arr.push([buildFieldMap(f)])
    return arr
}

function buildFieldMap(f: PivotField): Y.Map<unknown> {
    const m = new Y.Map<unknown>()
    m.set('sourceColumn', f.sourceColumn)
    if (f.displayName != null && f.displayName !== '') {
        m.set('displayName', f.displayName)
    }
    return m
}

function buildValueFieldArray(
    fields: PivotValueField[]
): Y.Array<Y.Map<unknown>> {
    const arr = new Y.Array<Y.Map<unknown>>()
    for (const f of fields) {
        const m = buildFieldMap(f)
        m.set('aggregation', f.aggregation)
        if (f.numFmt != null && f.numFmt !== '') m.set('numFmt', f.numFmt)
        arr.push([m])
    }
    return arr
}

function buildFilterSelections(
    sel: Record<string, string[]>
): Y.Map<Y.Array<string>> {
    const m = new Y.Map<Y.Array<string>>()
    for (const [col, vals] of Object.entries(sel)) {
        if (!Array.isArray(vals) || vals.length === 0) continue
        const a = new Y.Array<string>()
        a.push(vals.slice())
        m.set(col, a)
    }
    return m
}

function readFields(entry: Y.Map<unknown>, key: string): PivotField[] {
    const arr = entry.get(key)
    if (!(arr instanceof Y.Array)) return []
    const out: PivotField[] = []
    arr.forEach(item => {
        if (!(item instanceof Y.Map)) return
        out.push(readFieldFromMap(item))
    })
    return out
}

function readFieldFromMap(m: Y.Map<unknown>): PivotField {
    const sourceColumn = m.get('sourceColumn')
    const displayName = m.get('displayName')
    return {
        sourceColumn: typeof sourceColumn === 'string' ? sourceColumn : '',
        displayName:
            typeof displayName === 'string' && displayName !== ''
                ? displayName
                : undefined,
    }
}

function readValueFields(entry: Y.Map<unknown>): PivotValueField[] {
    const arr = entry.get('values')
    if (!(arr instanceof Y.Array)) return []
    const out: PivotValueField[] = []
    arr.forEach(item => {
        if (!(item instanceof Y.Map)) return
        const base = readFieldFromMap(item)
        const agg = item.get('aggregation')
        const numFmt = item.get('numFmt')
        out.push({
            ...base,
            aggregation: normalizeAggregation(agg),
            numFmt: typeof numFmt === 'string' && numFmt !== '' ? numFmt : undefined,
        })
    })
    return out
}

function readFilterSelections(entry: Y.Map<unknown>): Record<string, string[]> {
    const m = entry.get('filterSelections')
    if (!(m instanceof Y.Map)) return {}
    const out: Record<string, string[]> = {}
    m.forEach((v, k) => {
        if (!(v instanceof Y.Array)) return
        const vals: string[] = []
        v.forEach(x => {
            if (typeof x === 'string') vals.push(x)
        })
        if (vals.length > 0) out[k] = vals
    })
    return out
}

function readString(entry: Y.Map<unknown>, key: string): string {
    const v = entry.get(key)
    return typeof v === 'string' ? v : ''
}

function readOptionalString(
    entry: Y.Map<unknown>,
    key: string
): string | undefined {
    const v = entry.get(key)
    return typeof v === 'string' && v !== '' ? v : undefined
}

function readBool(entry: Y.Map<unknown>, key: string): boolean {
    return entry.get(key) === true
}

const VALID_AGGS: ReadonlySet<PivotAggregation> = new Set([
    'sum',
    'average',
    'count',
    'countNums',
    'max',
    'min',
    'product',
    'stdDev',
    'stdDevp',
    'var',
    'varp',
])

function normalizeAggregation(v: unknown): PivotAggregation {
    if (typeof v === 'string' && VALID_AGGS.has(v as PivotAggregation)) {
        return v as PivotAggregation
    }
    return 'sum'
}
