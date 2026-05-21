// Tests for the reactive pivot hooks. The hooks themselves are thin
// useSyncExternalStore wrappers around the Y.Doc pivots Y.Map. The
// vitest setup here runs in a node environment without jsdom or
// @testing-library/react, so we test the data-flow contract directly
// (matching use-y-cell.test.ts style) rather than mounting React.
//
// What we verify per hook:
//   - subscribe attaches the right observer (covers add/remove and
//     scalar-field mutations on existing entries via observeDeep)
//   - getSnapshot returns the expected PivotDefinition[] for the doc
//   - the snapshot is stably identity-cached when nothing changed
//     (the React invariant that prevents infinite re-renders)

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { __pivotForSheetHookInternals as pivotForSheet } from '../tinycld/calc/hooks/use-pivot-for-sheet'
import { __pivotsHookInternals as pivots } from '../tinycld/calc/hooks/use-pivots'
import { __renderedPivotHookInternals as renderedPivot } from '../tinycld/calc/hooks/use-rendered-pivot'
import { writePivot } from '../tinycld/calc/lib/pivot/y-binding'
import type { CellValue, PivotDefinition } from '../tinycld/calc/lib/workbook-types'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import {
    CELLS_MAP,
    PIVOT_SHEET_KEY,
    PIVOTS_MAP,
    SHEETS_MAP,
} from '../tinycld/calc/lib/y-doc-bootstrap'

function makeDef(overrides: Partial<PivotDefinition> = {}): PivotDefinition {
    return {
        id: 'p1',
        sourceRange: 'Sheet1!A1:C3',
        targetSheetName: 'Pivot of Sheet1',
        rows: [{ sourceColumn: 'Region' }],
        cols: [],
        values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
        filters: [],
        filterSelections: {},
        rowGrandTotals: true,
        colGrandTotals: true,
        rowSubtotals: false,
        colSubtotals: false,
        ...overrides,
    }
}

// runHookSimulation mirrors what React's useSyncExternalStore does:
// 1) call getSnapshot to read the current value
// 2) call subscribe to attach the observer with a callback that, when
//    fired, would trigger a re-render — i.e. call getSnapshot again
// 3) record snapshots over time
// 4) return a teardown that releases the observer
//
// This gives us the same per-mutation visibility the hook exposes to a
// React component, without needing jsdom.
function runHookSimulation(doc: Y.Doc) {
    const snapshotState = pivots.createSnapshotState()
    const reads: PivotDefinition[][] = []
    const read = () => {
        const next = pivots.computeSnapshot(doc, snapshotState)
        reads.push(next)
        return next
    }
    // initial read
    read()
    const unsubscribe = pivots.subscribe(doc, () => {
        read()
    })
    return {
        reads,
        latest: () => reads[reads.length - 1],
        unsubscribe,
    }
}

