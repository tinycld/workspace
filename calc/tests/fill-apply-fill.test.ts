import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
    deleteYCell,
    setYCell,
    setYCellStyle,
    setYCellTyped,
} from '../tinycld/calc/hooks/use-y-cell'
import { applyFill } from '../tinycld/calc/lib/fill/apply-fill'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP, readYCell } from '../tinycld/calc/lib/y-doc-bootstrap'

// applyFill contract: read source cells from the Y.Doc, run series
// detection per column-or-row, project beyond the source, and write
// every dest cell inside one LOCAL_ORIGIN transaction (so undo sees
// the whole fill as one Cmd+Z step). Empty projected cells delete the
// destination; formula cells get per-cell rewrite via rewriteFormula.

const SHEET = 'sheet1'

function newManager(doc: Y.Doc): Y.UndoManager {
    return new Y.UndoManager([doc.getMap(CELLS_MAP)], {
        captureTimeout: 0,
        trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    })
}

function readCell(doc: Y.Doc, row: number, col: number) {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(SHEET, row, col))
    return cell ? readYCell(cell) : null
}

describe('applyFill — linear numeric series', () => {
    it('fills 1,2 down 4 more rows → 3,4,5,6', () => {
        const doc = new Y.Doc()
        setYCell(doc, SHEET, 1, 1, '1')
        setYCell(doc, SHEET, 2, 1, '2')

        applyFill({
            doc,
            sheetId: SHEET,
            sourceRange: { startRow: 1, endRow: 2, startCol: 1, endCol: 1 },
            destRange: { startRow: 1, endRow: 6, startCol: 1, endCol: 1 },
            direction: 'down',
        })

        expect(readCell(doc, 3, 1)).toMatchObject({ kind: 'number', raw: 3 })
        expect(readCell(doc, 4, 1)).toMatchObject({ kind: 'number', raw: 4 })
        expect(readCell(doc, 5, 1)).toMatchObject({ kind: 'number', raw: 5 })
        expect(readCell(doc, 6, 1)).toMatchObject({ kind: 'number', raw: 6 })
        // Source unchanged.
        expect(readCell(doc, 1, 1)).toMatchObject({ kind: 'number', raw: 1 })
        expect(readCell(doc, 2, 1)).toMatchObject({ kind: 'number', raw: 2 })
    })

    it('fills 1,2 right 3 cols → 3,4,5', () => {
        const doc = new Y.Doc()
        setYCell(doc, SHEET, 1, 1, '1')
        setYCell(doc, SHEET, 1, 2, '2')

        applyFill({
            doc,
            sheetId: SHEET,
            sourceRange: { startRow: 1, endRow: 1, startCol: 1, endCol: 2 },
            destRange: { startRow: 1, endRow: 1, startCol: 1, endCol: 5 },
            direction: 'right',
        })

        expect(readCell(doc, 1, 3)).toMatchObject({ kind: 'number', raw: 3 })
        expect(readCell(doc, 1, 4)).toMatchObject({ kind: 'number', raw: 4 })
        expect(readCell(doc, 1, 5)).toMatchObject({ kind: 'number', raw: 5 })
    })
})

describe('applyFill — formula rewrite', () => {
    it('=A1 in B2 down 2 → =A2 in B3, =A3 in B4', () => {
        const doc = new Y.Doc()
        setYCellTyped(doc, SHEET, 2, 2, {
            kind: 'formula',
            raw: null,
            display: '=A1',
            formula: '=A1',
        })

        applyFill({
            doc,
            sheetId: SHEET,
            sourceRange: { startRow: 2, endRow: 2, startCol: 2, endCol: 2 },
            destRange: { startRow: 2, endRow: 4, startCol: 2, endCol: 2 },
            direction: 'down',
        })

        expect(readCell(doc, 3, 2)).toMatchObject({ kind: 'formula', formula: '=A2' })
        expect(readCell(doc, 4, 2)).toMatchObject({ kind: 'formula', formula: '=A3' })
    })

    it('=$A$1 in B2 down 2 → absolute refs pinned', () => {
        const doc = new Y.Doc()
        setYCellTyped(doc, SHEET, 2, 2, {
            kind: 'formula',
            raw: null,
            display: '=$A$1',
            formula: '=$A$1',
        })

        applyFill({
            doc,
            sheetId: SHEET,
            sourceRange: { startRow: 2, endRow: 2, startCol: 2, endCol: 2 },
            destRange: { startRow: 2, endRow: 4, startCol: 2, endCol: 2 },
            direction: 'down',
        })

        expect(readCell(doc, 3, 2)).toMatchObject({ kind: 'formula', formula: '=$A$1' })
        expect(readCell(doc, 4, 2)).toMatchObject({ kind: 'formula', formula: '=$A$1' })
    })

    it('=SUM(A1:A2) in B2 down 1 → =SUM(A2:A3) in B3 (range rewrite)', () => {
        const doc = new Y.Doc()
        setYCellTyped(doc, SHEET, 2, 2, {
            kind: 'formula',
            raw: null,
            display: '=SUM(A1:A2)',
            formula: '=SUM(A1:A2)',
        })

        applyFill({
            doc,
            sheetId: SHEET,
            sourceRange: { startRow: 2, endRow: 2, startCol: 2, endCol: 2 },
            destRange: { startRow: 2, endRow: 3, startCol: 2, endCol: 2 },
            direction: 'down',
        })

        expect(readCell(doc, 3, 2)).toMatchObject({
            kind: 'formula',
            formula: '=SUM(A2:A3)',
        })
    })
})

