import { describe, expect, it } from 'vitest'
import { tsvToPayload } from '../tinycld/calc/lib/clipboard/decode-tsv'

// tsvToPayload contract: parse TSV (Sheets / Excel / text-editor input)
// into a dense rectangular ClipboardPayload of typed-string cells. The
// caller re-types each cell via inferCellInput at write time, so
// numeric / date / boolean re-coercion happens at the destination —
// not here. Rectangularity: when rows have differing column counts,
// pad with empty strings up to the widest row.
//
// Quoting rules (RFC 4180): a cell wrapped in `"…"` may contain tabs,
// newlines, and `""`-escaped quotes. The outer quotes don't appear in
// the parsed value.

describe('tsvToPayload — simple grids', () => {
    it('parses a single cell', () => {
        const out = tsvToPayload('hello')
        expect(out.rows).toBe(1)
        expect(out.cols).toBe(1)
        expect(out.cells[0][0]).toEqual({ kind: 'string', raw: 'hello' })
    })

    it('splits on tabs and CRLF', () => {
        const out = tsvToPayload('a\tb\r\nc\td')
        expect(out.cells).toEqual([
            [
                { kind: 'string', raw: 'a' },
                { kind: 'string', raw: 'b' },
            ],
            [
                { kind: 'string', raw: 'c' },
                { kind: 'string', raw: 'd' },
            ],
        ])
    })

    it('tolerates LF-only line separators (Unix text editors)', () => {
        const out = tsvToPayload('a\tb\nc\td')
        expect(out.rows).toBe(2)
        expect(out.cells[1][1]).toEqual({ kind: 'string', raw: 'd' })
    })

    it('pads short rows with empty cells to match the widest row', () => {
        // Row 1 has 3 cells, row 2 has 1 cell. Output should be 2x3.
        const out = tsvToPayload('a\tb\tc\r\nd')
        expect(out.rows).toBe(2)
        expect(out.cols).toBe(3)
        expect(out.cells[1]).toEqual([
            { kind: 'string', raw: 'd' },
            { kind: 'string', raw: '' },
            { kind: 'string', raw: '' },
        ])
    })

    it('preserves empty cells in the middle of a row', () => {
        const out = tsvToPayload('a\t\tc')
        expect(out.cells[0]).toEqual([
            { kind: 'string', raw: 'a' },
            { kind: 'string', raw: '' },
            { kind: 'string', raw: 'c' },
        ])
    })

    it('returns an empty 0x0 payload for empty input', () => {
        const out = tsvToPayload('')
        expect(out.rows).toBe(0)
        expect(out.cols).toBe(0)
        expect(out.cells).toEqual([])
    })
})

describe('tsvToPayload — RFC4180 quoting', () => {
    it('parses a quoted cell containing a tab', () => {
        const out = tsvToPayload('"a\tb"\tc')
        expect(out.cells[0]).toEqual([
            { kind: 'string', raw: 'a\tb' },
            { kind: 'string', raw: 'c' },
        ])
    })

    it('parses a quoted cell containing a newline', () => {
        const out = tsvToPayload('"a\nb"\tc')
        expect(out.cells[0]).toEqual([
            { kind: 'string', raw: 'a\nb' },
            { kind: 'string', raw: 'c' },
        ])
    })

    it('parses a quoted cell with escaped double-quotes', () => {
        const out = tsvToPayload('"say ""hi"""\tx')
        expect(out.cells[0]).toEqual([
            { kind: 'string', raw: 'say "hi"' },
            { kind: 'string', raw: 'x' },
        ])
    })

    it('tolerates unterminated trailing quote by treating the rest as one cell', () => {
        // Defensive: malformed input shouldn't crash. The unterminated
        // quote consumes the remainder.
        const out = tsvToPayload('"unterminated')
        expect(out.cells[0][0].raw).toBe('unterminated')
    })

    it('preserves CRLF inside a quoted cell as-is', () => {
        const out = tsvToPayload('"line1\r\nline2"\tnext')
        expect(out.cells[0][0].raw).toBe('line1\r\nline2')
    })
})
