import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { CellRange } from '../tinycld/calc/hooks/grid-store'
import { deleteYCell, setYCell } from '../tinycld/calc/hooks/use-y-cell'
import { applyPayloadToDoc } from '../tinycld/calc/lib/clipboard/deserialize'
import { serializeRange } from '../tinycld/calc/lib/clipboard/serialize'
import { forEachCellInRange } from '../tinycld/calc/lib/selection-range'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP, readYCell } from '../tinycld/calc/lib/y-doc-bootstrap'

// The single-undo discipline for cut+paste is the load-bearing CRDT
// invariant of the clipboard feature: the source-clear and the
// destination-write must collapse to one entry on the undo stack so
// the user's Cmd+Z reverses the whole operation. The implementation
// relies on Yjs flattening nested doc.transact calls when origins
// match — these tests assert that contract holds end-to-end.
//
// We replicate the exact wrapping use-clipboard.applyClipboardPaste
// performs (outer doc.transact + LOCAL_ORIGIN around source-delete +
// applyPayloadToDoc). Importing the hook directly would pull in
// react-native via its Platform check; the invariant under test is
// the Yjs transact-flattening contract, not the hook plumbing.

function cutAndPaste(
    doc: Y.Doc,
    sheetId: string,
    sourceRange: CellRange,
    destAnchor: { row: number; col: number }
) {
    const payload = serializeRange(doc, sheetId, sourceRange)
    doc.transact(() => {
        forEachCellInRange(sourceRange, (row, col) => {
            deleteYCell(doc, sheetId, row, col)
        })
        applyPayloadToDoc(doc, sheetId, payload, { mode: 'all', destAnchor })
    }, LOCAL_ORIGIN)
}

function newManager(doc: Y.Doc): Y.UndoManager {
    return new Y.UndoManager([doc.getMap(CELLS_MAP)], {
        captureTimeout: 0,
        trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    })
}

function readCell(doc: Y.Doc, sheetId: string, row: number, col: number) {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    return cell ? readYCell(cell) : null
}

describe('cut + paste single-undo discipline', () => {
    it('source-clear + dest-write collapse to one undo step', () => {
        const doc = new Y.Doc()
        // Seed source range A1:A3.
        setYCell(doc, 'sheet1', 1, 1, 'a')
        setYCell(doc, 'sheet1', 2, 1, 'b')
        setYCell(doc, 'sheet1', 3, 1, 'c')

        // Attach the manager AFTER seeding so only the cut+paste
        // operation enters the undo stack.
        const manager = newManager(doc)

        cutAndPaste(
            doc,
            'sheet1',
            { startRow: 1, endRow: 3, startCol: 1, endCol: 1 },
            { row: 5, col: 5 }
        )

        // The whole cut+paste — three source deletes plus three
        // destination writes — must be a single undo step.
        expect(manager.undoStack.length).toBe(1)

        // Source cleared, destination filled.
        expect(readCell(doc, 'sheet1', 1, 1)).toBeNull()
        expect(readCell(doc, 'sheet1', 2, 1)).toBeNull()
        expect(readCell(doc, 'sheet1', 3, 1)).toBeNull()
        expect(readCell(doc, 'sheet1', 5, 5)?.raw).toBe('a')
        expect(readCell(doc, 'sheet1', 6, 5)?.raw).toBe('b')
        expect(readCell(doc, 'sheet1', 7, 5)?.raw).toBe('c')

        // One undo reverses the entire operation.
        manager.undo()
        expect(readCell(doc, 'sheet1', 1, 1)?.raw).toBe('a')
        expect(readCell(doc, 'sheet1', 2, 1)?.raw).toBe('b')
        expect(readCell(doc, 'sheet1', 3, 1)?.raw).toBe('c')
        expect(readCell(doc, 'sheet1', 5, 5)).toBeNull()
        expect(readCell(doc, 'sheet1', 6, 5)).toBeNull()
        expect(readCell(doc, 'sheet1', 7, 5)).toBeNull()
    })

    it('cut+paste with a formula rewrites refs across the move', () => {
        // Cover regression where a cut+paste with a formula must
        // both produce one undo step AND apply the (dest-source)
        // delta to the formula text.
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 1, 1, '10')
        setYCell(doc, 'sheet1', 2, 1, '=A1+1')

        const manager = newManager(doc)

        cutAndPaste(
            doc,
            'sheet1',
            { startRow: 1, endRow: 2, startCol: 1, endCol: 1 },
            { row: 5, col: 3 }
        )

        expect(manager.undoStack.length).toBe(1)
        // =A1+1 with delta (+4, +2) → =C5+1
        expect(readCell(doc, 'sheet1', 6, 3)).toMatchObject({
            kind: 'formula',
            formula: '=C5+1',
        })
        expect(readCell(doc, 'sheet1', 1, 1)).toBeNull()
        expect(readCell(doc, 'sheet1', 2, 1)).toBeNull()
    })
})
