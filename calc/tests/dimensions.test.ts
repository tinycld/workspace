import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
    autosizeColumnWidth,
    buildColOffsets,
    buildRowOffsets,
    COL_WIDTHS_KEY,
    clampColWidth,
    clampRowHeight,
    DEFAULT_COL_WIDTH,
    DEFAULT_ROW_HEIGHT,
    firstColAtOffset,
    firstRowAtOffset,
    HIDE_SNAP_THRESHOLD,
    lastColAtOffset,
    lastRowAtOffset,
    MAX_COL_WIDTH,
    MAX_ROW_HEIGHT,
    measureWidestDisplay,
    ROW_HEIGHTS_KEY,
    ROW_HIDE_SNAP_THRESHOLD,
    readColWidth,
    readColWidthsFromMeta,
    readRowHeight,
    readRowHeightsFromMeta,
    setYColWidth,
    setYRowHeight,
} from '../tinycld/calc/lib/dimensions'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP, SHEETS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

function bootstrapSheet(doc: Y.Doc, id = 'sheet1'): Y.Map<unknown> {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = new Y.Map<unknown>()
    meta.set('name', id)
    meta.set('position', 0)
    meta.set('rowCount', 10)
    meta.set('colCount', 10)
    sheetsMap.set(id, meta)
    return meta
}

describe('readColWidth', () => {
    it('returns DEFAULT_COL_WIDTH for missing entries', () => {
        expect(readColWidth(undefined, 1)).toBe(DEFAULT_COL_WIDTH)
        expect(readColWidth({}, 1)).toBe(DEFAULT_COL_WIDTH)
        expect(readColWidth({ 2: 200 }, 1)).toBe(DEFAULT_COL_WIDTH)
    })

    it('returns stored width for present entries', () => {
        expect(readColWidth({ 1: 200 }, 1)).toBe(200)
        expect(readColWidth({ 1: 0 }, 1)).toBe(0)
    })
})

describe('clampColWidth', () => {
    it('snaps narrow widths to zero', () => {
        expect(clampColWidth(0)).toBe(0)
        expect(clampColWidth(HIDE_SNAP_THRESHOLD - 1)).toBe(0)
    })

    it('preserves widths above the snap threshold', () => {
        expect(clampColWidth(HIDE_SNAP_THRESHOLD)).toBe(HIDE_SNAP_THRESHOLD)
        expect(clampColWidth(150)).toBe(150)
    })

    it('caps at MAX_COL_WIDTH', () => {
        expect(clampColWidth(MAX_COL_WIDTH + 100)).toBe(MAX_COL_WIDTH)
    })

    it('falls back to default for non-finite widths', () => {
        expect(clampColWidth(Number.NaN)).toBe(DEFAULT_COL_WIDTH)
        expect(clampColWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_COL_WIDTH)
    })
})

describe('setYColWidth', () => {
    it('lazily creates the colWidths map on first write', () => {
        const doc = new Y.Doc()
        const meta = bootstrapSheet(doc)
        expect(meta.get(COL_WIDTHS_KEY)).toBeUndefined()
        setYColWidth(doc, 'sheet1', 3, 200)
        const widths = meta.get(COL_WIDTHS_KEY)
        expect(widths).toBeInstanceOf(Y.Map)
        expect((widths as Y.Map<number>).get('3')).toBe(200)
    })

    it('writing the default width deletes the entry', () => {
        const doc = new Y.Doc()
        const meta = bootstrapSheet(doc)
        setYColWidth(doc, 'sheet1', 3, 200)
        setYColWidth(doc, 'sheet1', 3, DEFAULT_COL_WIDTH)
        const widths = meta.get(COL_WIDTHS_KEY) as Y.Map<number> | undefined
        expect(widths?.has('3')).toBe(false)
    })

    it('clamps width through the standard rules', () => {
        const doc = new Y.Doc()
        const meta = bootstrapSheet(doc)
        setYColWidth(doc, 'sheet1', 1, MAX_COL_WIDTH + 500)
        setYColWidth(doc, 'sheet1', 2, 3)
        const widths = meta.get(COL_WIDTHS_KEY) as Y.Map<number>
        expect(widths.get('1')).toBe(MAX_COL_WIDTH)
        expect(widths.get('2')).toBe(0)
    })

    it('is a no-op when sheet does not exist', () => {
        const doc = new Y.Doc()
        bootstrapSheet(doc, 'sheet1')
        // Should not throw and should not create state for a non-existent sheet.
        setYColWidth(doc, 'missing', 1, 200)
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        expect(sheetsMap.get('missing')).toBeUndefined()
    })

    it('runs in a single transaction', () => {
        const doc = new Y.Doc()
        bootstrapSheet(doc)
        let updates = 0
        doc.on('update', () => {
            updates++
        })
        setYColWidth(doc, 'sheet1', 1, 200)
        expect(updates).toBe(1)
    })
})

