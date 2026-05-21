import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
    clearYRowStyle,
    ROW_STYLES_KEY,
    readRowStyleFromMeta,
    readRowStylesFromMeta,
    setYRowStyle,
} from '../tinycld/calc/lib/sheet-styles'
import { SHEETS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

// sheet-styles is the lazy row/col/sheet styling layer. Slice 1
// covers the row axis only — col/sheet land in a follow-up. The Y.Doc
// shape mirrors cell[STYLE_KEY] so the same buildStyleYMap and
// readStyleFromYMapEntry logic is reused.

const SHEET = 'sheet1'

function bootstrap(doc: Y.Doc): Y.Map<unknown> {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = new Y.Map<unknown>()
    meta.set('name', 'Sheet1')
    meta.set('position', 0)
    meta.set('rowCount', 50)
    meta.set('colCount', 26)
    sheetsMap.set(SHEET, meta)
    return meta
}

describe('setYRowStyle', () => {
    it('lazily creates the rowStyles container on first write', () => {
        const doc = new Y.Doc()
        const meta = bootstrap(doc)
        expect(meta.get(ROW_STYLES_KEY)).toBeUndefined()
        setYRowStyle(doc, SHEET, 7, { fill: { fgColor: 'FFFFFF00' } })
        expect(meta.get(ROW_STYLES_KEY)).toBeInstanceOf(Y.Map)
    })

    it('writes a fill color readable via readRowStyleFromMeta', () => {
        const doc = new Y.Doc()
        const meta = bootstrap(doc)
        setYRowStyle(doc, SHEET, 7, { fill: { fgColor: 'FFFFFF00' } })
        const style = readRowStyleFromMeta(meta, 7)
        expect(style?.fill?.fgColor).toBe('FFFFFF00')
    })

    it('deep-merges subsequent writes group-by-group', () => {
        const doc = new Y.Doc()
        const meta = bootstrap(doc)
        setYRowStyle(doc, SHEET, 7, { fill: { fgColor: 'FFFFFF00' } })
        setYRowStyle(doc, SHEET, 7, { font: { bold: true } })
        const style = readRowStyleFromMeta(meta, 7)
        expect(style?.fill?.fgColor).toBe('FFFFFF00')
        expect(style?.font?.bold).toBe(true)
    })

    it('overwrites a key within a group when re-set', () => {
        const doc = new Y.Doc()
        const meta = bootstrap(doc)
        setYRowStyle(doc, SHEET, 7, { fill: { fgColor: 'FFFFFF00' } })
        setYRowStyle(doc, SHEET, 7, { fill: { fgColor: 'FFFF0000' } })
        expect(readRowStyleFromMeta(meta, 7)?.fill?.fgColor).toBe('FFFF0000')
    })

    it('writes the scalar numFmt directly under the row style YMap', () => {
        const doc = new Y.Doc()
        const meta = bootstrap(doc)
        setYRowStyle(doc, SHEET, 3, { numFmt: '$#,##0.00' })
        expect(readRowStyleFromMeta(meta, 3)?.numFmt).toBe('$#,##0.00')
    })

    it('emits one transaction per row-style write', () => {
        const doc = new Y.Doc()
        bootstrap(doc)
        let count = 0
        doc.on('afterTransaction', () => {
            count += 1
        })
        setYRowStyle(doc, SHEET, 7, { font: { bold: true } })
        expect(count).toBe(1)
    })

    it('observeDeep on the sheets map fires when a row style is set', () => {
        const doc = new Y.Doc()
        bootstrap(doc)
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        let observed = 0
        const handler = () => {
            observed += 1
        }
        sheetsMap.observeDeep(handler)
        try {
            setYRowStyle(doc, SHEET, 7, { font: { bold: true } })
            expect(observed).toBeGreaterThan(0)
        } finally {
            sheetsMap.unobserveDeep(handler)
        }
    })

    it('is a no-op when doc is null', () => {
        // Toolbar callbacks may pass null when the workbook is not yet
        // bootstrapped. Mirror the dimensions-side guard.
        expect(() => setYRowStyle(null, SHEET, 7, { font: { bold: true } })).not.toThrow()
    })

    it('is a no-op when the sheet has no metadata YMap', () => {
        const doc = new Y.Doc()
        // No bootstrap: sheetsMap is empty.
        expect(() => setYRowStyle(doc, 'missing', 1, { font: { bold: true } })).not.toThrow()
    })

    it('does not create an entry when the patch is structurally empty', () => {
        const doc = new Y.Doc()
        const meta = bootstrap(doc)
        // An empty patch should not bring a row entry into existence —
        // the reader would then see an empty YMap as undefined anyway,
        // but we want to keep the doc minimal.
        setYRowStyle(doc, SHEET, 9, {})
        expect(readRowStyleFromMeta(meta, 9)).toBeUndefined()
    })
})

describe('readRowStylesFromMeta', () => {
    it('returns undefined when the rowStyles container is absent', () => {
        const doc = new Y.Doc()
        const meta = bootstrap(doc)
        expect(readRowStylesFromMeta(meta)).toBeUndefined()
    })

    it('returns a sparse Record after writes', () => {
        const doc = new Y.Doc()
        const meta = bootstrap(doc)
        setYRowStyle(doc, SHEET, 1, { fill: { fgColor: 'AAAAAA' } })
        setYRowStyle(doc, SHEET, 5, { font: { bold: true } })
        const all = readRowStylesFromMeta(meta)
        expect(all).toBeDefined()
        expect(all?.[1]?.fill?.fgColor).toBe('AAAAAA')
        expect(all?.[5]?.font?.bold).toBe(true)
        expect(all?.[2]).toBeUndefined()
    })
})

describe('clearYRowStyle', () => {
    it('removes the row entry without touching other rows', () => {
        const doc = new Y.Doc()
        const meta = bootstrap(doc)
        setYRowStyle(doc, SHEET, 1, { fill: { fgColor: 'AAAAAA' } })
        setYRowStyle(doc, SHEET, 2, { fill: { fgColor: 'BBBBBB' } })
        clearYRowStyle(doc, SHEET, 1)
        expect(readRowStyleFromMeta(meta, 1)).toBeUndefined()
        expect(readRowStyleFromMeta(meta, 2)?.fill?.fgColor).toBe('BBBBBB')
    })

    it('is a no-op when the row has no style', () => {
        const doc = new Y.Doc()
        bootstrap(doc)
        expect(() => clearYRowStyle(doc, SHEET, 99)).not.toThrow()
    })
})
