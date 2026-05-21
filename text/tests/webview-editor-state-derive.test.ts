// Unit tests for the four state-deriving helpers that the WebView
// editor and the web variant both consume. They are pure functions
// over an editor-shaped object (a getAttributes + isActive surface),
// so we can drive them against a tiny in-memory stub rather than
// instantiating a full Tiptap editor.
//
// The helpers live in webview-editor/source/editor-state.ts as a
// single shared module that both Editor.tsx (in the WebView entry)
// and use-document-editor.web.tsx (the web hook) can import from.
// Keeping behavior in one place is what keeps the WebView and the web
// editor's toolbar-state shapes in lock-step.

import { describe, expect, it } from 'vitest'
import {
    deriveActiveHeadingLevel,
    deriveActiveIndent,
    deriveCurrentAlign,
    deriveCurrentFontFamily,
    deriveCurrentFontSize,
    type EditorLike,
} from '../tinycld/text/webview-editor/source/editor-state'

// Build a minimal editor stub. The helpers only call getAttributes and
// (in principle) isActive; the test cases below cover the
// getAttributes paths since that's where every helper reads state.
function fakeEditor(byType: Record<string, Record<string, unknown>>): EditorLike {
    return {
        getAttributes(typeOrName) {
            return byType[typeOrName] ?? {}
        },
        isActive() {
            return false
        },
    }
}

// Build an editor stub whose isActive('heading', { level }) returns
// true only for a specific level. Mirrors the toolbar's "which heading
// am I in" lookup pattern.
function fakeHeadingEditor(activeLevel: number | null): EditorLike {
    return {
        getAttributes() {
            return {}
        },
        isActive(name, attrs) {
            if (name !== 'heading' || activeLevel == null) return false
            return attrs?.level === activeLevel
        },
    }
}

describe('deriveCurrentAlign', () => {
    it('returns null when no editor is passed', () => {
        expect(deriveCurrentAlign(null)).toBeNull()
        expect(deriveCurrentAlign(undefined)).toBeNull()
    })

    it('returns null when neither paragraph nor heading carries a textAlign attr', () => {
        const editor = fakeEditor({ paragraph: {}, heading: {} })
        expect(deriveCurrentAlign(editor)).toBeNull()
    })

    it("returns 'left' when the paragraph block carries textAlign='left'", () => {
        const editor = fakeEditor({ paragraph: { textAlign: 'left' }, heading: {} })
        expect(deriveCurrentAlign(editor)).toBe('left')
    })

    it('returns center/right/justify verbatim', () => {
        for (const v of ['center', 'right', 'justify'] as const) {
            const editor = fakeEditor({ paragraph: { textAlign: v }, heading: {} })
            expect(deriveCurrentAlign(editor)).toBe(v)
        }
    })

    it('falls back to the heading attr when paragraph is unset (cross-block selection or caret in heading)', () => {
        const editor = fakeEditor({ paragraph: {}, heading: { textAlign: 'right' } })
        expect(deriveCurrentAlign(editor)).toBe('right')
    })

    it('rejects unrecognized textAlign values by returning null', () => {
        const editor = fakeEditor({ paragraph: { textAlign: 'mystery' }, heading: {} })
        expect(deriveCurrentAlign(editor)).toBeNull()
    })
})