describe('readColWidthsFromMeta', () => {
    it('returns undefined when no entry is present', () => {
        const doc = new Y.Doc()
        const meta = bootstrapSheet(doc)
        expect(readColWidthsFromMeta(meta)).toBeUndefined()
    })

    it('snapshots the Y.Map into a plain Record', () => {
        const doc = new Y.Doc()
        const meta = bootstrapSheet(doc)
        setYColWidth(doc, 'sheet1', 1, 150)
        setYColWidth(doc, 'sheet1', 4, 220)
        const widths = readColWidthsFromMeta(meta)
        expect(widths).toEqual({ 1: 150, 4: 220 })
    })

    it('skips non-numeric values defensively', () => {
        const doc = new Y.Doc()
        const meta = bootstrapSheet(doc)
        const widths = new Y.Map<unknown>()
        widths.set('1', 200)
        widths.set('2', 'not a number')
        meta.set(COL_WIDTHS_KEY, widths)
        expect(readColWidthsFromMeta(meta)).toEqual({ 1: 200 })
    })
})

describe('buildColOffsets', () => {
    it('produces a uniform-width prefix sum when no overrides', () => {
        const offsets = buildColOffsets(3, undefined)
        expect(Array.from(offsets)).toEqual([0, 96, 192, 288])
    })

    it('honors per-column overrides', () => {
        const offsets = buildColOffsets(4, { 2: 50, 3: 200 })
        expect(Array.from(offsets)).toEqual([0, 96, 146, 346, 442])
    })

    it('handles zero-width (hidden) columns', () => {
        const offsets = buildColOffsets(3, { 2: 0 })
        expect(Array.from(offsets)).toEqual([0, 96, 96, 192])
    })
})

describe('firstColAtOffset / lastColAtOffset', () => {
    it('locates the column for any x at uniform widths', () => {
        const offsets = buildColOffsets(5, undefined) // [0,96,192,288,384,480]
        expect(firstColAtOffset(offsets, 0)).toBe(1)
        expect(firstColAtOffset(offsets, 95)).toBe(1)
        expect(firstColAtOffset(offsets, 96)).toBe(2)
        expect(firstColAtOffset(offsets, 200)).toBe(3)
        expect(firstColAtOffset(offsets, 10_000)).toBe(5)
    })

    it('locates the column for variable widths', () => {
        const offsets = buildColOffsets(4, { 2: 200 }) // [0,96,296,392,488]
        expect(firstColAtOffset(offsets, 100)).toBe(2)
        expect(firstColAtOffset(offsets, 295)).toBe(2)
        expect(firstColAtOffset(offsets, 296)).toBe(3)
    })

    it('lastColAtOffset reports the last column intersecting x', () => {
        const offsets = buildColOffsets(5, undefined)
        expect(lastColAtOffset(offsets, 0)).toBe(1)
        expect(lastColAtOffset(offsets, 100)).toBe(2)
        expect(lastColAtOffset(offsets, 96)).toBe(1)
        expect(lastColAtOffset(offsets, 480)).toBe(5)
    })
})

