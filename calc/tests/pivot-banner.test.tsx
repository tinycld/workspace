// Tests for the PivotBanner component's message-mapping helper. Our
// vitest setup runs in a node environment without jsdom or
// @testing-library/react, so we exercise the pure `bannerLinesFor`
// helper directly (matching the __internals pattern used by the
// pivot hooks).
//
// The helper lives in its own .ts module (pivot-banner-lines.ts)
// rather than in PivotBanner.tsx so the test transformer doesn't
// have to follow `import 'react-native'` into a Flow-typed module
// that Rollup can't parse. vi.mock('react-native', ...) intercepts
// at runtime, not during the parse phase.
//
// This file uses the .test.tsx extension on purpose: the pre-flight
// step that landed before Task 1 added .test.tsx globs to
// vitest.config.ts and playwright.config.ts so JSX-bearing tests
// can be discovered. Keeping at least one .test.tsx in the suite
// keeps that wiring honest even when the tests themselves don't
// happen to render React.
//
// What we verify:
//   - the banner title is the fixed "can't render" copy and not the
//     error message itself (mistakes here would leak engine jargon
//     into the title bar above the body)
//   - the banner body is the error's `message` field verbatim — the
//     engine owns the per-code wording (see lib/pivot/source-read.ts
//     and lib/pivot/index.ts), the banner only displays it
//   - every PivotErrorCode round-trips through the helper (catches
//     a future code being added without the helper noticing)

import { describe, expect, it } from 'vitest'
import { bannerLinesFor } from '../tinycld/calc/components/pivot/pivot-banner-lines'
import type { PivotError, PivotErrorCode } from '../tinycld/calc/lib/pivot'

function makeError(code: PivotErrorCode, message: string): PivotError {
    return { ok: false, code, message }
}

describe('PivotBanner / bannerLinesFor', () => {
    it("uses the fixed \"can't render\" title regardless of error code", () => {
        const codes: PivotErrorCode[] = [
            'missing-source-sheet',
            'malformed-range',
            'duplicate-headers',
            'zero-data-rows',
            'no-values',
        ]
        for (const code of codes) {
            const lines = bannerLinesFor(makeError(code, 'irrelevant body'))
            expect(lines.title).toBe("Pivot table can't render")
        }
    })

    it("passes the error's message through verbatim as the body", () => {
        const lines = bannerLinesFor(
            makeError(
                'missing-source-sheet',
                'Source sheet "Numbers" not found. Update the range or recreate the pivot.'
            )
        )
        expect(lines.body).toBe(
            'Source sheet "Numbers" not found. Update the range or recreate the pivot.'
        )
    })

    it('preserves empty-string bodies (no fallback) so engine wording stays canonical', () => {
        const lines = bannerLinesFor(makeError('no-values', ''))
        expect(lines.body).toBe('')
    })

    it('returns plain string fields (no React nodes) so tests can assert by equality', () => {
        const lines = bannerLinesFor(makeError('malformed-range', 'bad'))
        expect(typeof lines.title).toBe('string')
        expect(typeof lines.body).toBe('string')
    })
})