describe('deriveCurrentFontSize', () => {
    it('returns null when no editor is passed', () => {
        expect(deriveCurrentFontSize(null)).toBeNull()
    })

    it("returns null when textStyle.fontSize is absent (document default)", () => {
        const editor = fakeEditor({ textStyle: {} })
        expect(deriveCurrentFontSize(editor)).toBeNull()
    })

    it("parses '16px' to 16", () => {
        const editor = fakeEditor({ textStyle: { fontSize: '16px' } })
        expect(deriveCurrentFontSize(editor)).toBe(16)
    })

    it('tolerates bare numbers without px suffix', () => {
        const editor = fakeEditor({ textStyle: { fontSize: '14' } })
        expect(deriveCurrentFontSize(editor)).toBe(14)
    })

    it('rounds fractional values', () => {
        const editor = fakeEditor({ textStyle: { fontSize: '14.6px' } })
        expect(deriveCurrentFontSize(editor)).toBe(15)
    })

    it("returns null for non-string fontSize attrs (defensive)", () => {
        const editor = fakeEditor({ textStyle: { fontSize: 16 } })
        expect(deriveCurrentFontSize(editor)).toBeNull()
    })

    it('returns null for empty / zero / negative values', () => {
        expect(deriveCurrentFontSize(fakeEditor({ textStyle: { fontSize: '' } }))).toBeNull()
        expect(deriveCurrentFontSize(fakeEditor({ textStyle: { fontSize: '0px' } }))).toBeNull()
        expect(deriveCurrentFontSize(fakeEditor({ textStyle: { fontSize: '-3px' } }))).toBeNull()
        expect(
            deriveCurrentFontSize(fakeEditor({ textStyle: { fontSize: 'not-a-size' } }))
        ).toBeNull()
    })
})

describe('deriveCurrentFontFamily', () => {
    it('returns null when no editor is passed', () => {
        expect(deriveCurrentFontFamily(null)).toBeNull()
    })

    it('returns null when textStyle.fontFamily is unset', () => {
        const editor = fakeEditor({ textStyle: {} })
        expect(deriveCurrentFontFamily(editor)).toBeNull()
    })

    it("returns the family name string verbatim when present", () => {
        const editor = fakeEditor({ textStyle: { fontFamily: 'Georgia, serif' } })
        expect(deriveCurrentFontFamily(editor)).toBe('Georgia, serif')
    })

    it('collapses an empty-string family to null so the dropdown shows "Default"', () => {
        const editor = fakeEditor({ textStyle: { fontFamily: '' } })
        expect(deriveCurrentFontFamily(editor)).toBeNull()
    })

    it("returns null for non-string fontFamily attrs (defensive)", () => {
        const editor = fakeEditor({ textStyle: { fontFamily: 123 } })
        expect(deriveCurrentFontFamily(editor)).toBeNull()
    })
})

describe('deriveActiveIndent', () => {
    it('returns 0 when no editor is passed', () => {
        expect(deriveActiveIndent(null)).toBe(0)
    })

    it('returns 0 when neither paragraph nor heading carries an indent attr', () => {
        const editor = fakeEditor({ paragraph: {}, heading: {} })
        expect(deriveActiveIndent(editor)).toBe(0)
    })

    it('reads the paragraph indent when set', () => {
        const editor = fakeEditor({ paragraph: { indent: 3 }, heading: {} })
        expect(deriveActiveIndent(editor)).toBe(3)
    })

    it('falls back to heading indent when paragraph indent is missing', () => {
        const editor = fakeEditor({ paragraph: {}, heading: { indent: 2 } })
        expect(deriveActiveIndent(editor)).toBe(2)
    })

    it('clamps negative values to 0 (defensive)', () => {
        const editor = fakeEditor({ paragraph: { indent: -1 }, heading: {} })
        expect(deriveActiveIndent(editor)).toBe(0)
    })

    it('returns 0 for non-number indent attrs', () => {
        const editor = fakeEditor({ paragraph: { indent: '3' }, heading: {} })
        expect(deriveActiveIndent(editor)).toBe(0)
    })
})

describe('deriveActiveHeadingLevel', () => {
    it('returns null when no editor is passed', () => {
        expect(deriveActiveHeadingLevel(null)).toBeNull()
        expect(deriveActiveHeadingLevel(undefined)).toBeNull()
    })

    it('returns null when no heading is active at the caret', () => {
        expect(deriveActiveHeadingLevel(fakeHeadingEditor(null))).toBeNull()
    })

    it('returns the level for each of h1..h6 when active', () => {
        for (const level of [1, 2, 3, 4, 5, 6]) {
            expect(deriveActiveHeadingLevel(fakeHeadingEditor(level))).toBe(level)
        }
    })
})
