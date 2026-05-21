import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
    deleteColumns,
    deleteRows,
    insertColumns,
    insertRows,
} from '../tinycld/calc/lib/structural-mutations'
import { cellKey, type WorkbookModel } from '../tinycld/calc/lib/workbook-types'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import {
    bootstrapYDocFromWorkbook,
    CELLS_MAP,
    readYCell,
} from '../tinycld/calc/lib/y-doc-bootstrap'

// Integration tests for structural mutations + formula rewriting. The
// per-token rewrite rules are pinned in rewrite-formula-on-mutation.test.ts;
// these tests assert the wiring: the rewrite happens in the same
// doc.transact as the cell shift, walks ALL sheets (not just the
// mutated one), and is captured as a single undo step.

function newDoc(model: WorkbookModel): Y.Doc {
    const doc = new Y.Doc()
    bootstrapYDocFromWorkbook(doc, model)
    return doc
}

function readFormula(doc: Y.Doc, sheetId: string, row: number, col: number): string | undefined {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return undefined
    return readYCell(cell).formula
}

function readRaw(doc: Y.Doc, sheetId: string, row: number, col: number): unknown {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return undefined
    return readYCell(cell).raw
}

// Build a workbook with a couple of formulas and some scalar cells.
// Sheet1: A1=10, A2=20, A3=30, B1=formula =SUM(A1:A3), C1=formula =A1+1
// Sheet2: B2=formula =Sheet1!A2 (cross-sheet single ref)
function twoSheetWorkbook(): WorkbookModel {
    return {
        sheets: [
            {
                name: 'Sheet1',
                rowCount: 5,
                colCount: 5,
                cells: {
                    [cellKey(1, 1)]: { kind: 'number', raw: 10, display: '10' },
                    [cellKey(2, 1)]: { kind: 'number', raw: 20, display: '20' },
                    [cellKey(3, 1)]: { kind: 'number', raw: 30, display: '30' },
                    [cellKey(1, 2)]: {
                        kind: 'formula',
                        raw: 60,
                        display: '60',
                        formula: '=SUM(A1:A3)',
                    },
                    [cellKey(1, 3)]: {
                        kind: 'formula',
                        raw: 11,
                        display: '11',
                        formula: '=A1+1',
                    },
                },
            },
            {
                name: 'Sheet2',
                rowCount: 5,
                colCount: 5,
                cells: {
                    [cellKey(2, 2)]: {
                        kind: 'formula',
                        raw: 20,
                        display: '20',
                        formula: '=Sheet1!A2',
                    },
                },
            },
        ],
    }
}

describe('structural mutations — insertRows', () => {
    it('shifts cells AND rewrites formulas referencing shifted rows', () => {
        const doc = newDoc(twoSheetWorkbook())
        // Insert 2 rows above row 2 on Sheet1. A1 stays put; A2/A3
        // shift to A4/A5; the formula at B1 referencing A1:A3 must
        // grow to A1:A5 (top endpoint A1 < insertAt unchanged, bottom
        // A3 >= insertAt shifts by +2).
        insertRows(doc, 'sheet1', 2, 2, 'above')

        expect(readRaw(doc, 'sheet1', 1, 1)).toBe(10)
        expect(readRaw(doc, 'sheet1', 4, 1)).toBe(20)
        expect(readRaw(doc, 'sheet1', 5, 1)).toBe(30)
        expect(readFormula(doc, 'sheet1', 1, 2)).toBe('=SUM(A1:A5)')
    })

    it('rewrites a same-cell formula whose ref lives in the shifted region', () => {
        const doc = newDoc(twoSheetWorkbook())
        // C1 = =A1+1. Insert above row 1 — both C1 and A1 shift to row 3.
        // Formula's A1 token is >= insertAt(=1), so it shifts to A3.
        insertRows(doc, 'sheet1', 1, 2, 'above')
        expect(readFormula(doc, 'sheet1', 3, 3)).toBe('=A3+1')
    })

    it('rewrites cross-sheet refs into the mutated sheet', () => {
        const doc = newDoc(twoSheetWorkbook())
        // Insert row above row 2 on Sheet1. The formula on Sheet2!B2
        // references Sheet1!A2 (= insertAt), so it shifts to Sheet1!A3.
        // Sheet2's row 2 itself is NOT touched — Sheet2!B2 stays put.
        insertRows(doc, 'sheet1', 2, 1, 'above')
        expect(readFormula(doc, 'sheet2', 2, 2)).toBe('=Sheet1!A3')
    })

    it('does not rewrite single-cell refs into a different sheet', () => {
        const doc = newDoc(twoSheetWorkbook())
        // Insert on Sheet2 should not touch a Sheet1! ref.
        insertRows(doc, 'sheet2', 1, 1, 'above')
        // Sheet2!B2 shifted down to row 3 by the cell move; the
        // Sheet1!A2 ref is unchanged because the mutation was on
        // Sheet2.
        expect(readFormula(doc, 'sheet2', 3, 2)).toBe('=Sheet1!A2')
    })
})

