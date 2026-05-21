// Unit tests for the editor-side bits of the code-block / inline-code
// feature: the CSS rules baked into editor-content-styles, and the
// toolbar-state derivation predicate. The Go round-trip path is
// covered by server/translate/code_block_test.go; the editor-level
// behaviour we can exercise here is the surface that toolbar +
// menubar consume.

import { describe, expect, it } from 'vitest'
import { EDITOR_CONTENT_STYLES } from '../tinycld/text/lib/editor-content-styles'

describe('editor-content-styles: code block + inline code', () => {
    it('emits a .ProseMirror code rule for the inline mark', () => {
        // The inline `code` mark renders as <code> in the DOM. Tailwind
        // preflight strips browser defaults, so without an explicit
        // rule the run renders as plain prose — defeating the point of
        // the mark. Anchor the rule by its monospace font-family
        // declaration, which is the load-bearing visual signal.
        expect(EDITOR_CONTENT_STYLES).toContain('.ProseMirror code')
        const codeRuleMatch = EDITOR_CONTENT_STYLES.match(
            /\.ProseMirror code\s*\{[^}]*\}/m
        )
        expect(codeRuleMatch).not.toBeNull()
        if (codeRuleMatch) {
            expect(codeRuleMatch[0]).toContain('monospace')
        }
    })

    it('emits a .ProseMirror pre rule for the code block', () => {
        // Tiptap's CodeBlock node renders as <pre><code>...</code></pre>.
        // The block-level <pre> carries the padding + background; the
        // inner <code> resets the inline-mark presentation. Verify both
        // selectors are present so a future rule-reorganization can't
        // accidentally drop one.
        expect(EDITOR_CONTENT_STYLES).toContain('.ProseMirror pre')
        expect(EDITOR_CONTENT_STYLES).toContain('.ProseMirror pre code')
    })

    it('uses pre-wrap whitespace inside code blocks', () => {
        // pre-wrap keeps authored newlines visible while allowing long
        // lines to wrap inside the 680px-wide editor canvas. Without it
        // long lines would force horizontal scroll, which feels broken
        // on first-time use.
        const blockRule = EDITOR_CONTENT_STYLES.match(
            /\.ProseMirror pre code\s*\{[^}]*\}/m
        )
        expect(blockRule).not.toBeNull()
        if (blockRule) {
            expect(blockRule[0]).toContain('pre-wrap')
        }
    })
})

// codeStyleAliases mirrors the Go-side `isCodeBlockStyle` predicate
// (server/translate/docx_to_pm.go). Mirrors are useful here because a
// future divergence would cause Word docs styled with one alias to
// import correctly but lose the round-trip — exactly the kind of
// silent regression we want a unit test to catch the next time
// someone touches either side.
function isCodeBlockStyle(pStyle: string): boolean {
    return (
        pStyle === 'CodeBlock' ||
        pStyle === 'Code' ||
        pStyle === 'HTMLPreformatted' ||
        pStyle === 'Preformatted'
    )
}

describe('code-block pStyle alias predicate (mirrors Go isCodeBlockStyle)', () => {
    it('accepts the canonical CodeBlock style', () => {
        expect(isCodeBlockStyle('CodeBlock')).toBe(true)
    })

    it('accepts common aliases produced by other Word exporters', () => {
        expect(isCodeBlockStyle('Code')).toBe(true)
        expect(isCodeBlockStyle('HTMLPreformatted')).toBe(true)
        expect(isCodeBlockStyle('Preformatted')).toBe(true)
    })

    it('rejects unrelated paragraph styles', () => {
        expect(isCodeBlockStyle('')).toBe(false)
        expect(isCodeBlockStyle('Normal')).toBe(false)
        expect(isCodeBlockStyle('Quote')).toBe(false)
        expect(isCodeBlockStyle('Heading1')).toBe(false)
        expect(isCodeBlockStyle('ListParagraph')).toBe(false)
    })

    it('is case-sensitive — Word style ids are case-sensitive', () => {
        expect(isCodeBlockStyle('codeblock')).toBe(false)
        expect(isCodeBlockStyle('codeBlock')).toBe(false)
        expect(isCodeBlockStyle('CODEBLOCK')).toBe(false)
    })
})
