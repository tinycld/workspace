import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCell, setYCellStyle, setYCellTyped } from '../tinycld/calc/hooks/use-y-cell'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP, readYCell, STYLE_KEY } from '../tinycld/calc/lib/y-doc-bootstrap'

// useYCell ties a React component to one Y.Map cell entry via
// useSyncExternalStore. Mounting the hook here would require a React
// renderer and our vitest setup mocks react-native heavily, so these
// tests exercise the underlying data-flow contract directly:
//
//   - setYCell writes to the Y.Doc atomically
//   - empty input deletes the cell
//   - cellsMap.observe fires once per setYCell call (so the hook
//     re-renders the right number of times in production)
//   - changes to *other* cells do NOT fire observers for the watched key
//
// The last point is the crucial perf invariant: with hundreds of cells
// visible, only the changed cell's hook should re-render.

describe('setYCell + cellsMap observe', () => {
    it('writes a cell as a nested Y.Map with kind=string and raw/display', () => {
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 2, 3, 'hello')
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = cellsMap.get(yCellKey('sheet1', 2, 3))
        expect(cell?.get('kind')).toBe('string')
        expect(cell?.get('raw')).toBe('hello')
        expect(cell?.get('display')).toBe('hello')
    })

    it('empty input deletes the cell', () => {
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 2, 3, 'hello')
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        expect(cellsMap.has(yCellKey('sheet1', 2, 3))).toBe(true)

        setYCell(doc, 'sheet1', 2, 3, '')
        expect(cellsMap.has(yCellKey('sheet1', 2, 3))).toBe(false)
    })

    it('parent observer fires on insert; subsequent edits observed via the nested cell map', () => {
        // setYCell mutates the existing cell Y.Map in place rather
        // than replacing it (so style/font/etc. survive value edits).
        // The Grid hook (useYCell) handles this by attaching a deep
        // observer on the nested cell map; the parent CELLS_MAP only
        // sees insert / delete events.
        const doc = new Y.Doc()
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const watchedKey = yCellKey('sheet1', 1, 1)
        let parentFires = 0
        cellsMap.observe(event => {
            if (event.keysChanged.has(watchedKey)) parentFires++
        })

        setYCell(doc, 'sheet1', 1, 1, 'A1')
        expect(parentFires).toBe(1)

        // Re-edit the same cell: parent observer does NOT fire again —
        // the change is on the nested map's `raw`/`display` keys.
        let nestedFires = 0
        cellsMap.get(watchedKey)?.observe(() => {
            nestedFires++
        })
        setYCell(doc, 'sheet1', 1, 1, 'A1-edited')
        expect(parentFires).toBe(1)
        expect(nestedFires).toBe(1)
    })

    it('observer does NOT fire for the watched key when an unrelated cell changes', () => {
        const doc = new Y.Doc()
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const watchedKey = yCellKey('sheet1', 1, 1)
        let firedForWatched = 0
        cellsMap.observe(event => {
            if (event.keysChanged.has(watchedKey)) firedForWatched++
        })

        setYCell(doc, 'sheet1', 5, 5, 'unrelated')
        setYCell(doc, 'sheet1', 1, 2, 'sibling-row')
        setYCell(doc, 'sheet2', 1, 1, 'different-sheet')

        expect(firedForWatched).toBe(0)
    })

    it('one setYCell produces exactly one Yjs update (for clean undo grouping)', () => {
        const doc = new Y.Doc()
        let updates = 0
        doc.on('update', () => {
            updates++
        })
        setYCell(doc, 'sheet1', 1, 1, 'one')
        expect(updates).toBe(1)
    })

    it('setYCell on an existing styled cell preserves the style entry', () => {
        // Regression: setYCell must mutate raw/display in place rather
        // than replacing the whole cell Y.Map, otherwise typing into a
        // bolded cell silently drops the bold.
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 1, 1, 'before')
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true } })
        setYCell(doc, 'sheet1', 1, 1, 'after')

        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = cellsMap.get(yCellKey('sheet1', 1, 1))
        expect(cell?.get('raw')).toBe('after')
        const style = cell?.get(STYLE_KEY) as Y.Map<unknown> | undefined
        const font = style?.get('font') as Y.Map<unknown> | undefined
        expect(font?.get('bold')).toBe(true)
    })
})

