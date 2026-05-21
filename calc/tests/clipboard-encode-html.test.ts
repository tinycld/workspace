import { describe, expect, it } from 'vitest'
import { FIDELITY_META_NAME, payloadToHtml } from '../tinycld/calc/lib/clipboard/encode-html'
import type { ClipboardPayload } from '../tinycld/calc/lib/clipboard/types'

// payloadToHtml emits the text/html clipboard form. It must:
//   - embed the fidelity marker so a same-process paste back into calc
//     can recover the original ClipboardPayload via the in-memory store
//   - emit data-tinycld-{kind,raw,formula} attributes so a cross-tab
//     calc → calc paste recovers fidelity from the HTML alone
//   - emit inline CSS so receivers like Sheets/Excel pick up styling
//   - HTML-escape all interpolated values (no XSS in clipboard text)

function p(cells: ClipboardPayload['cells']): ClipboardPayload {
    return {
        rows: cells.length,
        cols: cells[0].length,
        cells,
        sourceAnchor: { row: 1, col: 1 },
    }
}

describe('payloadToHtml — structure', () => {
    it('begins with the fidelity meta marker carrying the given id', () => {
        const html = payloadToHtml(p([[{ kind: 'string', raw: 'x' }]]), 'marker-abc')
        expect(html).toContain(`<meta name="${FIDELITY_META_NAME}" content="marker-abc">`)
    })

    it('emits a <table> with one <tr> per row and one <td> per column', () => {
        const html = payloadToHtml(
            p([
                [
                    { kind: 'string', raw: 'a' },
                    { kind: 'string', raw: 'b' },
                ],
                [
                    { kind: 'string', raw: 'c' },
                    { kind: 'string', raw: 'd' },
                ],
            ]),
            'm'
        )
        // 2 rows × 2 cols → 2 <tr> and 4 <td>
        expect(html.match(/<tr>/g)?.length).toBe(2)
        expect(html.match(/<td /g)?.length).toBe(4)
    })

    it('renders the cell display text as the td body', () => {
        const html = payloadToHtml(p([[{ kind: 'number', raw: 42 }]]), 'm')
        expect(html).toContain('>42</td>')
    })

    it('renders the cached scalar (not formula text) as the td body', () => {
        const html = payloadToHtml(p([[{ kind: 'formula', raw: 7, formula: '=3+4' }]]), 'm')
        expect(html).toContain('>7</td>')
        expect(html).toContain('data-tinycld-formula="=3+4"')
    })
})

describe('payloadToHtml — data-tinycld-* attributes', () => {
    it('emits data-tinycld-kind on every cell', () => {
        const html = payloadToHtml(p([[{ kind: 'string', raw: 'x' }]]), 'm')
        expect(html).toContain('data-tinycld-kind="string"')
    })

    it('emits data-tinycld-raw with the underlying scalar', () => {
        const html = payloadToHtml(p([[{ kind: 'number', raw: 42 }]]), 'm')
        expect(html).toContain('data-tinycld-raw="42"')
    })

    it('omits data-tinycld-raw for cells whose raw is null', () => {
        const html = payloadToHtml(p([[{ kind: 'formula', raw: null, formula: '=A1' }]]), 'm')
        expect(html).not.toContain('data-tinycld-raw')
    })

    it('emits data-tinycld-formula only when a formula is present', () => {
        const plain = payloadToHtml(p([[{ kind: 'string', raw: 'x' }]]), 'm')
        expect(plain).not.toContain('data-tinycld-formula')
        const formula = payloadToHtml(p([[{ kind: 'formula', raw: 5, formula: '=A1' }]]), 'm')
        expect(formula).toContain('data-tinycld-formula="=A1"')
    })
})

describe('payloadToHtml — inline styling for receivers', () => {
    it('emits font-weight:bold for cells with bold font', () => {
        const html = payloadToHtml(
            p([
                [
                    {
                        kind: 'string',
                        raw: 'x',
                        style: { font: { bold: true } },
                    },
                ],
            ]),
            'm'
        )
        expect(html).toContain('font-weight:bold')
    })

    it('emits font-style:italic for italics', () => {
        const html = payloadToHtml(
            p([
                [
                    {
                        kind: 'string',
                        raw: 'x',
                        style: { font: { italic: true } },
                    },
                ],
            ]),
            'm'
        )
        expect(html).toContain('font-style:italic')
    })

    it('emits color for font colour with a # prefix', () => {
        const html = payloadToHtml(
            p([
                [
                    {
                        kind: 'string',
                        raw: 'x',
                        style: { font: { color: 'FF0000' } },
                    },
                ],
            ]),
            'm'
        )
        expect(html).toContain('color:#FF0000')
    })

    it('strips the alpha byte from 8-digit hex colours', () => {
        const html = payloadToHtml(
            p([
                [
                    {
                        kind: 'string',
                        raw: 'x',
                        style: { font: { color: 'FF112233' } },
                    },
                ],
            ]),
            'm'
        )
        expect(html).toContain('color:#112233')
    })

    it('emits background-color from fill.fgColor', () => {
        const html = payloadToHtml(
            p([
                [
                    {
                        kind: 'string',
                        raw: 'x',
                        style: { fill: { fgColor: 'AABBCC' } },
                    },
                ],
            ]),
            'm'
        )
        expect(html).toContain('background-color:#AABBCC')
    })

    it('emits text-align from alignment.horizontal', () => {
        const html = payloadToHtml(
            p([
                [
                    {
                        kind: 'string',
                        raw: 'x',
                        style: { alignment: { horizontal: 'right' } },
                    },
                ],
            ]),
            'm'
        )
        expect(html).toContain('text-align:right')
    })

    it('omits the style attribute when no style is present', () => {
        const html = payloadToHtml(p([[{ kind: 'string', raw: 'x' }]]), 'm')
        expect(html).not.toContain('style="')
    })
})

describe('payloadToHtml — HTML escaping', () => {
    it('escapes HTML special chars in cell text', () => {
        const html = payloadToHtml(p([[{ kind: 'string', raw: '<b>&"</b>' }]]), 'm')
        expect(html).toContain('&lt;b&gt;&amp;&quot;&lt;/b&gt;')
    })

    it('escapes the formula attribute', () => {
        const html = payloadToHtml(
            p([
                [
                    {
                        kind: 'formula',
                        raw: 'x',
                        formula: '=IF(A1="<>",1,0)',
                    },
                ],
            ]),
            'm'
        )
        expect(html).toContain('data-tinycld-formula="=IF(A1=&quot;&lt;&gt;&quot;,1,0)"')
    })

    it('escapes the marker id', () => {
        const html = payloadToHtml(p([[{ kind: 'string', raw: 'x' }]]), 'a"b')
        expect(html).toContain('content="a&quot;b"')
    })
})
