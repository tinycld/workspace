import { create } from '@tinycld/core/lib/store'
import type { CellBorderLineStyle } from '../lib/workbook-types'

// Sticky color + line-style state for the BordersMenu sub-pickers.
// The user picks a swatch (color) or line preview (style); the next
// pattern click reads the current values and stamps them onto every
// edge the preset writes. Mirrors the Google Sheets / Excel UX where
// the color picker pre-arms the next border-paint action.
//
// Defaults match the renderer's fallback (#000000 thin) so a fresh
// session writes the same uniform black thin borders the previous
// boolean-only schema produced.
//
// Transient — never persisted; resets to defaults on reload, matching
// the way the toolbar's other transient pickers (sheet-tabs context
// menu) behave.
export interface BordersPickerState {
    color: string
    style: CellBorderLineStyle
    setColor: (color: string) => void
    setStyle: (style: CellBorderLineStyle) => void
}

export const useBordersPickerStore = create<BordersPickerState>(set => ({
    color: '#000000',
    style: 'thin',
    setColor: (color: string) => set({ color }),
    setStyle: (style: CellBorderLineStyle) => set({ style }),
}))