describe('applyFill — style propagation', () => {
    it('bold "Foo" in A1 down 2 → "Foo" with bold in A2, A3', () => {
        const doc = new Y.Doc()
        setYCell(doc, SHEET, 1, 1, 'Foo')
        setYCellStyle(doc, SHEET, 1, 1, { font: { bold: true } })

        applyFill({
            doc,
            sheetId: SHEET,
            sourceRange: { startRow: 1, endRow: 1, startCol: 1, endCol: 1 },
            destRange: { startRow: 1, endRow: 3, startCol: 1, endCol: 1 },
            direction: 'down',
        })

        // Single-cell string source = copy.
        expect(readCell(doc, 2, 1)).toMatchObject({
            kind: 'string',
            raw: 'Foo',
            style: { font: { bold: true } },
        })
        expect(readCell(doc, 3, 1)).toMatchObject({
            kind: 'string',
            raw: 'Foo',
            style: { font: { bold: true } },
        })
    })

    it('cycles style alongside source for multi-cell copy fallback', () => {
        // Two booleans can't form a linear series → copy fallback.
        // Style cycles modulo source length too.
        const doc = new Y.Doc()
        setYCell(doc, SHEET, 1, 1, 'TRUE')
        setYCellStyle(doc, SHEET, 1, 1, { font: { bold: true } })
        setYCell(doc, SHEET, 2, 1, 'FALSE')
        // Row 2 has no style.

        applyFill({
            doc,
            sheetId: SHEET,
            sourceRange: { startRow: 1, endRow: 2, startCol: 1, endCol: 1 },
            destRange: { startRow: 1, endRow: 4, startCol: 1, endCol: 1 },
            direction: 'down',
        })

        // Step 2 cycles back to source[0] (bold TRUE).
        expect(readCell(doc, 3, 1)).toMatchObject({
            kind: 'boolean',
            raw: true,
            style: { font: { bold: true } },
        })
        // Step 3 cycles to source[1] (FALSE, no style).
        const step3 = readCell(doc, 4, 1)
        expect(step3).toMatchObject({ kind: 'boolean', raw: false })
        expect(step3?.style).toBeUndefined()
    })
})

describe('applyFill — mixed-kind copy fallback', () => {
    it('mixed source A1=1 B1="x" → cell-by-cell copy, no error', () => {
        const doc = new Y.Doc()
        setYCell(doc, SHEET, 1, 1, '1')
        setYCell(doc, SHEET, 1, 2, 'x')

        applyFill({
            doc,
            sheetId: SHEET,
            sourceRange: { startRow: 1, endRow: 1, startCol: 1, endCol: 2 },
            destRange: { startRow: 1, endRow: 1, startCol: 1, endCol: 6 },
            direction: 'right',
        })

        // detectSeries sees mixed kinds → 'copy'. Each row's series is
        // separate, but here we have one row; the row-cell array is
        // [num(1), str("x")] — mixed → copy → cycles modulo source.
        // Step 2 → source[0] = 1.
        expect(readCell(doc, 1, 3)).toMatchObject({ kind: 'number', raw: 1 })
        // Step 3 → source[1] = "x".
        expect(readCell(doc, 1, 4)).toMatchObject({ kind: 'string', raw: 'x' })
        expect(readCell(doc, 1, 5)).toMatchObject({ kind: 'number', raw: 1 })
        expect(readCell(doc, 1, 6)).toMatchObject({ kind: 'string', raw: 'x' })
    })
})

