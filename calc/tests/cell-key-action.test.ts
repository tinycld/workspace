import { describe, expect, it } from 'vitest'
import { classifyCellKey } from '../tinycld/calc/lib/cell-key-action'

// classifyCellKey decides what to do when a key is pressed on a
// focused, non-editing cell. The Cell component dispatches on the
// returned action: 'ignore' means hand the event back to the
// shortcut registry / browser; 'clear' empties the selection;
// 'startEdit' opens the editor with the typed character as the seed.

describe('classifyCellKey', () => {
    describe('clear (Delete / Backspace)', () => {
        it('Delete maps to clear', () => {
            expect(classifyCellKey({ key: 'Delete' })).toEqual({ kind: 'clear' })
        })

        it('Backspace maps to clear', () => {
            expect(classifyCellKey({ key: 'Backspace' })).toEqual({ kind: 'clear' })
        })

        it('clear wins even when a modifier is held — Cmd+Delete still clears', () => {
            // The shortcut registry doesn't bind plain Cmd+Delete, so this
            // path stays a clear rather than getting swallowed by a missing
            // shortcut. If a future shortcut wants Cmd+Delete it can take
            // priority by handling the event at the document level first.
            expect(classifyCellKey({ key: 'Delete', metaKey: true })).toEqual({ kind: 'clear' })
        })
    })

    describe('startEdit (printable single chars)', () => {
        it.each([['a'], ['A'], ['1'], ['='], ['"'], [' '], ['€'], ['é']])(
            'opens the editor seeded with %j',
            key => {
                expect(classifyCellKey({ key })).toEqual({ kind: 'startEdit', seed: key })
            }
        )

        it("' opens the editor (apostrophe-prefix string forcing is handled inside the editor)", () => {
            expect(classifyCellKey({ key: "'" })).toEqual({ kind: 'startEdit', seed: "'" })
        })

        it('shifted character flows through as the uppercase form already in e.key', () => {
            expect(classifyCellKey({ key: 'A', shiftKey: true })).toEqual({
                kind: 'startEdit',
                seed: 'A',
            })
        })
    })

    describe('arrow (collapse disjoint on arrow nav)', () => {
        // Arrow keys produce the 'arrow' action so the cell can
        // collapse a disjoint selection to a single cell before
        // focus traversal walks to the neighbor. On a single-
        // rectangle selection the collapse is a no-op. Direction
        // travels with the action so callers that care (currently
        // only the Shift+arrow extend branch) don't need a separate
        // round of string matching.
        it.each([
            ['ArrowUp', 'up'],
            ['ArrowDown', 'down'],
            ['ArrowLeft', 'left'],
            ['ArrowRight', 'right'],
        ] as const)('maps %j to arrow %j', (key, direction) => {
            expect(classifyCellKey({ key })).toEqual({ kind: 'arrow', direction })
        })

        it('ignores Ctrl/Cmd/Alt+arrow — those belong to the shortcut registry', () => {
            expect(classifyCellKey({ key: 'ArrowDown', ctrlKey: true })).toEqual({
                kind: 'ignore',
            })
            expect(classifyCellKey({ key: 'ArrowDown', metaKey: true })).toEqual({
                kind: 'ignore',
            })
            expect(classifyCellKey({ key: 'ArrowDown', altKey: true })).toEqual({
                kind: 'ignore',
            })
        })
    })

    describe('extend (Shift+arrow grows the active sub-range)', () => {
        it.each([
            ['ArrowUp', 'up'],
            ['ArrowDown', 'down'],
            ['ArrowLeft', 'left'],
            ['ArrowRight', 'right'],
        ] as const)('Shift+%j maps to extend %j', (key, direction) => {
            expect(classifyCellKey({ key, shiftKey: true })).toEqual({
                kind: 'extend',
                direction,
            })
        })
    })

    describe('ignore', () => {
        it.each([
            ['Enter'],
            ['Tab'],
            ['Escape'],
            ['F2'],
            ['Home'],
            ['End'],
            ['PageUp'],
            ['PageDown'],
            ['Shift'],
            ['Control'],
            ['Meta'],
            ['Alt'],
            ['CapsLock'],
        ])('ignores named key %j (length > 1)', key => {
            expect(classifyCellKey({ key })).toEqual({ kind: 'ignore' })
        })

        it('ignores Cmd+letter — belongs to the global shortcut registry', () => {
            expect(classifyCellKey({ key: 'b', metaKey: true })).toEqual({ kind: 'ignore' })
        })

        it('ignores Ctrl+letter — same reason', () => {
            expect(classifyCellKey({ key: 'c', ctrlKey: true })).toEqual({ kind: 'ignore' })
        })

        it('ignores Alt+letter', () => {
            expect(classifyCellKey({ key: 'a', altKey: true })).toEqual({ kind: 'ignore' })
        })

        it('ignores when key is missing', () => {
            expect(classifyCellKey({})).toEqual({ kind: 'ignore' })
        })

        it('ignores a literal Tab character even if it sneaks through as a 1-char key', () => {
            // \t is < ' ' (0x09 < 0x20), so the control-char gate catches it.
            expect(classifyCellKey({ key: '\t' })).toEqual({ kind: 'ignore' })
        })
    })
})