describe('readYCell', () => {
    it('reads a typed string cell', () => {
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 1, 1, 'hello')
        const cell = doc.getMap<Y.Map<unknown>>(CELLS_MAP).get(yCellKey('sheet1', 1, 1))
        const snap = readYCell(cell as Y.Map<unknown>)
        expect(snap.kind).toBe('string')
        expect(snap.raw).toBe('hello')
        expect(snap.display).toBe('hello')
        expect(snap.formula).toBeUndefined()
    })

    it('reads a number cell back as a number', () => {
        const doc = new Y.Doc()
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = new Y.Map<unknown>()
        cell.set('kind', 'number')
        cell.set('raw', 42)
        cell.set('display', '42')
        cellsMap.set(yCellKey('sheet1', 1, 1), cell)

        const snap = readYCell(cell)
        expect(snap.kind).toBe('number')
        expect(snap.raw).toBe(42)
    })

    it('reads a boolean cell back as a boolean', () => {
        const doc = new Y.Doc()
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = new Y.Map<unknown>()
        cell.set('kind', 'boolean')
        cell.set('raw', true)
        cell.set('display', 'TRUE')
        cellsMap.set(yCellKey('sheet1', 1, 1), cell)

        expect(readYCell(cell).kind).toBe('boolean')
        expect(readYCell(cell).raw).toBe(true)
    })

    it('reads a formula cell with cached value and formula text', () => {
        const doc = new Y.Doc()
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = new Y.Map<unknown>()
        cell.set('kind', 'formula')
        cell.set('raw', 99)
        cell.set('display', '99')
        cell.set('formula', 'A1+A2')
        cellsMap.set(yCellKey('sheet1', 1, 1), cell)

        const snap = readYCell(cell)
        expect(snap.kind).toBe('formula')
        expect(snap.raw).toBe(99)
        expect(snap.formula).toBe('A1+A2')
    })

    it('legacy cell without a kind key reads as kind=string with stringified raw', () => {
        // Simulates a Y.Doc written by an older client that didn't know
        // about the typed-cell schema. raw is a string; kind is absent.
        const doc = new Y.Doc()
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = new Y.Map<unknown>()
        cell.set('raw', 'legacy text')
        cell.set('display', 'legacy text')
        cellsMap.set(yCellKey('sheet1', 1, 1), cell)

        const snap = readYCell(cell)
        expect(snap.kind).toBe('string')
        expect(snap.raw).toBe('legacy text')
        expect(snap.display).toBe('legacy text')
    })

    it('legacy cell whose raw is a non-string scalar coerces to string', () => {
        // Defensive: an even-older client may have written numeric raw
        // values without a kind tag. Read-side coercion to string keeps
        // the rendered display matching what was visible before.
        const doc = new Y.Doc()
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = new Y.Map<unknown>()
        cell.set('raw', 42)
        cell.set('display', '42')
        cellsMap.set(yCellKey('sheet1', 1, 1), cell)

        const snap = readYCell(cell)
        expect(snap.kind).toBe('string')
        expect(snap.raw).toBe('42')
    })
})

