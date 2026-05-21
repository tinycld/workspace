import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
    computeMatches,
} from '../tinycld/calc/hooks/find/use-find-actions'
import { setYCell, setYCellTyped } from '../tinycld/calc/hooks/use-y-cell'
import { bootstrapYDocFromWorkbook } from '../tinycld/calc/lib/y-doc-bootstrap'
import type { WorkbookModel } from '../tinycld/calc/lib/workbook-types'

function makeDoc(): Y.Doc {
    const doc = new Y.Doc()
    const model: WorkbookModel = {
        sheets: [
            { name: 'Sheet1', rowCount: 5, colCount: 5, cells: {} },
            { name: 'Sheet2', rowCount: 5, colCount: 5, cells: {} },
        ],
    }
    bootstrapYDocFromWorkbook(doc, model)
    return doc
}

describe('computeMatches', () => {
    it('returns empty when query is empty', () => {
        const doc = makeDoc()
        setYCell(doc, 'sheet1', 1, 1, 'apple')
        const result = computeMatches(doc, {
            sheetId: 'sheet1',
            query: '',
            matchCase: false,
            wholeCell: false,
            useRegex: false,
            searchInFormulas: false,
            scope: 'sheet',
        })
        expect(result.matches).toEqual([])
        expect(result.regexError).toBeNull()
    })

    it('finds a substring match across cells', () => {
        const doc = makeDoc()
        setYCell(doc, 'sheet1', 1, 1, 'apple')
        setYCell(doc, 'sheet1', 2, 1, 'banana')
        setYCell(doc, 'sheet1', 3, 1, 'pineapple')
        const result = computeMatches(doc, {
            sheetId: 'sheet1',
            query: 'apple',
            matchCase: false,
            wholeCell: false,
            useRegex: false,
            searchInFormulas: false,
            scope: 'sheet',
        })
        expect(result.matches).toEqual([
            { sheetId: 'sheet1', row: 1, col: 1 },
            { sheetId: 'sheet1', row: 3, col: 1 },
        ])
    })

    it('honors matchCase', () => {
        const doc = makeDoc()
        setYCell(doc, 'sheet1', 1, 1, 'Apple')
        setYCell(doc, 'sheet1', 2, 1, 'apple')
        const insensitive = computeMatches(doc, {
            sheetId: 'sheet1',
            query: 'apple',
            matchCase: false,
            wholeCell: false,
            useRegex: false,
            searchInFormulas: false,
            scope: 'sheet',
        })
        expect(insensitive.matches).toHaveLength(2)
        const sensitive = computeMatches(doc, {
            sheetId: 'sheet1',
            query: 'apple',
            matchCase: true,
            wholeCell: false,
            useRegex: false,
            searchInFormulas: false,
            scope: 'sheet',
        })
        expect(sensitive.matches).toEqual([{ sheetId: 'sheet1', row: 2, col: 1 }])
    })

    it('honors wholeCell', () => {
        const doc = makeDoc()
        setYCell(doc, 'sheet1', 1, 1, 'apple')
        setYCell(doc, 'sheet1', 2, 1, 'apple pie')
        const result = computeMatches(doc, {
            sheetId: 'sheet1',
            query: 'apple',
            matchCase: false,
            wholeCell: true,
            useRegex: false,
            searchInFormulas: false,
            scope: 'sheet',
        })
        expect(result.matches).toEqual([{ sheetId: 'sheet1', row: 1, col: 1 }])
    })

    it('regex mode finds patterns', () => {
        const doc = makeDoc()
        setYCell(doc, 'sheet1', 1, 1, 'apple')
        setYCell(doc, 'sheet1', 2, 1, 'banana')
        setYCell(doc, 'sheet1', 3, 1, 'pear')
        const result = computeMatches(doc, {
            sheetId: 'sheet1',
            query: '^(apple|pear)$',
            matchCase: false,
            wholeCell: false,
            useRegex: true,
            searchInFormulas: false,
            scope: 'sheet',
        })
        expect(result.matches).toEqual([
            { sheetId: 'sheet1', row: 1, col: 1 },
            { sheetId: 'sheet1', row: 3, col: 1 },
        ])
    })

    it('regex with invalid pattern reports error and no matches', () => {
        const doc = makeDoc()
        setYCell(doc, 'sheet1', 1, 1, 'apple')
        const result = computeMatches(doc, {
            sheetId: 'sheet1',
            query: '(unclosed',
            matchCase: false,
            wholeCell: false,
            useRegex: true,
            searchInFormulas: false,
            scope: 'sheet',
        })
        expect(result.matches).toEqual([])
        expect(result.regexError).not.toBeNull()
    })

    it('searchInFormulas matches against the formula string', () => {
        const doc = makeDoc()
        // Simulate an evaluated formula cell: display reflects the
        // computed result, the formula text is stashed separately. The
        // grid normally gets here once the HF bridge writes back, but
        // tests can seed it directly.
        setYCellTyped(doc, 'sheet1', 1, 1, {
            kind: 'formula',
            raw: 12,
            display: '12',
            formula: '=SUM(A1:A2)',
        })
        const noFormula = computeMatches(doc, {
            sheetId: 'sheet1',
            query: 'SUM',
            matchCase: false,
            wholeCell: false,
            useRegex: false,
            searchInFormulas: false,
            scope: 'sheet',
        })
        expect(noFormula.matches).toEqual([])
        const withFormula = computeMatches(doc, {
            sheetId: 'sheet1',
            query: 'SUM',
            matchCase: false,
            wholeCell: false,
            useRegex: false,
            searchInFormulas: true,
            scope: 'sheet',
        })
        expect(withFormula.matches).toEqual([{ sheetId: 'sheet1', row: 1, col: 1 }])
    })

    it('sheet scope excludes other sheets; workbook scope includes them', () => {
        const doc = makeDoc()
        setYCell(doc, 'sheet1', 1, 1, 'apple')
        setYCell(doc, 'sheet2', 2, 2, 'apple')
        const sheetOnly = computeMatches(doc, {
            sheetId: 'sheet1',
            query: 'apple',
            matchCase: false,
            wholeCell: false,
            useRegex: false,
            searchInFormulas: false,
            scope: 'sheet',
        })
        expect(sheetOnly.matches).toEqual([{ sheetId: 'sheet1', row: 1, col: 1 }])
        const workbook = computeMatches(doc, {
            sheetId: 'sheet1',
            query: 'apple',
            matchCase: false,
            wholeCell: false,
            useRegex: false,
            searchInFormulas: false,
            scope: 'workbook',
        })
        expect(workbook.matches).toEqual([
            { sheetId: 'sheet1', row: 1, col: 1 },
            { sheetId: 'sheet2', row: 2, col: 2 },
        ])
    })

    it('matches sorted by sheetId then row then col', () => {
        const doc = makeDoc()
        setYCell(doc, 'sheet2', 3, 1, 'x')
        setYCell(doc, 'sheet1', 2, 5, 'x')
        setYCell(doc, 'sheet1', 2, 1, 'x')
        setYCell(doc, 'sheet1', 1, 1, 'x')
        const result = computeMatches(doc, {
            sheetId: 'sheet1',
            query: 'x',
            matchCase: false,
            wholeCell: false,
            useRegex: false,
            searchInFormulas: false,
            scope: 'workbook',
        })
        expect(result.matches).toEqual([
            { sheetId: 'sheet1', row: 1, col: 1 },
            { sheetId: 'sheet1', row: 2, col: 1 },
            { sheetId: 'sheet1', row: 2, col: 5 },
            { sheetId: 'sheet2', row: 3, col: 1 },
        ])
    })
})
