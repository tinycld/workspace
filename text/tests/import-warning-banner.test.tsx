// The ImportWarningBanner component is rendered by screens/[id].tsx
// above the editor whenever the server reports docx-import warnings
// in MsgServerHello.importWarnings. The visible affordances are:
//
//   - banner title with the warning count
//   - one line per warning, "code" or "code: detail"
//   - a dismiss button that hides the banner for the current session
//
// The component itself is React Native (View/Text/Pressable) styled
// with Uniwind, so we can't render it under Vitest's node environment.
// What we DO verify here are the pure formatters
// (`formatImportWarning`, `importWarningTitle`) the component uses
// to build its visible copy. Locking the formatter contract means a
// future change to the visible string fails this unit test instead of
// silently shipping a Playwright-only regression.

import { describe, expect, it } from 'vitest'
import {
    formatImportWarning,
    importWarningTitle,
    type ImportWarning,
} from '../tinycld/text/components/import-warning-format'

describe('formatImportWarning', () => {
    it('returns just the code when detail is absent', () => {
        expect(formatImportWarning({ code: 'unsupported-feature' })).toBe(
            'unsupported-feature'
        )
    })

    it('appends the detail with a colon when present', () => {
        expect(
            formatImportWarning({
                code: 'image-inlined',
                detail: 'data: URI ~120kb',
            })
        ).toBe('image-inlined: data: URI ~120kb')
    })

    it('treats an empty detail string as absent (no trailing colon)', () => {
        // The server marshals warnings with `Detail string \`json:"detail,omitempty"\``,
        // so an empty Detail field is normally omitted from the JSON.
        // But defensively the formatter must handle "" as "no detail"
        // anyway — otherwise the banner would render "code: " with a
        // dangling colon.
        expect(
            formatImportWarning({ code: 'comments', detail: '' })
        ).toBe('comments')
    })

    it('preserves whitespace and punctuation in the detail verbatim', () => {
        expect(
            formatImportWarning({
                code: 'unsupported-style',
                detail: '  pStyle="MyCustomStyle"  ',
            })
        ).toBe('unsupported-style:   pStyle="MyCustomStyle"  ')
    })
})

describe('importWarningTitle', () => {
    it('reports the count in the title', () => {
        expect(importWarningTitle(1)).toBe('Import warnings (1)')
        expect(importWarningTitle(3)).toBe('Import warnings (3)')
        expect(importWarningTitle(42)).toBe('Import warnings (42)')
    })

    it('still renders for an empty list (banner is hidden upstream)', () => {
        // The component returns null when warnings.length === 0, so this
        // string is never user-visible in practice — but the helper is
        // total, so verify the trivial case.
        expect(importWarningTitle(0)).toBe('Import warnings (0)')
    })
})

describe('ImportWarning type', () => {
    it('accepts a list of typed fixtures via the public interface', () => {
        const warnings: ImportWarning[] = [
            { code: 'unsupported-feature' },
            { code: 'image-inlined', detail: 'data: URI ~120kb' },
            { code: 'comments' },
        ]
        // Maps the formatter over the list — exercises the same code
        // path the component uses inside its .map().
        const lines = warnings.map(formatImportWarning)
        expect(lines).toEqual([
            'unsupported-feature',
            'image-inlined: data: URI ~120kb',
            'comments',
        ])
    })
})