describe('structural mutations — insertColumns', () => {
    it('shifts cells AND rewrites column refs', () => {
        const doc = newDoc(twoSheetWorkbook())
        // Insert column left of B on Sheet1: A column unchanged, B/C
        // shift right by 1. Formula at B1 references A1:A3 (col 1) —
        // unchanged. Formula at C1 (now D1) =A1+1 unchanged.
        insertColumns(doc, 'sheet1', 2, 1, 'left')

        expect(readRaw(doc, 'sheet1', 1, 1)).toBe(10)
        expect(readFormula(doc, 'sheet1', 1, 3)).toBe('=SUM(A1:A3)')
        expect(readFormula(doc, 'sheet1', 1, 4)).toBe('=A1+1')
    })

    it('rewrites col refs at-or-right of the insert', () => {
        const model: WorkbookModel = {
            sheets: [
                {
                    name: 'Sheet1',
                    rowCount: 3,
                    colCount: 5,
                    cells: {
                        [cellKey(1, 1)]: {
                            kind: 'formula',
                            raw: null,
                            display: '',
                            formula: '=B1+C1',
                        },
                    },
                },
            ],
        }
        const doc = newDoc(model)
        // Insert column at col 2 (left). B (col 2) and C (col 3)
        // shift right; B1 → C1, C1 → D1.
        insertColumns(doc, 'sheet1', 2, 1, 'left')
        expect(readFormula(doc, 'sheet1', 1, 1)).toBe('=C1+D1')
    })
})

describe('structural mutations — deleteRows', () => {
    it('shifts cells up AND rewrites formula refs', () => {
        const doc = newDoc(twoSheetWorkbook())
        // Delete row 2 on Sheet1. A2 disappears, A3 shifts up to A2.
        // The formula at B1 references A1:A3 — A1 < fromRow unchanged,
        // A3 > last shifts by -1 → A1:A2.
        deleteRows(doc, 'sheet1', 2, 1)

        expect(readRaw(doc, 'sheet1', 1, 1)).toBe(10)
        expect(readRaw(doc, 'sheet1', 2, 1)).toBe(30)
        expect(readFormula(doc, 'sheet1', 1, 2)).toBe('=SUM(A1:A2)')
    })

    it('rewrites cross-sheet refs into the deleted rows to #REF!', () => {
        const doc = newDoc(twoSheetWorkbook())
        // Delete row 2 on Sheet1. Sheet2!B2 = =Sheet1!A2 references
        // the deleted row, so it becomes =Sheet1!#REF!.
        deleteRows(doc, 'sheet1', 2, 1)
        expect(readFormula(doc, 'sheet2', 2, 2)).toBe('=Sheet1!#REF!')
    })

    it('collapses a fully-internal range to #REF!', () => {
        const model: WorkbookModel = {
            sheets: [
                {
                    name: 'Sheet1',
                    rowCount: 10,
                    colCount: 5,
                    cells: {
                        [cellKey(1, 1)]: {
                            kind: 'formula',
                            raw: 0,
                            display: '0',
                            formula: '=SUM(A3:A5)',
                        },
                    },
                },
            ],
        }
        const doc = newDoc(model)
        deleteRows(doc, 'sheet1', 3, 3)
        expect(readFormula(doc, 'sheet1', 1, 1)).toBe('=SUM(#REF!:#REF!)')
    })
})