describe('usePivots data-flow contract', () => {
    it('returns empty array when no pivots exist', () => {
        const doc = new Y.Doc()
        const sim = runHookSimulation(doc)
        expect(sim.latest()).toEqual([])
        sim.unsubscribe()
    })

    it('emits an updated snapshot when a pivot is added', () => {
        const doc = new Y.Doc()
        const sim = runHookSimulation(doc)
        expect(sim.latest()).toEqual([])
        writePivot(doc, makeDef())
        expect(sim.latest()).toHaveLength(1)
        expect(sim.latest()[0].id).toBe('p1')
        sim.unsubscribe()
    })

    it('emits an updated snapshot when a scalar field of an existing pivot changes', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        const sim = runHookSimulation(doc)
        const before = sim.latest()[0].sourceRange
        const entry = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP).get('p1') as Y.Map<unknown>
        entry.set('sourceRange', 'Sheet1!A1:C5')
        expect(sim.latest()[0].sourceRange).not.toBe(before)
        expect(sim.latest()[0].sourceRange).toBe('Sheet1!A1:C5')
        sim.unsubscribe()
    })

    it('emits an updated snapshot when a field array on an existing pivot changes', () => {
        // observeDeep catches Y.Array mutations (rows/cols/values/filters).
        // If a row field is pushed onto rows in place, the snapshot must
        // reflect it on the next read.
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        const sim = runHookSimulation(doc)
        const before = sim.latest()[0].rows.length
        const entry = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP).get('p1') as Y.Map<unknown>
        const rows = entry.get('rows') as Y.Array<Y.Map<unknown>>
        const m = new Y.Map<unknown>()
        m.set('sourceColumn', 'Year')
        rows.push([m])
        expect(sim.latest()[0].rows.length).toBe(before + 1)
        expect(sim.latest()[0].rows[1]?.sourceColumn).toBe('Year')
        sim.unsubscribe()
    })

    it('emits an updated snapshot when a pivot is deleted', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        const sim = runHookSimulation(doc)
        expect(sim.latest()).toHaveLength(1)
        doc.getMap<Y.Map<unknown>>(PIVOTS_MAP).delete('p1')
        expect(sim.latest()).toEqual([])
        sim.unsubscribe()
    })

    it('returns the same array identity when getSnapshot is called twice with no change', () => {
        // React invariant: useSyncExternalStore loops forever if
        // getSnapshot returns a fresh array each render.
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        const snapshotState = pivots.createSnapshotState()
        const a = pivots.computeSnapshot(doc, snapshotState)
        const b = pivots.computeSnapshot(doc, snapshotState)
        expect(a).toBe(b)
    })

    it('returns a different array identity after a change', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        const snapshotState = pivots.createSnapshotState()
        const a = pivots.computeSnapshot(doc, snapshotState)
        const entry = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP).get('p1') as Y.Map<unknown>
        entry.set('sourceRange', 'Sheet1!A1:C9')
        const b = pivots.computeSnapshot(doc, snapshotState)
        expect(a).not.toBe(b)
    })

    it('returns the cached empty array identity when doc is null', () => {
        // The hook can be called before the doc is ready (e.g. during
        // initial render). It must not throw and must return a stable
        // empty array identity.
        const snapshotState = pivots.createSnapshotState()
        const a = pivots.computeSnapshot(null, snapshotState)
        const b = pivots.computeSnapshot(null, snapshotState)
        expect(a).toEqual([])
        expect(a).toBe(b)
    })

    it('subscribe returns a no-op cleanup when doc is null', () => {
        const off = pivots.subscribe(null, () => {})
        expect(() => off()).not.toThrow()
    })
})

// usePivotForSheet uses the same node-friendly internals pattern as
// usePivots: the hook itself is a thin useSyncExternalStore wrapper
// over a subscribe + computeSnapshot pair, and we drive the data-flow
// contract directly without React.

function runPivotForSheetSim(doc: Y.Doc, sheetId: string) {
    const snapshotState = pivotForSheet.createSnapshotState()
    const reads: (PivotDefinition | null)[] = []
    const read = () => {
        const next = pivotForSheet.computeSnapshot(doc, sheetId, snapshotState)
        reads.push(next)
        return next
    }
    read()
    const unsubscribe = pivotForSheet.subscribe(doc, () => {
        read()
    })
    return {
        reads,
        latest: () => reads[reads.length - 1],
        unsubscribe,
    }
}

describe('usePivotForSheet data-flow contract', () => {
    it('returns null when sheet has no pivotId meta', () => {
        const doc = new Y.Doc()
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        sheetsMap.set('s1', new Y.Map())
        const sim = runPivotForSheetSim(doc, 's1')
        expect(sim.latest()).toBeNull()
        sim.unsubscribe()
    })

    it('returns the matching pivot when pivotId is set on the sheet meta', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        const meta = new Y.Map<unknown>()
        meta.set(PIVOT_SHEET_KEY, 'p1')
        sheetsMap.set('s2', meta)
        const sim = runPivotForSheetSim(doc, 's2')
        expect(sim.latest()?.id).toBe('p1')
        sim.unsubscribe()
    })

    it('emits a fresh snapshot when the pivot scalar field changes', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        const meta = new Y.Map<unknown>()
        meta.set(PIVOT_SHEET_KEY, 'p1')
        sheetsMap.set('s2', meta)
        const sim = runPivotForSheetSim(doc, 's2')
        const before = sim.latest()?.sourceRange
        const entry = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP).get('p1') as Y.Map<unknown>
        entry.set('sourceRange', 'Sheet1!A1:C7')
        expect(sim.latest()?.sourceRange).not.toBe(before)
        expect(sim.latest()?.sourceRange).toBe('Sheet1!A1:C7')
        sim.unsubscribe()
    })

    it('emits a null snapshot when the sheet loses its pivotId', () => {
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        const meta = new Y.Map<unknown>()
        meta.set(PIVOT_SHEET_KEY, 'p1')
        sheetsMap.set('s2', meta)
        const sim = runPivotForSheetSim(doc, 's2')
        expect(sim.latest()?.id).toBe('p1')
        meta.delete(PIVOT_SHEET_KEY)
        expect(sim.latest()).toBeNull()
        sim.unsubscribe()
    })

    it('returns the same snapshot identity when nothing changed', () => {
        // React invariant: useSyncExternalStore loops forever if
        // getSnapshot returns a fresh object on every call.
        const doc = new Y.Doc()
        writePivot(doc, makeDef())
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        const meta = new Y.Map<unknown>()
        meta.set(PIVOT_SHEET_KEY, 'p1')
        sheetsMap.set('s2', meta)
        const snapshotState = pivotForSheet.createSnapshotState()
        const a = pivotForSheet.computeSnapshot(doc, 's2', snapshotState)
        const b = pivotForSheet.computeSnapshot(doc, 's2', snapshotState)
        expect(a).toBe(b)
    })

    it('returns null stably when doc is null', () => {
        const snapshotState = pivotForSheet.createSnapshotState()
        const a = pivotForSheet.computeSnapshot(null, 's1', snapshotState)
        const b = pivotForSheet.computeSnapshot(null, 's1', snapshotState)
        expect(a).toBeNull()
        expect(b).toBeNull()
    })

    it('subscribe returns a no-op cleanup when doc is null', () => {
        const off = pivotForSheet.subscribe(null, () => {})
        expect(() => off()).not.toThrow()
    })
})

