import { describe, expect, it } from 'vitest'
import { payloadToTsv } from '../tinycld/calc/lib/clipboard/encode-tsv'
import type { ClipboardPayload } from '../tinycld/calc/lib/clipboard/types'

// payloadToTsv emits the universally-portable text/plain form of a
// ClipboardPayload. RFC4180-style quoting: cells that contain tab,
// newline, or double-quote get wrapped in double quotes with embedded
// double-quotes doubled. Cells without those characters emit
// verbatim. Rows separated by \r\n (Sheets/Excel both write CRLF;
// receivers tolerate \n).
//
// For non-formula cells we emit the formatCell(kind, raw) display
// string (numbers, booleans, dates render canonically). Formula cells
// emit the cached scalar's display string — matching Sheets' behavior
// where copying a SUM cell to a text editor pastes the computed
// number, not the formula. The fidelity-preserving form for formulas
// lives in the HTML payload via the data-tinycld-formula attribute.

function p(cells: ClipboardPayload['cells']): ClipboardPayload {
    return {
        rows: cells.length,
        cols: cells[0].length,
        cells,
        sourceAnchor: { row: 1, col: 1 },
    }
}

describe('payloadToTsv — simple cases', () => {
    it('emits a single string cell verbatim', () => {
        expect(payloadToTsv(p([[{ kind: 'string', raw: 'hello' }]]))).toBe('hello')
    })

    it('joins columns with a tab and rows with CRLF', () => {
        expect(
            payloadToTsv(
                p([
                    [
                        { kind: 'string', raw: 'a' },
                        { kind: 'string', raw: 'b' },
                    ],
                    [
                        { kind: 'string', raw: 'c' },
                        { kind: 'string', raw: 'd' },
                    ],
                ])
            )
        ).toBe('a\tb\r\nc\td')
    })

    it('renders numbers and booleans via formatCell', () => {
        expect(
            payloadToTsv(
                p([
                    [
                        { kind: 'number', raw: 42 },
                        { kind: 'boolean', raw: true },
                    ],
                ])
            )
        ).toBe('42\tTRUE')
    })

    it('emits blank cells as empty strings', () => {
        expect(
            payloadToTsv(
                p([
                    [
                        { kind: 'string', raw: '' },
                        { kind: 'string', raw: 'x' },
                    ],
                ])
            )
        ).toBe('\tx')
    })
})

describe('payloadToTsv — RFC4180 quoting', () => {
    it('quotes a cell that contains a tab', () => {
        expect(payloadToTsv(p([[{ kind: 'string', raw: 'a\tb' }]]))).toBe('"a\tb"')
    })

    it('quotes a cell that contains a newline', () => {
        expect(payloadToTsv(p([[{ kind: 'string', raw: 'line1\nline2' }]]))).toBe('"line1\nline2"')
    })

    it('quotes a cell that contains a CR', () => {
        expect(payloadToTsv(p([[{ kind: 'string', raw: 'a\rb' }]]))).toBe('"a\rb"')
    })

    it('quotes a cell that contains a double-quote and doubles the quote', () => {
        expect(payloadToTsv(p([[{ kind: 'string', raw: 'say "hi"' }]]))).toBe('"say ""hi"""')
    })

    it('does not quote ordinary text', () => {
        expect(payloadToTsv(p([[{ kind: 'string', raw: 'plain text' }]]))).toBe('plain text')
    })
})

describe('payloadToTsv — formula cells', () => {
    it('emits the cached scalar via formatCell (not the formula text)', () => {
        expect(
            payloadToTsv(
                p([
                    [
                        {
                            kind: 'formula',
                            raw: 7,
                            formula: '=3+4',
                        },
                    ],
                ])
            )
        ).toBe('7')
    })

    it('emits an empty cell for an unevaluated formula (raw=null)', () => {
        expect(
            payloadToTsv(
                p([
                    [
                        {
                            kind: 'formula',
                            raw: null,
                            formula: '=A1',
                        },
                    ],
                ])
            )
        ).toBe('')
    })
})
