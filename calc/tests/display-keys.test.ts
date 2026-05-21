import { describe, expect, it } from 'vitest'
import { displayKeys } from '../tinycld/calc/components/dialogs/display-keys'

// The platform branch inside formatKeys checks Platform.OS plus a
// navigator userAgent regex. Under vitest neither matches "Apple", so
// these tests pin the non-Apple rendering. The shape (modifiers joined
// with `+`, sequences joined with space) is identical across
// platforms; only the glyph table differs (e.g. ⌘ vs Ctrl).
describe('displayKeys', () => {
    it('joins single-modifier combos with +', () => {
        expect(displayKeys('$mod+c')).toBe('Ctrl+c')
    })

    it('joins multi-modifier combos with +', () => {
        expect(displayKeys('$mod+Shift+x')).toBe('Ctrl+Shift+x')
    })

    it('joins chord sequences with a space between combos', () => {
        expect(displayKeys('t i')).toBe('t i')
    })

    it('passes through bare keys without modifiers', () => {
        expect(displayKeys('Escape')).toBe('Esc')
    })

    it('translates Enter to its glyph', () => {
        expect(displayKeys('$mod+Enter')).toBe('Ctrl+↵')
    })

    it('formatKeys collapses Shift+? to ?; the renderer does not re-introduce a +', () => {
        // Shift is implicit in the glyph — the displayed form is the bare key.
        expect(displayKeys('Shift+?')).toBe('?')
    })
})
