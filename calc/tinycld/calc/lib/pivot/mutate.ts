// Mutators for a pivot definition. Each mutator is a small,
// transactional Y.Doc edit tagged LOCAL_ORIGIN so the realtime undo
// manager rewinds a change as a single step.

import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import * as Y from 'yjs'
import type { PivotAggregation } from '../workbook-types'
import { PIVOTS_MAP } from '../y-doc-bootstrap'

type SlotKey = 'rows' | 'cols' | 'values' | 'filters'

function withEntry<R>(
    doc: Y.Doc,
    id: string,
    fn: (entry: Y.Map<unknown>) => R
): R | undefined {
    const map = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP)
    const entry = map.get(id)
    if (!(entry instanceof Y.Map)) return undefined
    return fn(entry)
}

function getArr(
    entry: Y.Map<unknown>,
    slot: SlotKey
): Y.Array<Y.Map<unknown>> | null {
    const arr = entry.get(slot)
    return arr instanceof Y.Array ? (arr as Y.Array<Y.Map<unknown>>) : null
}

export function addRow(doc: Y.Doc, id: string, sourceColumn: string): void {
    appendField(doc, id, 'rows', sourceColumn)
}

export function addColumn(doc: Y.Doc, id: string, sourceColumn: string): void {
    appendField(doc, id, 'cols', sourceColumn)
}

export function addValue(
    doc: Y.Doc,
    id: string,
    sourceColumn: string,
    aggregation: PivotAggregation
): void {
    doc.transact(() => {
        withEntry(doc, id, (entry) => {
            const arr = getArr(entry, 'values')
            if (arr == null) return
            const m = new Y.Map<unknown>()
            m.set('sourceColumn', sourceColumn)
            m.set('aggregation', aggregation)
            arr.push([m])
        })
    }, LOCAL_ORIGIN)
}

export function addFilter(doc: Y.Doc, id: string, sourceColumn: string): void {
    appendField(doc, id, 'filters', sourceColumn)
}

function appendField(
    doc: Y.Doc,
    id: string,
    slot: SlotKey,
    sourceColumn: string
): void {
    doc.transact(() => {
        withEntry(doc, id, (entry) => {
            const arr = getArr(entry, slot)
            if (arr == null) return
            const m = new Y.Map<unknown>()
            m.set('sourceColumn', sourceColumn)
            arr.push([m])
        })
    }, LOCAL_ORIGIN)
}

export function removeField(
    doc: Y.Doc,
    id: string,
    slot: SlotKey,
    index: number
): void {
    doc.transact(() => {
        withEntry(doc, id, (entry) => {
            const arr = getArr(entry, slot)
            if (arr == null || index < 0 || index >= arr.length) return
            arr.delete(index, 1)
        })
    }, LOCAL_ORIGIN)
}

export function moveField(
    doc: Y.Doc,
    id: string,
    slot: SlotKey,
    fromIndex: number,
    toIndex: number
): void {
    doc.transact(() => {
        withEntry(doc, id, (entry) => {
            const arr = getArr(entry, slot)
            if (arr == null) return
            if (fromIndex < 0 || fromIndex >= arr.length) return
            if (toIndex < 0 || toIndex > arr.length) return
            if (fromIndex === toIndex) return
            // Y.Array has no native move — clone the item's contents and
            // re-insert. Acceptable here because field maps are tiny
            // (sourceColumn + optional displayName/aggregation/numFmt).
            const src = arr.get(fromIndex) as Y.Map<unknown>
            const replacement = new Y.Map<unknown>()
            src.forEach((v, k) => replacement.set(k, v))
            arr.delete(fromIndex, 1)
            const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex
            arr.insert(insertAt, [replacement])
        })
    }, LOCAL_ORIGIN)
}

export function setValueAggregation(
    doc: Y.Doc,
    id: string,
    valueIndex: number,
    aggregation: PivotAggregation
): void {
    doc.transact(() => {
        withEntry(doc, id, (entry) => {
            const arr = getArr(entry, 'values')
            if (arr == null) return
            const m = arr.get(valueIndex)
            if (m instanceof Y.Map) m.set('aggregation', aggregation)
        })
    }, LOCAL_ORIGIN)
}

export function setValueNumFmt(
    doc: Y.Doc,
    id: string,
    valueIndex: number,
    numFmt: string
): void {
    doc.transact(() => {
        withEntry(doc, id, (entry) => {
            const arr = getArr(entry, 'values')
            if (arr == null) return
            const m = arr.get(valueIndex)
            if (!(m instanceof Y.Map)) return
            if (numFmt === '') m.delete('numFmt')
            else m.set('numFmt', numFmt)
        })
    }, LOCAL_ORIGIN)
}

export function setFilterSelection(
    doc: Y.Doc,
    id: string,
    column: string,
    values: readonly string[]
): void {
    doc.transact(() => {
        withEntry(doc, id, (entry) => {
            const sel = entry.get('filterSelections')
            if (!(sel instanceof Y.Map)) return
            if (values.length === 0) {
                sel.delete(column)
                return
            }
            const arr = new Y.Array<string>()
            arr.push(values.slice())
            sel.set(column, arr)
        })
    }, LOCAL_ORIGIN)
}

export function setBoolean(
    doc: Y.Doc,
    id: string,
    key: 'rowGrandTotals' | 'colGrandTotals' | 'rowSubtotals' | 'colSubtotals',
    value: boolean
): void {
    doc.transact(() => {
        withEntry(doc, id, (entry) => {
            entry.set(key, value)
        })
    }, LOCAL_ORIGIN)
}

export function setSourceRange(
    doc: Y.Doc,
    id: string,
    sourceRange: string
): void {
    doc.transact(() => {
        withEntry(doc, id, (entry) => entry.set('sourceRange', sourceRange))
    }, LOCAL_ORIGIN)
}

export function setStyleName(doc: Y.Doc, id: string, name: string): void {
    doc.transact(() => {
        withEntry(doc, id, (entry) => {
            if (name === '') entry.delete('styleName')
            else entry.set('styleName', name)
        })
    }, LOCAL_ORIGIN)
}
