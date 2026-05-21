import { describe, expect, it } from 'vitest'
import { parseCsv } from '../tinycld/calc/lib/csv/decode'

describe('parseCsv — RFC 4180 quoting', () => {
    it('parses a simple comma-separated grid', () => {
        const rows = parseCsv('a,b,c\r\nd,e,f')
        expect(rows).toEqual([
            ['a', 'b', 'c'],
            ['d', 'e', 'f'],
        ])
    })

    it('parses quoted fields with embedded commas', () => {
        const rows = parseCsv('"a,b",c\r\nd,e')
        expect(rows).toEqual([
            ['a,b', 'c'],
            ['d', 'e'],
        ])
    })

    it('parses doubled inner quotes inside quoted fields', () => {
        const rows = parseCsv('"He said ""hi""",ok')
        expect(rows).toEqual([['He said "hi"', 'ok']])
    })

    it('parses quoted fields with embedded newlines as a single cell', () => {
        const rows = parseCsv('"line1\nline2",ok\r\nnext,row')
        expect(rows).toEqual([
            ['line1\nline2', 'ok'],
            ['next', 'row'],
        ])
    })

    it('strips the UTF-8 BOM at the start', () => {
        const rows = parseCsv('﻿a,b\r\nc,d')
        expect(rows).toEqual([
            ['a', 'b'],
            ['c', 'd'],
        ])
    })

    it('handles LF-only line endings', () => {
        const rows = parseCsv('a,b\nc,d\ne,f')
        expect(rows).toEqual([
            ['a', 'b'],
            ['c', 'd'],
            ['e', 'f'],
        ])
    })

    it('handles mixed CRLF and LF line endings', () => {
        const rows = parseCsv('a,b\r\nc,d\ne,f')
        expect(rows).toEqual([
            ['a', 'b'],
            ['c', 'd'],
            ['e', 'f'],
        ])
    })

    it('right-pads short rows with empty strings', () => {
        const rows = parseCsv('a,b,c\nd,e\nf')
        expect(rows).toEqual([
            ['a', 'b', 'c'],
            ['d', 'e', ''],
            ['f', '', ''],
        ])
    })

    it('drops a trailing empty row produced by a final newline', () => {
        const rows = parseCsv('a,b\r\nc,d\r\n')
        expect(rows).toEqual([
            ['a', 'b'],
            ['c', 'd'],
        ])
    })
})

describe('parseCsv — delimiter selection', () => {
    it('auto-detects comma when commas dominate', () => {
        const rows = parseCsv('a,b,c\r\nd,e,f')
        expect(rows[0]).toEqual(['a', 'b', 'c'])
    })

    it('auto-detects tab when tabs dominate', () => {
        const rows = parseCsv('a\tb\tc\nd\te\tf')
        expect(rows[0]).toEqual(['a', 'b', 'c'])
    })

    it('auto-detects semicolon when semicolons dominate', () => {
        const rows = parseCsv('a;b;c\nd;e;f')
        expect(rows[0]).toEqual(['a', 'b', 'c'])
    })

    it('breaks ties in the order comma > tab > semicolon', () => {
        // Equal counts of all three on the sampled line.
        const rows = parseCsv('a,b\tc;d')
        // Comma wins, so the row splits on commas only.
        expect(rows[0]).toEqual(['a', 'b\tc;d'])
    })

    it('honors an explicit delimiter override even when another wins by count', () => {
        const rows = parseCsv('a,b,c;d', { delimiter: ';' })
        expect(rows[0]).toEqual(['a,b,c', 'd'])
    })

    it('ignores delimiters inside quoted fields when sampling', () => {
        // Many tabs inside a quoted field, only commas outside.
        const rows = parseCsv('"a\tb\tc",d,e')
        expect(rows[0]).toEqual(['a\tb\tc', 'd', 'e'])
    })

    it('returns an empty array for empty input', () => {
        expect(parseCsv('')).toEqual([])
    })
})