describe('structural mutations — deleteColumns', () => {
    it('shifts cells left AND rewrites formula refs', () => {
        const model: WorkbookModel = {
            sheets: [
                {
                    name: 'Sheet1',
                    rowCount: 3,
                    colCount: 5,
                    cells: {
                        [cellKey(1, 1)]: { kind: 'number', raw: 10, display: '10' },
                        [cellKey(1, 3)]: { kind: 'number', raw: 30, display: '30' },
                        [cellKey(1, 5)]: {
                            kind: 'formula',
                            raw: 40,
                            display: '40',
                            formula: '=A1+C1',
                        },
                    },
                },
            ],
        }
        const doc = newDoc(model)
        deleteColumns(doc, 'sheet1', 2, 1)
        expect(readRaw(doc, 'sheet1', 1, 1)).toBe(10)
        expect(readRaw(doc, 'sheet1', 1, 2)).toBe(30)
        // The formula cell at col 5 shifts left to col 4. Its formula
        // had A1 (col 1, < fromRow) unchanged and C1 (col 3, > last)
        // shifted by -1 → B1.
        expect(readFormula(doc, 'sheet1', 1, 4)).toBe('=A1+B1')
    })

    it('replaces refs inside deleted cols with #REF!', () => {
        const model: WorkbookModel = {
            sheets: [
                {
                    name: 'Sheet1',
                    rowCount: 3,
                    colCount: 5,
                    cells: {
                        [cellKey(1, 1)]: {
                            kind: 'formula',
                            raw: null,
                            display: '',
                            formula: '=B1+C1',
                        },
                    },
                },
            ],
        }
        const doc = newDoc(model)
        deleteColumns(doc, 'sheet1', 2, 1)
        // B1 was col 2 — deleted, → #REF!. C1 was col 3, > last(=2),
        // shifts left by 1 → B1.
        expect(readFormula(doc, 'sheet1', 1, 1)).toBe('=#REF!+B1')
    })
})

describe('structural mutations — undo grouping', () => {
    function newManager(doc: Y.Doc): Y.UndoManager {
        return new Y.UndoManager([doc.getMap(CELLS_MAP)], {
            captureTimeout: 500,
            trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
        })
    }

    it('captures shift + rewrite as a single undo step', () => {
        const doc = newDoc(twoSheetWorkbook())
        const manager = newManager(doc)

        insertRows(doc, 'sheet1', 2, 1, 'above')
        // Pre-undo: shift happened, formula rewritten.
        expect(readRaw(doc, 'sheet1', 4, 1)).toBe(30)
        expect(readFormula(doc, 'sheet1', 1, 2)).toBe('=SUM(A1:A4)')

        manager.undo()
        // Post-undo: cells back, formula text back.
        expect(readRaw(doc, 'sheet1', 3, 1)).toBe(30)
        expect(readFormula(doc, 'sheet1', 1, 2)).toBe('=SUM(A1:A3)')
        // One undo, not two — stack should be empty now.
        expect(manager.canUndo()).toBe(false)
    })

    it('redo restores both the shift and the rewrite', () => {
        const doc = newDoc(twoSheetWorkbook())
        const manager = newManager(doc)

        deleteRows(doc, 'sheet1', 2, 1)
        manager.undo()
        manager.redo()

        expect(readRaw(doc, 'sheet1', 2, 1)).toBe(30)
        expect(readFormula(doc, 'sheet1', 1, 2)).toBe('=SUM(A1:A2)')
    })

    it('cross-sheet rewrite is part of the same undo group', () => {
        const doc = newDoc(twoSheetWorkbook())
        const manager = newManager(doc)

        insertRows(doc, 'sheet1', 2, 1, 'above')
        expect(readFormula(doc, 'sheet2', 2, 2)).toBe('=Sheet1!A3')

        manager.undo()
        expect(readFormula(doc, 'sheet2', 2, 2)).toBe('=Sheet1!A2')
    })
})
