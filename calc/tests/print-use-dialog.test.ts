import { describe, expect, it } from 'vitest'
import { createPrintDialogStore } from '../tinycld/calc/hooks/use-print-dialog'

describe('createPrintDialogStore', () => {
    it('starts closed', () => {
        const store = createPrintDialogStore()
        expect(store.getState().isOpen).toBe(false)
    })

    it('opens and closes', () => {
        const store = createPrintDialogStore()
        store.getState().open()
        expect(store.getState().isOpen).toBe(true)
        store.getState().close()
        expect(store.getState().isOpen).toBe(false)
    })

    it('produces independent stores per call (no shared singleton)', () => {
        const a = createPrintDialogStore()
        const b = createPrintDialogStore()
        a.getState().open()
        expect(a.getState().isOpen).toBe(true)
        expect(b.getState().isOpen).toBe(false)
    })
})
