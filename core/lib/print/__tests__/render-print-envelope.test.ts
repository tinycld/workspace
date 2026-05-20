import { renderPrintEnvelope } from '@tinycld/core/lib/print/render-print-envelope'
import { describe, expect, it } from 'vitest'

describe('renderPrintEnvelope', () => {
    it('wraps a fragment in a printable HTML document', () => {
        const out = renderPrintEnvelope('<p>hi</p>', 'body { margin: 0; }')
        expect(out.startsWith('<!doctype html>')).toBe(true)
        expect(out).toContain('<style>\nbody { margin: 0; }\n</style>')
        expect(out).toContain('<body>\n<p>hi</p>\n</body>')
        expect(out.endsWith('</html>')).toBe(true)
    })

    it('emits a charset and title in the head', () => {
        const out = renderPrintEnvelope('<span/>', '')
        expect(out).toContain('<meta charset="utf-8">')
        expect(out).toContain('<title>Print</title>')
    })

    it('passes through CSS verbatim (server is responsible for sanitization upstream)', () => {
        const css = '@page { size: letter; margin: 0.5in; }'
        const out = renderPrintEnvelope('', css)
        expect(out).toContain(css)
    })

    it('passes through HTML fragment verbatim (server is responsible for sanitization)', () => {
        const fragment = '<section class="tinycld-calc"><table></table></section>'
        const out = renderPrintEnvelope(fragment, '')
        expect(out).toContain(fragment)
    })

    it('is deterministic for the same inputs', () => {
        const a = renderPrintEnvelope('<p>x</p>', 'p{color:red}')
        const b = renderPrintEnvelope('<p>x</p>', 'p{color:red}')
        expect(a).toBe(b)
    })
})