describe('applyFill — empty source replays holes', () => {
    it('empty source cell in middle → fill replays the hole (deletes dest)', () => {
        // Source has a string-numeric pattern with a blank in the middle.
        // detectSeries falls back to 'copy' since the blank is mixed-kind
        // adjacent to numbers. The cycle including the blank should
        // delete the destination at the blank's cycle position.
        const doc = new Y.Doc()
        setYCell(doc, SHEET, 1, 1, 'A')
        // Row 2 left empty intentionally.
        setYCell(doc, SHEET, 3, 1, 'C')

        // Pre-populate destinations to verify they get deleted.
        setYCell(doc, SHEET, 4, 1, 'preexisting1')
        setYCell(doc, SHEET, 5, 1, 'preexisting2')
        setYCell(doc, SHEET, 6, 1, 'preexisting3')

        applyFill({
            doc,
            sheetId: SHEET,
            sourceRange: { startRow: 1, endRow: 3, startCol: 1, endCol: 1 },
            destRange: { startRow: 1, endRow: 6, startCol: 1, endCol: 1 },
            direction: 'down',
        })

        // Source cycle: ["A", "", "C"]. Step 3 → source[0] = "A",
        // step 4 → source[1] = "" (deletes), step 5 → source[2] = "C".
        expect(readCell(doc, 4, 1)).toMatchObject({ kind: 'string', raw: 'A' })
        expect(readCell(doc, 5, 1)).toBeNull()
        expect(readCell(doc, 6, 1)).toMatchObject({ kind: 'string', raw: 'C' })
    })
})

describe('applyFill — single-undo discipline', () => {
    it('one fill = one Cmd+Z reverts every dest cell', () => {
        const doc = new Y.Doc()
        // Seed source with bare doc.transact (no origin) so the manager
        // doesn't capture seeding.
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        doc.transact(() => {
            for (const [row, value] of [[1, 1], [2, 2]] as const) {
                const cell = new Y.Map<unknown>()
                cell.set('kind', 'number')
                cell.set('raw', value)
                cell.set('display', String(value))
                cellsMap.set(yCellKey(SHEET, row, 1), cell)
            }
        })

        const manager = newManager(doc)

        applyFill({
            doc,
            sheetId: SHEET,
            sourceRange: { startRow: 1, endRow: 2, startCol: 1, endCol: 1 },
            destRange: { startRow: 1, endRow: 6, startCol: 1, endCol: 1 },
            direction: 'down',
        })

        // 4 destination cells (rows 3-6), all written in one undo step.
        expect(manager.undoStack.length).toBe(1)
        expect(readCell(doc, 6, 1)).toMatchObject({ kind: 'number', raw: 6 })

        manager.undo()
        expect(readCell(doc, 3, 1)).toBeNull()
        expect(readCell(doc, 4, 1)).toBeNull()
        expect(readCell(doc, 5, 1)).toBeNull()
        expect(readCell(doc, 6, 1)).toBeNull()
        // Source untouched by undo.
        expect(readCell(doc, 1, 1)).toMatchObject({ kind: 'number', raw: 1 })
        expect(readCell(doc, 2, 1)).toMatchObject({ kind: 'number', raw: 2 })
    })

    it('tags the commit transaction with LOCAL_ORIGIN', () => {
        const doc = new Y.Doc()
        setYCell(doc, SHEET, 1, 1, '1')
        setYCell(doc, SHEET, 2, 1, '2')

        const seenOrigins: unknown[] = []
        const handler = (transaction: Y.Transaction) => {
            // Skip seed transactions (origin LOCAL_ORIGIN from setYCell)
            // by recording every observed origin and asserting only the
            // post-subscribe ones.
            seenOrigins.push(transaction.origin)
        }
        doc.on('afterTransaction', handler)

        applyFill({
            doc,
            sheetId: SHEET,
            sourceRange: { startRow: 1, endRow: 2, startCol: 1, endCol: 1 },
            destRange: { startRow: 1, endRow: 4, startCol: 1, endCol: 1 },
            direction: 'down',
        })

        doc.off('afterTransaction', handler)

        // The fill itself is one outer transaction. setYCellTyped /
        // setYCellStyle / deleteYCell open nested doc.transact calls —
        // yjs collapses these into the outer transaction (no fresh
        // origin per inner call), so we expect exactly one transaction
        // in seenOrigins for the fill, all tagged LOCAL_ORIGIN.
        expect(seenOrigins.length).toBe(1)
        expect(seenOrigins[0]).toBe(LOCAL_ORIGIN)
    })
})

describe('applyFill — no-op short-circuit', () => {
    it('destRange == sourceRange → no writes, no transact', () => {
        const doc = new Y.Doc()
        setYCell(doc, SHEET, 1, 1, '1')
        setYCell(doc, SHEET, 2, 1, '2')

        const seenOrigins: unknown[] = []
        const handler = (transaction: Y.Transaction) => {
            seenOrigins.push(transaction.origin)
        }
        doc.on('afterTransaction', handler)

        const range = { startRow: 1, endRow: 2, startCol: 1, endCol: 1 }
        applyFill({
            doc,
            sheetId: SHEET,
            sourceRange: range,
            destRange: range,
            direction: 'down',
        })

        doc.off('afterTransaction', handler)

        expect(seenOrigins.length).toBe(0)
        expect(readCell(doc, 1, 1)).toMatchObject({ kind: 'number', raw: 1 })
        expect(readCell(doc, 2, 1)).toMatchObject({ kind: 'number', raw: 2 })
    })
})

