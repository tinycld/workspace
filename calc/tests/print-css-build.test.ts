import { describe, expect, it } from 'vitest'
import { buildPrintCss } from '../tinycld/calc/lib/print/print-css'
import type { PrintConfig } from '../tinycld/calc/lib/print/types'

// A minimal valid PrintConfig used by tests below; individual cases
// spread overrides over it for the field-under-test.
const baseConfig: PrintConfig = {
    scope: { sheets: 'current', range: 'used' },
    page: { orientation: 'portrait', scaling: 'actual', margins: 'normal' },
    layout: { showHeaders: true, showGridlines: true, repeatRows: null },
}

describe('buildPrintCss — page rules', () => {
    it('emits @page with orientation and margin in inches', () => {
        const out = buildPrintCss({
            ...baseConfig,
            page: { orientation: 'landscape', scaling: 'actual', margins: 'wide' },
        })
        expect(out).toContain('@page { size: landscape; margin: 1in; }')
    })

    it('narrow margins emit 0.25in', () => {
        const out = buildPrintCss({
            ...baseConfig,
            page: { orientation: 'portrait', scaling: 'actual', margins: 'narrow' },
        })
        expect(out).toContain('margin: 0.25in')
    })
})

describe('buildPrintCss — scaling', () => {
    it('actual scaling renders the grid at width: auto', () => {
        const out = buildPrintCss(baseConfig)
        expect(out).toContain('.tinycld-calc-grid')
        expect(out).toMatch(/width:\s*auto/)
    })

    it('fit-width forces the grid to 100% width', () => {
        const out = buildPrintCss({
            ...baseConfig,
            page: { ...baseConfig.page, scaling: 'fit-width' },
        })
        expect(out).toMatch(/width:\s*100%/)
    })

    it('fit-page adds page-break-inside: avoid for the grid', () => {
        const out = buildPrintCss({
            ...baseConfig,
            page: { ...baseConfig.page, scaling: 'fit-page' },
        })
        expect(out).toContain('page-break-inside: avoid')
    })
})

describe('buildPrintCss — headers / gridlines', () => {
    it('hides row/col headers when showHeaders is false', () => {
        const out = buildPrintCss({
            ...baseConfig,
            layout: { ...baseConfig.layout, showHeaders: false },
        })
        // hidden form: a display: none rule scoped to the header classes
        expect(out).toMatch(/\.tinycld-calc-row-h.*display:\s*none/)
    })

    it('shows styled row/col headers when showHeaders is true', () => {
        const out = buildPrintCss(baseConfig)
        // visible form: background-color + font-size for header cells
        expect(out).toMatch(/\.tinycld-calc-row-h.*background-color/)
    })

    it('emits the 1px gridline border on cells when showGridlines is true', () => {
        const out = buildPrintCss(baseConfig)
        expect(out).toMatch(/\.tinycld-calc-grid td.*border:\s*1px solid #ccc/)
    })

    it('omits the gridline border when showGridlines is false', () => {
        const out = buildPrintCss({
            ...baseConfig,
            layout: { ...baseConfig.layout, showGridlines: false },
        })
        expect(out).not.toMatch(/border:\s*1px solid #ccc/)
    })
})

describe('buildPrintCss — cell modifier classes', () => {
    it('emits the full set of boolean modifier rules', () => {
        const out = buildPrintCss(baseConfig)
        for (const cls of [
            'tinycld-calc-cell--bold',
            'tinycld-calc-cell--italic',
            'tinycld-calc-cell--underline',
            'tinycld-calc-cell--strike',
            'tinycld-calc-cell--align-left',
            'tinycld-calc-cell--align-center',
            'tinycld-calc-cell--align-right',
            'tinycld-calc-cell--valign-top',
            'tinycld-calc-cell--valign-middle',
            'tinycld-calc-cell--valign-bottom',
            'tinycld-calc-cell--wrap',
            'tinycld-calc-cell--border-top',
            'tinycld-calc-cell--border-right',
            'tinycld-calc-cell--border-bottom',
            'tinycld-calc-cell--border-left',
        ]) {
            expect(out).toContain(cls)
        }
    })

    it('no longer emits typed attr() rules — open-vocab styles come from inline style="…"', () => {
        const out = buildPrintCss(baseConfig)
        expect(out).not.toContain('attr(data-color')
        expect(out).not.toContain('attr(data-bg')
        expect(out).not.toContain('attr(data-font-size')
        expect(out).not.toContain('attr(data-font-family')
    })
})

describe('buildPrintCss — multi-sheet titles', () => {
    it('emits sheet-title rule with break-before: page for after-first sheets', () => {
        const out = buildPrintCss(baseConfig)
        expect(out).toMatch(/\.tinycld-calc-sheet-title/)
        expect(out).toMatch(/break-before:\s*page/)
    })

    it('overrides the first sheet title to skip the page break', () => {
        const out = buildPrintCss(baseConfig)
        expect(out).toMatch(
            /\.tinycld-calc-sheet:first-of-type \.tinycld-calc-sheet-title.*break-before:\s*avoid/
        )
    })
})
