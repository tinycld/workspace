import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { readColWidthsFromMeta, setYColWidth } from '../tinycld/calc/lib/dimensions'
import { SHEETS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

// Hook tests would require a React renderer; the rest of this package
// runs vitest with react-native heavily mocked, so these tests exercise
// the same data flow at the Y.Doc layer that useYSheets reads through.
// The hook itself is a thin observer + snapshot wrapper around
// readColWidthsFromMeta.

function bootstrap(doc: Y.Doc): void {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = new Y.Map<unknown>()
    meta.set('name', 'Sheet1')
    meta.set('position', 0)
    meta.set('rowCount', 5)
    meta.set('colCount', 5)
    sheetsMap.set('sheet1', meta)
}

describe('colWidths flow through Y.Doc + readColWidthsFromMeta', () => {
    it('starts empty and updates after a write', () => {
        const doc = new Y.Doc()
        bootstrap(doc)
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        const meta = sheetsMap.get('sheet1')
        expect(readColWidthsFromMeta(meta)).toBeUndefined()

        setYColWidth(doc, 'sheet1', 2, 200)
        expect(readColWidthsFromMeta(meta)).toEqual({ 2: 200 })
    })

    it('observeDeep on the sheets map fires when a column width is set', () => {
        const doc = new Y.Doc()
        bootstrap(doc)
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        let observed = 0
        const handler = () => {
            observed++
        }
        sheetsMap.observeDeep(handler)
        try {
            setYColWidth(doc, 'sheet1', 1, 150)
            expect(observed).toBeGreaterThan(0)
        } finally {
            sheetsMap.unobserveDeep(handler)
        }
    })

    it('rewriting the same width still fires an observer (Y.Map semantics)', () => {
        // Documenting the underlying Y.Map behavior: setting the same key
        // to the same value still produces an update (and a CRDT
        // tombstone). The snapshot equality in useYSheets dedupes the
        // user-visible re-render, but the observer fires regardless.
        const doc = new Y.Doc()
        bootstrap(doc)
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        let observed = 0
        const handler = () => {
            observed++
        }
        sheetsMap.observeDeep(handler)
        try {
            setYColWidth(doc, 'sheet1', 1, 150)
            const after = observed
            setYColWidth(doc, 'sheet1', 1, 150)
            expect(observed).toBeGreaterThan(after)
        } finally {
            sheetsMap.unobserveDeep(handler)
        }
    })

    it('writing default width removes the entry from the snapshot', () => {
        const doc = new Y.Doc()
        bootstrap(doc)
        const meta = doc.getMap<Y.Map<unknown>>(SHEETS_MAP).get('sheet1')
        setYColWidth(doc, 'sheet1', 1, 200)
        setYColWidth(doc, 'sheet1', 2, 50)
        expect(readColWidthsFromMeta(meta)).toEqual({ 1: 200, 2: 50 })
        // Writing default cleans up entry 1 but leaves entry 2.
        setYColWidth(doc, 'sheet1', 1, 96)
        expect(readColWidthsFromMeta(meta)).toEqual({ 2: 50 })
    })
})
