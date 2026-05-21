import { describe, expect, it } from 'vitest'
import { htmlToPayload } from '../tinycld/calc/lib/clipboard/decode-html'
import { payloadToHtml } from '../tinycld/calc/lib/clipboard/encode-html'
import type { ClipboardPayload } from '../tinycld/calc/lib/clipboard/types'

// htmlToPayload contract: parse the text/html clipboard form into a
// rectangular ClipboardPayload. Three input shapes matter:
//   1. Our own encoder's HTML (data-tinycld-* round-trip).
//   2. Google Sheets HTML (data-sheets-formula + inline style).
//   3. Plain <table> HTML from any other producer.
//
// Returns null when no <table> is found so the caller can fall back to
// TSV parsing.

function p(cells: ClipboardPayload['cells']): ClipboardPayload {
    return {
        rows: cells.length,
        cols: cells[0].length,
        cells,
        sourceAnchor: { row: 1, col: 1 },
    }
}

describe('htmlToPayload — own-encoder round trip', () => {
    it('recovers a 2×2 string grid', () => {
        const source = p([
            [
                { kind: 'string', raw: 'a' },
                { kind: 'string', raw: 'b' },
            ],
            [
                { kind: 'string', raw: 'c' },
                { kind: 'string', raw: 'd' },
            ],
        ])
        const html = payloadToHtml(source, 'mk-123')
        const out = htmlToPayload(html)
        expect(out).not.toBeNull()
        expect(out?.markerId).toBe('mk-123')
        expect(out?.payload.rows).toBe(2)
        expect(out?.payload.cols).toBe(2)
        expect(out?.payload.cells[0][0].raw).toBe('a')
        expect(out?.payload.cells[1][1].raw).toBe('d')
    })

    it('recovers a number cell with its kind', () => {
        const source = p([[{ kind: 'number', raw: 42 }]])
        const html = payloadToHtml(source, 'm')
        const out = htmlToPayload(html)
        expect(out?.payload.cells[0][0]).toMatchObject({ kind: 'number', raw: 42 })
    })

    it('recovers a boolean cell', () => {
        const source = p([[{ kind: 'boolean', raw: true }]])
        const html = payloadToHtml(source, 'm')
        expect(htmlToPayload(html)?.payload.cells[0][0]).toMatchObject({
            kind: 'boolean',
            raw: true,
        })
    })

    it('recovers a formula cell with its formula text', () => {
        const source = p([
            [
                {
                    kind: 'formula',
                    raw: 7,
                    formula: '=A1+1',
                },
            ],
        ])
        const html = payloadToHtml(source, 'm')
        const out = htmlToPayload(html)
        expect(out?.payload.cells[0][0]).toMatchObject({
            kind: 'formula',
            formula: '=A1+1',
            raw: 7,
        })
    })

    it('recovers font.bold from inline style', () => {
        const source = p([
            [
                {
                    kind: 'string',
                    raw: 'x',
                    style: { font: { bold: true } },
                },
            ],
        ])
        const html = payloadToHtml(source, 'm')
        expect(htmlToPayload(html)?.payload.cells[0][0].style).toMatchObject({
            font: { bold: true },
        })
    })

    it('recovers cells containing HTML special chars', () => {
        const source = p([[{ kind: 'string', raw: '<b>&"</b>' }]])
        const html = payloadToHtml(source, 'm')
        const out = htmlToPayload(html)
        expect(out?.payload.cells[0][0].raw).toBe('<b>&"</b>')
    })
})

describe('htmlToPayload — marker detection', () => {
    it('returns null marker when no meta tag is present', () => {
        const html = '<table><tr><td>x</td></tr></table>'
        expect(htmlToPayload(html)?.markerId).toBeNull()
    })

    it('extracts marker regardless of attribute order', () => {
        const html =
            '<meta content="mk-xyz" name="x-tinycld-calc"><table><tr><td>x</td></tr></table>'
        expect(htmlToPayload(html)?.markerId).toBe('mk-xyz')
    })

    it('tolerates single-quoted attributes', () => {
        const html = "<meta name='x-tinycld-calc' content='mk-q'><table><tr><td>x</td></tr></table>"
        expect(htmlToPayload(html)?.markerId).toBe('mk-q')
    })
})

describe('htmlToPayload — foreign producer fixtures', () => {
    it('parses a Google-Sheets-style <table> with data-sheets-formula', () => {
        const html = `
<google-sheets-html-origin>
<style>...</style>
<table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1">
  <tr>
    <td data-sheets-value='{"1":3,"3":7}' data-sheets-formula="=3+4">7</td>
    <td>plain</td>
  </tr>
</table>
        `
        const out = htmlToPayload(html)
        expect(out).not.toBeNull()
        expect(out?.payload.cells[0][0]).toMatchObject({ formula: '=3+4' })
        expect(out?.payload.cells[0][1].raw).toBe('plain')
    })

    it('parses an Excel-style <!--StartFragment--> wrapper', () => {
        const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"><body>
<!--StartFragment-->
<table><tr><td style="font-weight:700">bold</td><td>plain</td></tr></table>
<!--EndFragment-->
</body></html>
        `
        const out = htmlToPayload(html)
        expect(out?.payload.cells[0][0].style?.font?.bold).toBe(true)
        expect(out?.payload.cells[0][1].raw).toBe('plain')
    })

    it('parses background-color from inline style', () => {
        const html = '<table><tr><td style="background-color: #FFCC00">x</td></tr></table>'
        const out = htmlToPayload(html)
        expect(out?.payload.cells[0][0].style?.fill?.fgColor).toBe('FFCC00')
    })

    it('converts rgb() to hex on the way in', () => {
        const html = '<table><tr><td style="color: rgb(255, 0, 0)">x</td></tr></table>'
        const out = htmlToPayload(html)
        expect(out?.payload.cells[0][0].style?.font?.color).toBe('FF0000')
    })

    it('pads short rows to make the grid rectangular', () => {
        const html = '<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td></tr></table>'
        const out = htmlToPayload(html)
        expect(out?.payload.rows).toBe(2)
        expect(out?.payload.cols).toBe(3)
        expect(out?.payload.cells[1]).toEqual([
            { kind: 'string', raw: 'd' },
            { kind: 'string', raw: '' },
            { kind: 'string', raw: '' },
        ])
    })

    it('returns null when no <table> is present', () => {
        expect(htmlToPayload('<p>not a table</p>')).toBeNull()
    })

    it('returns null for empty input', () => {
        expect(htmlToPayload('')).toBeNull()
    })
})
