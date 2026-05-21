// Unit tests for the BlockIndent extension's pure helpers — the
// rendered-HTML shape produced by its `addAttributes` config, plus
// the keyboard-shortcut + commands surface. The Tiptap extension
// itself can't be instantiated cheaply without a full ProseMirror
// schema, so we drive the addAttributes callback directly: it's a
// plain function on the extension config object.

import { describe, expect, it } from 'vitest'
import {
    BlockIndent,
    INDENT_PX_PER_LEVEL,
    MAX_INDENT_LEVEL,
} from '../tinycld/text/lib/editor/block-indent'

// Tiptap's Extension.create returns an object whose `config` field
// holds the original spec we passed in. We pull the indent attribute
// definition off that and call its renderHTML / parseHTML in
// isolation — no editor required.
//
// `as` cast: the Extension type doesn't expose `config` in its
// declared shape (it's an internal). We don't want to depend on
// Tiptap internals at runtime, just at test-construction time.
type AttrCallbacks = {
    default: number
    parseHTML: (el: { getAttribute: (name: string) => string | null }) => number
    renderHTML: (attrs: { indent: unknown }) => Record<string, string>
}

function getIndentAttrCallbacks(): AttrCallbacks {
    const extConfig = (BlockIndent as unknown as { config: Record<string, unknown> }).config
    // addGlobalAttributes is defined on the extension as a function
    // closed over `this.options`. We supply a stub `this` that
    // mirrors what Tiptap's runtime would set up.
    const fn = extConfig.addGlobalAttributes as (this: { options: { types: string[] } }) => Array<{
        attributes: { indent: AttrCallbacks }
    }>
    const groups = fn.call({ options: { types: ['paragraph', 'heading'] } })
    const callbacks = groups[0]?.attributes?.indent
    if (!callbacks)
        throw new Error('block-indent: indent attribute missing from addGlobalAttributes output')
    return callbacks
}

describe('block-indent attribute round-trip', () => {
    it('renders nothing at the schema default of 0', () => {
        const cb = getIndentAttrCallbacks()
        expect(cb.renderHTML({ indent: 0 })).toEqual({})
    })

    it('emits data-indent + padding-inline-start at level 1', () => {
        const cb = getIndentAttrCallbacks()
        const out = cb.renderHTML({ indent: 1 })
        expect(out['data-indent']).toBe('1')
        expect(out.style).toBe(`padding-inline-start: ${INDENT_PX_PER_LEVEL}px`)
    })

    it('scales padding linearly across levels', () => {
        const cb = getIndentAttrCallbacks()
        const out = cb.renderHTML({ indent: 3 })
        expect(out.style).toBe(`padding-inline-start: ${3 * INDENT_PX_PER_LEVEL}px`)
    })

    it('clamps oversized levels to MAX_INDENT_LEVEL', () => {
        const cb = getIndentAttrCallbacks()
        const out = cb.renderHTML({ indent: 999 })
        expect(out['data-indent']).toBe(String(MAX_INDENT_LEVEL))
        expect(out.style).toBe(`padding-inline-start: ${MAX_INDENT_LEVEL * INDENT_PX_PER_LEVEL}px`)
    })

    it('clamps negative levels to 0 and emits nothing', () => {
        const cb = getIndentAttrCallbacks()
        expect(cb.renderHTML({ indent: -3 })).toEqual({})
    })

    it('treats non-number indent attrs as 0', () => {
        const cb = getIndentAttrCallbacks()
        expect(cb.renderHTML({ indent: undefined })).toEqual({})
        expect(cb.renderHTML({ indent: null })).toEqual({})
        // String "2" should be coerced via clampLevel
        expect(cb.renderHTML({ indent: '2' })).toEqual({
            'data-indent': '2',
            style: `padding-inline-start: ${2 * INDENT_PX_PER_LEVEL}px`,
        })
    })

    it('parses the rendered data-indent back to the same integer level', () => {
        const cb = getIndentAttrCallbacks()
        const el = (val: string | null) => ({
            getAttribute: (name: string) => (name === 'data-indent' ? val : null),
        })
        expect(cb.parseHTML(el(null))).toBe(0)
        expect(cb.parseHTML(el('0'))).toBe(0)
        expect(cb.parseHTML(el('1'))).toBe(1)
        expect(cb.parseHTML(el('5'))).toBe(5)
        // The HTML attribute survives DOM round-trip as a string; the
        // parser must coerce it cleanly.
        expect(cb.parseHTML(el('-2'))).toBe(0)
        expect(cb.parseHTML(el('not-a-number'))).toBe(0)
    })

    it('caps parsed values at MAX_INDENT_LEVEL', () => {
        const cb = getIndentAttrCallbacks()
        const el = (val: string) => ({
            getAttribute: (name: string) => (name === 'data-indent' ? val : null),
        })
        expect(cb.parseHTML(el('99'))).toBe(MAX_INDENT_LEVEL)
    })
})

describe('block-indent constants', () => {
    it('keeps MAX_INDENT_LEVEL in sync with the server-side cap', () => {
        // Documented invariant: the server's MaxIndentLevel
        // (translate/types.go) must equal the editor's
        // MAX_INDENT_LEVEL — otherwise the importer would clamp a
        // doc to a level the editor can't reach (or vice versa).
        // Server is 8; bumping requires a coordinated change.
        expect(MAX_INDENT_LEVEL).toBe(8)
    })

    it('uses a non-zero per-level px step so indents are visually distinct', () => {
        // Smoke test: if INDENT_PX_PER_LEVEL ever becomes 0 the indent
        // attribute would still survive round-trip but render as a
        // no-op visually — a confusing failure mode.
        expect(INDENT_PX_PER_LEVEL).toBeGreaterThan(0)
    })
})