// useRenderedPivot is the reactive bridge between a PivotDefinition
// and the engine (computePivot). It must recompute when source cells
// inside the def's source range change, AND must NOT recompute when
// unrelated cells (outside the source rect, or on a different sheet)
// change. We exercise the data-flow contract via the same internals
// pattern as the other hooks — no React mount needed.

function writeCell(
    doc: Y.Doc,
    sheetId: string,
    row: number,
    col: number,
    cell: CellValue
): void {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const m = new Y.Map<unknown>()
    m.set('kind', cell.kind)
    m.set('raw', cell.raw)
    m.set('display', cell.display)
    if (cell.formula != null) m.set('formula', cell.formula)
    cellsMap.set(yCellKey(sheetId, row, col), m)
}

function mutateCellRaw(
    doc: Y.Doc,
    sheetId: string,
    row: number,
    col: number,
    raw: number | string
): void {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const existing = cellsMap.get(yCellKey(sheetId, row, col))
    if (!(existing instanceof Y.Map)) throw new Error('cell missing')
    existing.set('raw', raw)
    existing.set('display', String(raw))
}

function setSheetName(doc: Y.Doc, sheetId: string, name: string): void {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    let meta = sheetsMap.get(sheetId)
    if (!(meta instanceof Y.Map)) {
        meta = new Y.Map<unknown>()
        sheetsMap.set(sheetId, meta)
    }
    meta.set('name', name)
}

function str(s: string): CellValue {
    return { kind: 'string', raw: s, display: s }
}
function num(n: number): CellValue {
    return { kind: 'number', raw: n, display: String(n) }
}

// Seed: 3x3 region/year/sales table on a sheet named "Sheet1" with id
// "s1". Source range is Sheet1!A1:C3 (header + 2 data rows).
function seedDocWithSourceTable(doc: Y.Doc): void {
    setSheetName(doc, 's1', 'Sheet1')
    writeCell(doc, 's1', 1, 1, str('Region'))
    writeCell(doc, 's1', 1, 2, str('Year'))
    writeCell(doc, 's1', 1, 3, str('Sales'))
    writeCell(doc, 's1', 2, 1, str('East'))
    writeCell(doc, 's1', 2, 2, num(2024))
    writeCell(doc, 's1', 2, 3, num(10))
    writeCell(doc, 's1', 3, 1, str('West'))
    writeCell(doc, 's1', 3, 2, num(2024))
    writeCell(doc, 's1', 3, 3, num(5))
}

function pivotDefFor(): PivotDefinition {
    return makeDef({
        sourceRange: 'Sheet1!A1:C3',
        rows: [{ sourceColumn: 'Region' }],
        cols: [],
        values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
    })
}

function runRenderedPivotSim(doc: Y.Doc, def: PivotDefinition | null) {
    const state = renderedPivot.createSnapshotState()
    const reads: ReturnType<typeof renderedPivot.computeSnapshot>[] = []
    const read = () => {
        const next = renderedPivot.computeSnapshot(doc, def, state)
        reads.push(next)
        return next
    }
    read()
    const unsubscribe = renderedPivot.subscribe(doc, def, () => {
        read()
    })
    return {
        reads,
        latest: () => reads[reads.length - 1],
        unsubscribe,
    }
}

