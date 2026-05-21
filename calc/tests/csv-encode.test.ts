import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCell, setYCellStyle } from '../tinycld/calc/hooks/use-y-cell'
import { serializeSheetToCsv } from '../tinycld/calc/lib/csv/encode'
import { SHEETS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

function bootstrapSheet(doc: Y.Doc, sheetId = 'sheet1', name = 'Sheet1'): void {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = new Y.Map<unknown>()
    meta.set('name', name)
    meta.set('position', 0)
    meta.set('rowCount', 50)
    meta.set('colCount', 26)
    sheetsMap.set(sheetId, meta)
}

describe('serializeSheetToCsv', () => {
    it('emits a simple grid as CRLF-terminated comma-separated rows', () => {
        const doc = new Y.Doc()
        bootstrapSheet(doc)
        setYCell(doc, 'sheet1', 1, 1, 'Name')
        setYCell(doc, 'sheet1', 1, 2, 'Score')
        setYCell(doc, 'sheet1', 2, 1, 'Alice')
        setYCell(doc, 'sheet1', 2, 2, '42')
        setYCell(doc, 'sheet1', 3, 1, 'Bob')
        setYCell(doc, 'sheet1', 3, 2, '37')

        const csv = serializeSheetToCsv(doc, 'sheet1')
        expect(csv).toBe('Name,Score\r\nAlice,42\r\nBob,37')
    })

    it('quotes fields containing commas, quotes, or newlines and doubles inner quotes', () => {
        const doc = new Y.Doc()
        bootstrapSheet(doc)
        setYCell(doc, 'sheet1', 1, 1, "He said \"hi\"")
        setYCell(doc, 'sheet1', 1, 2, 'a,b,c')
        setYCell(doc, 'sheet1', 2, 1, "line1\nline2")
        setYCell(doc, 'sheet1', 2, 2, 'plain')

        const csv = serializeSheetToCsv(doc, 'sheet1')
        const lines = csv.split('\r\n')
        expect(lines[0]).toBe('"He said ""hi""","a,b,c"')
        expect(lines[1]).toBe('"line1\nline2",plain')
    })

    it('trims trailing all-empty rows AND trailing all-empty columns', () => {
        const doc = new Y.Doc()
        bootstrapSheet(doc)
        // One cell at (2, 3) — output should be 2 rows × 3 cols.
        setYCell(doc, 'sheet1', 2, 3, 'x')
        const csv = serializeSheetToCsv(doc, 'sheet1')
        expect(csv).toBe(',,\r\n,,x')
    })

    it('respects an explicit tab delimiter', () => {
        const doc = new Y.Doc()
        bootstrapSheet(doc)
        setYCell(doc, 'sheet1', 1, 1, 'a')
        setYCell(doc, 'sheet1', 1, 2, 'b')
        setYCell(doc, 'sheet1', 1, 3, 'c')
        const csv = serializeSheetToCsv(doc, 'sheet1', { delimiter: '\t' })
        expect(csv).toBe('a\tb\tc')
    })

    it('respects an explicit semicolon delimiter and quotes fields containing it', () => {
        const doc = new Y.Doc()
        bootstrapSheet(doc)
        setYCell(doc, 'sheet1', 1, 1, 'a;b')
        setYCell(doc, 'sheet1', 1, 2, 'c')
        const csv = serializeSheetToCsv(doc, 'sheet1', { delimiter: ';' })
        expect(csv).toBe('"a;b";c')
    })

    it('uses the formatted display by default and the raw scalar when useDisplay is false', () => {
        const doc = new Y.Doc()
        bootstrapSheet(doc)
        // Number cell with currency numFmt — display becomes "$1,234.56"
        // and contains a comma, so it must be quoted in default-display
        // CSV output. With useDisplay:false the raw 1234.56 is emitted
        // unquoted.
        setYCell(doc, 'sheet1', 1, 1, '1234.56')
        setYCellStyle(doc, 'sheet1', 1, 1, { numFmt: '"$"#,##0.00' })
        // Re-write so the cached display reflects the numFmt. setYCell
        // doesn't run the format pipeline; instead update display via a
        // direct write with the formatted text.
        const cellsMap = doc.getMap<Y.Map<unknown>>('cells')
        const cell = cellsMap.get('sheet1:1:1') as Y.Map<unknown>
        cell.set('display', '$1,234.56')

        const display = serializeSheetToCsv(doc, 'sheet1')
        expect(display).toBe('"$1,234.56"')
        const raw = serializeSheetToCsv(doc, 'sheet1', { useDisplay: false })
        expect(raw).toBe('1234.56')
    })

    it('emits TRUE/FALSE in raw mode for boolean cells', () => {
        const doc = new Y.Doc()
        bootstrapSheet(doc)
        setYCell(doc, 'sheet1', 1, 1, 'TRUE')
        setYCell(doc, 'sheet1', 1, 2, 'FALSE')
        const raw = serializeSheetToCsv(doc, 'sheet1', { useDisplay: false })
        expect(raw).toBe('TRUE,FALSE')
    })

    it('returns an empty string when the sheet has no populated cells', () => {
        const doc = new Y.Doc()
        bootstrapSheet(doc)
        expect(serializeSheetToCsv(doc, 'sheet1')).toBe('')
    })
})