describe('measureWidestDisplay', () => {
    it('returns 0 for a column with no cells', () => {
        const doc = new Y.Doc()
        bootstrapSheet(doc)
        expect(measureWidestDisplay(doc, 'sheet1', 1, s => s.length)).toBe(0)
    })

    it('returns the maximum measured width across cells in the column', () => {
        const doc = new Y.Doc()
        bootstrapSheet(doc)
        const cells = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const c1 = new Y.Map<unknown>()
        c1.set('display', 'short')
        cells.set(yCellKey('sheet1', 1, 1), c1)
        const c2 = new Y.Map<unknown>()
        c2.set('display', 'a much longer string')
        cells.set(yCellKey('sheet1', 2, 1), c2)
        // A different column shouldn't influence the answer.
        const other = new Y.Map<unknown>()
        other.set('display', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
        cells.set(yCellKey('sheet1', 1, 2), other)

        const widest = measureWidestDisplay(doc, 'sheet1', 1, s => s.length)
        expect(widest).toBe('a much longer string'.length)
    })
})

describe('readRowHeight', () => {
    it('returns DEFAULT_ROW_HEIGHT for missing entries', () => {
        expect(readRowHeight(undefined, 1)).toBe(DEFAULT_ROW_HEIGHT)
        expect(readRowHeight({}, 1)).toBe(DEFAULT_ROW_HEIGHT)
        expect(readRowHeight({ 2: 60 }, 1)).toBe(DEFAULT_ROW_HEIGHT)
    })

    it('returns stored height for present entries', () => {
        expect(readRowHeight({ 1: 60 }, 1)).toBe(60)
        expect(readRowHeight({ 1: 0 }, 1)).toBe(0)
    })
})

describe('clampRowHeight', () => {
    it('snaps narrow heights to zero', () => {
        expect(clampRowHeight(0)).toBe(0)
        expect(clampRowHeight(ROW_HIDE_SNAP_THRESHOLD - 1)).toBe(0)
    })

    it('preserves heights above the snap threshold', () => {
        expect(clampRowHeight(ROW_HIDE_SNAP_THRESHOLD)).toBe(ROW_HIDE_SNAP_THRESHOLD)
        expect(clampRowHeight(60)).toBe(60)
    })

    it('caps at MAX_ROW_HEIGHT', () => {
        expect(clampRowHeight(MAX_ROW_HEIGHT + 100)).toBe(MAX_ROW_HEIGHT)
    })

    it('falls back to default for non-finite heights', () => {
        expect(clampRowHeight(Number.NaN)).toBe(DEFAULT_ROW_HEIGHT)
        expect(clampRowHeight(Number.POSITIVE_INFINITY)).toBe(DEFAULT_ROW_HEIGHT)
    })
})

describe('setYRowHeight', () => {
    it('lazily creates the rowHeights map on first write', () => {
        const doc = new Y.Doc()
        const meta = bootstrapSheet(doc)
        expect(meta.get(ROW_HEIGHTS_KEY)).toBeUndefined()
        setYRowHeight(doc, 'sheet1', 3, 60)
        const heights = meta.get(ROW_HEIGHTS_KEY)
        expect(heights).toBeInstanceOf(Y.Map)
        expect((heights as Y.Map<number>).get('3')).toBe(60)
    })

    it('writing the default height deletes the entry', () => {
        const doc = new Y.Doc()
        const meta = bootstrapSheet(doc)
        setYRowHeight(doc, 'sheet1', 3, 60)
        setYRowHeight(doc, 'sheet1', 3, DEFAULT_ROW_HEIGHT)
        const heights = meta.get(ROW_HEIGHTS_KEY) as Y.Map<number> | undefined
        expect(heights?.has('3')).toBe(false)
    })

    it('clamps height through the standard rules', () => {
        const doc = new Y.Doc()
        const meta = bootstrapSheet(doc)
        setYRowHeight(doc, 'sheet1', 1, MAX_ROW_HEIGHT + 500)
        setYRowHeight(doc, 'sheet1', 2, 3)
        const heights = meta.get(ROW_HEIGHTS_KEY) as Y.Map<number>
        expect(heights.get('1')).toBe(MAX_ROW_HEIGHT)
        expect(heights.get('2')).toBe(0)
    })

    it('runs in a single transaction', () => {
        const doc = new Y.Doc()
        bootstrapSheet(doc)
        let updates = 0
        doc.on('update', () => {
            updates++
        })
        setYRowHeight(doc, 'sheet1', 1, 60)
        expect(updates).toBe(1)
    })
})

describe('readRowHeightsFromMeta', () => {
    it('returns undefined when no entry is present', () => {
        const doc = new Y.Doc()
        const meta = bootstrapSheet(doc)
        expect(readRowHeightsFromMeta(meta)).toBeUndefined()
    })

    it('snapshots the Y.Map into a plain Record', () => {
        const doc = new Y.Doc()
        const meta = bootstrapSheet(doc)
        setYRowHeight(doc, 'sheet1', 1, 50)
        setYRowHeight(doc, 'sheet1', 4, 80)
        expect(readRowHeightsFromMeta(meta)).toEqual({ 1: 50, 4: 80 })
    })

    it('skips non-numeric values defensively', () => {
        const doc = new Y.Doc()
        const meta = bootstrapSheet(doc)
        const heights = new Y.Map<unknown>()
        heights.set('1', 60)
        heights.set('2', 'not a number')
        meta.set(ROW_HEIGHTS_KEY, heights)
        expect(readRowHeightsFromMeta(meta)).toEqual({ 1: 60 })
    })
})

describe('buildRowOffsets', () => {
    it('produces a uniform-height prefix sum when no overrides', () => {
        const offsets = buildRowOffsets(3, undefined)
        expect(Array.from(offsets)).toEqual([0, 28, 56, 84])
    })

    it('honors per-row overrides', () => {
        const offsets = buildRowOffsets(4, { 2: 50, 3: 100 })
        expect(Array.from(offsets)).toEqual([0, 28, 78, 178, 206])
    })

    it('handles zero-height (hidden) rows', () => {
        const offsets = buildRowOffsets(3, { 2: 0 })
        expect(Array.from(offsets)).toEqual([0, 28, 28, 56])
    })
})

describe('firstRowAtOffset / lastRowAtOffset', () => {
    it('locates the row for any y at uniform heights', () => {
        const offsets = buildRowOffsets(5, undefined) // [0,28,56,84,112,140]
        expect(firstRowAtOffset(offsets, 0)).toBe(1)
        expect(firstRowAtOffset(offsets, 27)).toBe(1)
        expect(firstRowAtOffset(offsets, 28)).toBe(2)
        expect(firstRowAtOffset(offsets, 60)).toBe(3)
        expect(firstRowAtOffset(offsets, 10_000)).toBe(5)
    })

    it('locates the row for variable heights', () => {
        const offsets = buildRowOffsets(4, { 2: 100 }) // [0,28,128,156,184]
        expect(firstRowAtOffset(offsets, 30)).toBe(2)
        expect(firstRowAtOffset(offsets, 127)).toBe(2)
        expect(firstRowAtOffset(offsets, 128)).toBe(3)
    })

    it('lastRowAtOffset reports the last row intersecting y', () => {
        const offsets = buildRowOffsets(5, undefined)
        expect(lastRowAtOffset(offsets, 0)).toBe(1)
        expect(lastRowAtOffset(offsets, 30)).toBe(2)
        expect(lastRowAtOffset(offsets, 28)).toBe(1)
        expect(lastRowAtOffset(offsets, 140)).toBe(5)
    })
})

describe('autosizeColumnWidth', () => {
    it('returns DEFAULT_COL_WIDTH for an empty column', () => {
        const doc = new Y.Doc()
        bootstrapSheet(doc)
        const w = autosizeColumnWidth(doc, 'sheet1', 1, () => 0)
        expect(w).toBe(DEFAULT_COL_WIDTH)
    })

    it('applies padding and clamps against MAX_COL_WIDTH', () => {
        const doc = new Y.Doc()
        bootstrapSheet(doc)
        const cells = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const c1 = new Y.Map<unknown>()
        c1.set('display', 'x')
        cells.set(yCellKey('sheet1', 1, 1), c1)
        const w = autosizeColumnWidth(doc, 'sheet1', 1, () => 50)
        expect(w).toBe(50 + 24) // AUTOSIZE_PADDING

        const c2 = new Y.Map<unknown>()
        c2.set('display', 'huge')
        cells.set(yCellKey('sheet1', 2, 1), c2)
        const big = autosizeColumnWidth(doc, 'sheet1', 1, () => MAX_COL_WIDTH + 999)
        expect(big).toBe(MAX_COL_WIDTH)
    })
})