describe('useRenderedPivot data-flow contract', () => {
    it('returns an error result when doc is null', () => {
        const state = renderedPivot.createSnapshotState()
        const r = renderedPivot.computeSnapshot(null, pivotDefFor(), state)
        expect(r.ok).toBe(false)
    })

    it('returns an error result when def is null', () => {
        const doc = new Y.Doc()
        const state = renderedPivot.createSnapshotState()
        const r = renderedPivot.computeSnapshot(doc, null, state)
        expect(r.ok).toBe(false)
    })

    it('returns a RenderedPivot when given a valid doc + def + source data', () => {
        const doc = new Y.Doc()
        seedDocWithSourceTable(doc)
        const sim = runRenderedPivotSim(doc, pivotDefFor())
        const r = sim.latest()
        expect(r.ok).toBe(true)
        if (r.ok) {
            expect(r.value.cells.size).toBeGreaterThan(0)
        }
        sim.unsubscribe()
    })

    it('emits a fresh snapshot when a source cell value changes', () => {
        const doc = new Y.Doc()
        seedDocWithSourceTable(doc)
        const sim = runRenderedPivotSim(doc, pivotDefFor())
        const before = sim.latest()
        expect(before.ok).toBe(true)
        mutateCellRaw(doc, 's1', 2, 3, 999)
        const after = sim.latest()
        expect(after.ok).toBe(true)
        // Identity must differ — engine re-ran.
        expect(after).not.toBe(before)
    })

    it('emits a fresh snapshot when a source cell is added to a previously-empty key', () => {
        const doc = new Y.Doc()
        seedDocWithSourceTable(doc)
        // Wipe cell B2 from the source rect so writing it later is an
        // "add" event (changes.keys), not a nested mutation.
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        cellsMap.delete(yCellKey('s1', 2, 2))
        const sim = runRenderedPivotSim(doc, pivotDefFor())
        const initialReadCount = sim.reads.length
        writeCell(doc, 's1', 2, 2, num(2025))
        expect(sim.reads.length).toBeGreaterThan(initialReadCount)
    })

    it('does NOT recompute when a cell outside the source rect changes', () => {
        const doc = new Y.Doc()
        seedDocWithSourceTable(doc)
        const sim = runRenderedPivotSim(doc, pivotDefFor())
        const initialReadCount = sim.reads.length
        // Source range is A1:C3 — D4 is outside.
        writeCell(doc, 's1', 4, 4, num(42))
        expect(sim.reads.length).toBe(initialReadCount)
        sim.unsubscribe()
    })

    it('does NOT recompute when a cell on a different sheet changes', () => {
        const doc = new Y.Doc()
        seedDocWithSourceTable(doc)
        setSheetName(doc, 's2', 'Other')
        const sim = runRenderedPivotSim(doc, pivotDefFor())
        const initialReadCount = sim.reads.length
        writeCell(doc, 's2', 1, 1, str('unrelated'))
        expect(sim.reads.length).toBe(initialReadCount)
        sim.unsubscribe()
    })

    it('does recompute when an existing cell inside the source rect is mutated', () => {
        // observeDeep delivers nested events with ev.path = [<cellKey>]
        // for in-place mutations on existing cell Y.Maps. The subscribe
        // callback must inspect ev.path (not just ev.changes.keys) to
        // detect these.
        const doc = new Y.Doc()
        seedDocWithSourceTable(doc)
        const sim = runRenderedPivotSim(doc, pivotDefFor())
        const initialReadCount = sim.reads.length
        mutateCellRaw(doc, 's1', 3, 3, 77)
        expect(sim.reads.length).toBeGreaterThan(initialReadCount)
        sim.unsubscribe()
    })

    it('returns the same result identity when nothing changed', () => {
        // React invariant: useSyncExternalStore loops forever if
        // getSnapshot returns a fresh object on every call.
        const doc = new Y.Doc()
        seedDocWithSourceTable(doc)
        const state = renderedPivot.createSnapshotState()
        const a = renderedPivot.computeSnapshot(doc, pivotDefFor(), state)
        const b = renderedPivot.computeSnapshot(doc, pivotDefFor(), state)
        expect(a).toBe(b)
    })

    it('subscribe returns a no-op cleanup when doc is null', () => {
        const off = renderedPivot.subscribe(null, pivotDefFor(), () => {})
        expect(() => off()).not.toThrow()
    })

    it('subscribe returns a no-op cleanup when def is null', () => {
        const doc = new Y.Doc()
        const off = renderedPivot.subscribe(doc, null, () => {})
        expect(() => off()).not.toThrow()
    })
})
