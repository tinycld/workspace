import { describe, expect, it } from 'vitest'
import { inferCellInput } from '../tinycld/calc/lib/cell-input'

// inferCellInput is the pure classifier the editor commit path runs
// over the user's typed text. Rules apply in order: apostrophe-prefix,
// equals-prefix, boolean, ISO date, number, otherwise string.

describe('inferCellInput', () => {
    describe('empty input', () => {
        it('returns kind=string raw="" so the caller can delete', () => {
            const result = inferCellInput('')
            expect(result).toEqual({ kind: 'string', raw: '', display: '' })
        })
    })

    describe('apostrophe prefix forces string', () => {
        it("strips a single leading ' and stores the rest as a string", () => {
            const result = inferCellInput("'42")
            expect(result.kind).toBe('string')
            expect(result.raw).toBe('42')
            expect(result.display).toBe('42')
        })

        it("'TRUE is a string, not a boolean", () => {
            expect(inferCellInput("'TRUE")).toEqual({
                kind: 'string',
                raw: 'TRUE',
                display: 'TRUE',
            })
        })

        it("'2024-01-15 is a string, not a date", () => {
            expect(inferCellInput("'2024-01-15")).toEqual({
                kind: 'string',
                raw: '2024-01-15',
                display: '2024-01-15',
            })
        })

        it("'=A1+B1 is a string, not a formula", () => {
            expect(inferCellInput("'=A1+B1")).toEqual({
                kind: 'string',
                raw: '=A1+B1',
                display: '=A1+B1',
            })
        })

        it('two leading apostrophes only strip one (the second is preserved as a literal char)', () => {
            // Excel's convention: only the first ' acts as a marker.
            expect(inferCellInput("''hi")).toEqual({ kind: 'string', raw: "'hi", display: "'hi" })
        })

        it("a lone apostrophe yields an empty string (kind='string', raw='')", () => {
            expect(inferCellInput("'")).toEqual({ kind: 'string', raw: '', display: '' })
        })
    })

    describe('equals prefix means formula', () => {
        it('captures the full text as formula, raw stays null until evaluator caches', () => {
            const result = inferCellInput('=A1+B1')
            expect(result.kind).toBe('formula')
            expect(result.raw).toBeNull()
            expect(result.formula).toBe('=A1+B1')
            expect(result.display).toBe('=A1+B1')
        })

        it("'=' alone is a one-character formula (no evaluator pre-validation here)", () => {
            const result = inferCellInput('=')
            expect(result.kind).toBe('formula')
            expect(result.formula).toBe('=')
        })
    })

    describe('booleans', () => {
        it.each([
            ['TRUE', true],
            ['FALSE', false],
            ['true', true],
            ['false', false],
            ['True', true],
            ['False', false],
        ])('%s -> boolean %s', (text, expected) => {
            const result = inferCellInput(text)
            expect(result.kind).toBe('boolean')
            expect(result.raw).toBe(expected)
            expect(result.display).toBe(expected ? 'TRUE' : 'FALSE')
        })

        it('trims whitespace before boolean check', () => {
            const result = inferCellInput('  TRUE  ')
            expect(result.kind).toBe('boolean')
            expect(result.raw).toBe(true)
        })

        it('"truthy" or "yes" are NOT booleans (string)', () => {
            expect(inferCellInput('truthy').kind).toBe('string')
            expect(inferCellInput('yes').kind).toBe('string')
        })
    })

    describe('ISO dates', () => {
        it('yyyy-mm-dd -> kind=date, raw normalizes to ISO date', () => {
            const result = inferCellInput('2024-01-15')
            expect(result.kind).toBe('date')
            expect(result.raw).toBe('2024-01-15')
            expect(result.display).toBe('2024-01-15')
        })

        it('yyyy-mm-dd with time -> kind=date, raw normalizes to full ISO', () => {
            const result = inferCellInput('2024-01-15T13:30:00Z')
            expect(result.kind).toBe('date')
            expect(typeof result.raw).toBe('string')
            expect(result.raw).toMatch(/^2024-01-15T13:30:00/)
        })

        it('rejects an invalid ISO date (Date constructor returns NaN)', () => {
            // 2024-13-40 looks ISO-shaped but isn't a real date.
            const result = inferCellInput('2024-13-40')
            // Falls through to string when the parse fails.
            expect(result.kind).toBe('string')
        })

        it('does NOT accept localized date formats (M/D/YYYY)', () => {
            expect(inferCellInput('1/15/2024').kind).toBe('string')
            expect(inferCellInput('15.1.2024').kind).toBe('string')
        })
    })

    describe('numbers', () => {
        it.each([
            ['42', 42],
            ['-7', -7],
            ['+3', 3],
            ['0', 0],
            ['3.14', 3.14],
            ['-0.5', -0.5],
            ['.25', 0.25],
            ['1e5', 1e5],
            ['1.5E-3', 1.5e-3],
        ])('%s -> number %s', (text, expected) => {
            const result = inferCellInput(text)
            expect(result.kind).toBe('number')
            expect(result.raw).toBe(expected)
        })

        it('trims whitespace before parsing', () => {
            expect(inferCellInput('  42  ').raw).toBe(42)
        })

        it('rejects thousands separators (locale-specific input)', () => {
            expect(inferCellInput('1,234.56').kind).toBe('string')
        })

        it('rejects "12abc" garbage tail', () => {
            expect(inferCellInput('12abc').kind).toBe('string')
        })

        it('rejects bare "Infinity" and "NaN"', () => {
            expect(inferCellInput('Infinity').kind).toBe('string')
            expect(inferCellInput('NaN').kind).toBe('string')
        })

        it('-0 round-trips as a number', () => {
            const result = inferCellInput('-0')
            expect(result.kind).toBe('number')
            expect(Object.is(result.raw, -0)).toBe(true)
        })
    })

    describe('strings (the catch-all)', () => {
        it('preserves leading/trailing whitespace for plain text (no trim)', () => {
            const result = inferCellInput('  hello  ')
            expect(result.kind).toBe('string')
            expect(result.raw).toBe('  hello  ')
        })

        it('emoji and unicode pass through unmodified', () => {
            const result = inferCellInput('☃ snow')
            expect(result.kind).toBe('string')
            expect(result.raw).toBe('☃ snow')
        })

        it('accidental ISO-look-alike that fails parses lands as string', () => {
            expect(inferCellInput('2024-99-99').kind).toBe('string')
        })
    })
})
