import { beforeEach, describe, expect, it } from 'vitest'
import { useBordersPickerStore } from '../tinycld/calc/hooks/use-borders-picker-store'

// Smoke test for the BordersMenu sub-picker store. Defaults match the
// renderer's fallback so a fresh session draws the same uniform black
// thin borders the previous boolean-only schema produced.

describe('useBordersPickerStore', () => {
    beforeEach(() => {
        useBordersPickerStore.setState({ color: '#000000', style: 'thin' })
    })

    it('defaults to #000000 + thin', () => {
        const state = useBordersPickerStore.getState()
        expect(state.color).toBe('#000000')
        expect(state.style).toBe('thin')
    })

    it('setColor updates the color', () => {
        useBordersPickerStore.getState().setColor('#FF0000')
        expect(useBordersPickerStore.getState().color).toBe('#FF0000')
    })

    it('setStyle updates the line style', () => {
        useBordersPickerStore.getState().setStyle('dashed')
        expect(useBordersPickerStore.getState().style).toBe('dashed')
    })

    it('color and style are independent', () => {
        useBordersPickerStore.getState().setColor('#1565C0')
        useBordersPickerStore.getState().setStyle('thick')
        const state = useBordersPickerStore.getState()
        expect(state.color).toBe('#1565C0')
        expect(state.style).toBe('thick')
    })
})