describe('setYCellStyle', () => {
    it('writes a partial style under cell.style as nested Y.Maps', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true } })

        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = cellsMap.get(yCellKey('sheet1', 1, 1))
        expect(cell).toBeDefined()
        const style = cell?.get(STYLE_KEY) as Y.Map<unknown> | undefined
        expect(style).toBeDefined()
        const font = style?.get('font') as Y.Map<unknown> | undefined
        expect(font?.get('bold')).toBe(true)
    })

    it('deep-merges across calls — adding italic does not drop bold', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true } })
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { italic: true } })

        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = cellsMap.get(yCellKey('sheet1', 1, 1))
        const style = cell?.get(STYLE_KEY) as Y.Map<unknown> | undefined
        const font = style?.get('font') as Y.Map<unknown> | undefined
        expect(font?.get('bold')).toBe(true)
        expect(font?.get('italic')).toBe(true)
    })

    it('overwriting a key yields the new value', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true } })
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: false } })

        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = cellsMap.get(yCellKey('sheet1', 1, 1))
        const style = cell?.get(STYLE_KEY) as Y.Map<unknown> | undefined
        const font = style?.get('font') as Y.Map<unknown> | undefined
        expect(font?.get('bold')).toBe(false)
    })

    it('creates the cell Y.Map on demand when style is set on an empty cell', () => {
        const doc = new Y.Doc()
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        expect(cellsMap.has(yCellKey('sheet1', 1, 1))).toBe(false)
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true } })
        expect(cellsMap.has(yCellKey('sheet1', 1, 1))).toBe(true)
    })
})

describe('setYCellTyped + inferred commit path', () => {
    it('typing a number stores kind=number with a numeric raw', () => {
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 1, 1, '42')
        const snap = readYCell(
            doc.getMap<Y.Map<unknown>>(CELLS_MAP).get(yCellKey('sheet1', 1, 1)) as Y.Map<unknown>
        )
        expect(snap.kind).toBe('number')
        expect(snap.raw).toBe(42)
        expect(snap.display).toBe('42')
    })

    it('typing TRUE stores kind=boolean', () => {
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 1, 1, 'TRUE')
        const snap = readYCell(
            doc.getMap<Y.Map<unknown>>(CELLS_MAP).get(yCellKey('sheet1', 1, 1)) as Y.Map<unknown>
        )
        expect(snap.kind).toBe('boolean')
        expect(snap.raw).toBe(true)
    })

    it('typing an ISO date stores kind=date with the ISO string raw', () => {
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 1, 1, '2024-01-15')
        const snap = readYCell(
            doc.getMap<Y.Map<unknown>>(CELLS_MAP).get(yCellKey('sheet1', 1, 1)) as Y.Map<unknown>
        )
        expect(snap.kind).toBe('date')
        expect(snap.raw).toBe('2024-01-15')
    })

    it('typing =A1+B1 stores kind=formula with the formula text', () => {
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 1, 1, '=A1+B1')
        const cell = doc.getMap<Y.Map<unknown>>(CELLS_MAP).get(yCellKey('sheet1', 1, 1))
        expect(cell?.get('kind')).toBe('formula')
        expect(cell?.get('formula')).toBe('=A1+B1')
        // Formula raw stays null until an evaluator caches a value.
        expect(cell?.get('raw')).toBeNull()
    })

    it("typing '42 forces a string kind (the apostrophe convention)", () => {
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 1, 1, "'42")
        const snap = readYCell(
            doc.getMap<Y.Map<unknown>>(CELLS_MAP).get(yCellKey('sheet1', 1, 1)) as Y.Map<unknown>
        )
        expect(snap.kind).toBe('string')
        expect(snap.raw).toBe('42')
    })

    it('switching kind on an existing cell updates kind and clears stale formula', () => {
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 1, 1, '=A1+B1')
        expect(
            doc
                .getMap<Y.Map<unknown>>(CELLS_MAP)
                .get(yCellKey('sheet1', 1, 1))
                ?.get('formula')
        ).toBe('=A1+B1')

        setYCell(doc, 'sheet1', 1, 1, '42')
        const cell = doc.getMap<Y.Map<unknown>>(CELLS_MAP).get(yCellKey('sheet1', 1, 1))
        expect(cell?.get('kind')).toBe('number')
        expect(cell?.has('formula')).toBe(false)
    })

    it('setYCellTyped accepts a pre-inferred input directly', () => {
        const doc = new Y.Doc()
        setYCellTyped(doc, 'sheet1', 2, 3, {
            kind: 'number',
            raw: 99,
            display: '99',
        })
        const cell = doc.getMap<Y.Map<unknown>>(CELLS_MAP).get(yCellKey('sheet1', 2, 3))
        expect(cell?.get('kind')).toBe('number')
        expect(cell?.get('raw')).toBe(99)
    })
})