describe('applyFill — multi-column source filling down', () => {
    it('A1:B2 = (1,10 / 2,20), fill down to row 4 → each column its own series', () => {
        const doc = new Y.Doc()
        setYCell(doc, SHEET, 1, 1, '1')
        setYCell(doc, SHEET, 1, 2, '10')
        setYCell(doc, SHEET, 2, 1, '2')
        setYCell(doc, SHEET, 2, 2, '20')

        applyFill({
            doc,
            sheetId: SHEET,
            sourceRange: { startRow: 1, endRow: 2, startCol: 1, endCol: 2 },
            destRange: { startRow: 1, endRow: 4, startCol: 1, endCol: 2 },
            direction: 'down',
        })

        // Column A: 1,2 → 3,4
        expect(readCell(doc, 3, 1)).toMatchObject({ kind: 'number', raw: 3 })
        expect(readCell(doc, 4, 1)).toMatchObject({ kind: 'number', raw: 4 })
        // Column B: 10,20 → 30,40
        expect(readCell(doc, 3, 2)).toMatchObject({ kind: 'number', raw: 30 })
        expect(readCell(doc, 4, 2)).toMatchObject({ kind: 'number', raw: 40 })
    })

    it('multi-row source filling right → each row its own series', () => {
        // Symmetric of the above: A1:B2 with different rows, fill right.
        const doc = new Y.Doc()
        setYCell(doc, SHEET, 1, 1, '1')
        setYCell(doc, SHEET, 1, 2, '2')
        setYCell(doc, SHEET, 2, 1, '10')
        setYCell(doc, SHEET, 2, 2, '20')

        applyFill({
            doc,
            sheetId: SHEET,
            sourceRange: { startRow: 1, endRow: 2, startCol: 1, endCol: 2 },
            destRange: { startRow: 1, endRow: 2, startCol: 1, endCol: 4 },
            direction: 'right',
        })

        // Row 1: 1,2 → 3,4
        expect(readCell(doc, 1, 3)).toMatchObject({ kind: 'number', raw: 3 })
        expect(readCell(doc, 1, 4)).toMatchObject({ kind: 'number', raw: 4 })
        // Row 2: 10,20 → 30,40
        expect(readCell(doc, 2, 3)).toMatchObject({ kind: 'number', raw: 30 })
        expect(readCell(doc, 2, 4)).toMatchObject({ kind: 'number', raw: 40 })
    })
})

describe('applyFill — preserves preexisting destinations on no-op short-circuit boundary', () => {
    it('overwrites preexisting destination cells in the fill range', () => {
        const doc = new Y.Doc()
        setYCell(doc, SHEET, 1, 1, '1')
        setYCell(doc, SHEET, 2, 1, '2')
        setYCell(doc, SHEET, 3, 1, 'preexisting')

        applyFill({
            doc,
            sheetId: SHEET,
            sourceRange: { startRow: 1, endRow: 2, startCol: 1, endCol: 1 },
            destRange: { startRow: 1, endRow: 4, startCol: 1, endCol: 1 },
            direction: 'down',
        })

        // The preexisting cell at row 3 is overwritten by the projected 3.
        expect(readCell(doc, 3, 1)).toMatchObject({ kind: 'number', raw: 3 })
        expect(readCell(doc, 4, 1)).toMatchObject({ kind: 'number', raw: 4 })
    })
})

describe('applyFill — tombstone correctness for deleted cycle holes', () => {
    it('deletes a destination that was previously populated when projection is empty', () => {
        // Verify the deleteYCell path actually removes prior content,
        // not just no-ops on absent cells.
        const doc = new Y.Doc()
        setYCell(doc, SHEET, 1, 1, 'X')
        // Source row 2 is intentionally empty.
        deleteYCell(doc, SHEET, 2, 1)
        setYCell(doc, SHEET, 3, 1, 'Y')

        // Pre-populate dest cell at row 5 (which corresponds to the
        // empty cycle source[1]).
        setYCell(doc, SHEET, 5, 1, 'shouldVanish')

        applyFill({
            doc,
            sheetId: SHEET,
            sourceRange: { startRow: 1, endRow: 3, startCol: 1, endCol: 1 },
            destRange: { startRow: 1, endRow: 6, startCol: 1, endCol: 1 },
            direction: 'down',
        })

        // Step 4 (row 5) cycles to source[1] which is empty → delete.
        expect(readCell(doc, 5, 1)).toBeNull()
    })
})
