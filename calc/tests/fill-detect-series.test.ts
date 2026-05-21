import { describe, expect, it } from 'vitest'
import type { ClipboardCell } from '../tinycld/calc/lib/clipboard/types'
import { detectSeries, projectSeries } from '../tinycld/calc/lib/fill/detect-series'

// detectSeries / projectSeries — the pure pattern detector and projection
// helper that drives the fill handle. Detection rules apply in order:
// empty/mixed → copy; numeric → linear-number; date → linear-date;
// formula → linear-formula; strings try suffix-int, then month, then
// weekday, then copy. Projection extrapolates beyond the source; copy
// cycles modulo source length; month/weekday wrap around.

const num = (n: number): ClipboardCell => ({ kind: 'number', raw: n })
const str = (s: string): ClipboardCell => ({ kind: 'string', raw: s })
const blank: ClipboardCell = { kind: 'string', raw: '' }
const dateCell = (iso: string): ClipboardCell => ({ kind: 'date', raw: iso })
const formula = (text: string): ClipboardCell => ({ kind: 'formula', raw: null, formula: text })
const bool = (b: boolean): ClipboardCell => ({ kind: 'boolean', raw: b })

describe('detectSeries — fallback / copy paths', () => {
    it('empty source → copy', () => {
        expect(detectSeries([])).toEqual({ kind: 'copy' })
    })

    it('all empty cells → copy', () => {
        expect(detectSeries([blank, blank, blank])).toEqual({ kind: 'copy' })
    })

    it('mixed kinds (number, string) → copy', () => {
        expect(detectSeries([num(1), str('x')])).toEqual({ kind: 'copy' })
    })

    it('mixed kinds (number, date) → copy', () => {
        expect(detectSeries([num(1), dateCell('2024-01-01')])).toEqual({ kind: 'copy' })
    })

    it('mixed kinds (formula, number) → copy', () => {
        expect(detectSeries([formula('=A1'), num(2)])).toEqual({ kind: 'copy' })
    })

    it('mixed kinds (boolean, string) → copy', () => {
        expect(detectSeries([bool(true), str('foo')])).toEqual({ kind: 'copy' })
    })

    it('booleans alone → copy (not a recognized linear family)', () => {
        expect(detectSeries([bool(true), bool(false)])).toEqual({ kind: 'copy' })
    })
})

describe('detectSeries — linear numeric', () => {
    it('single-cell numeric → copy (Sheets behavior)', () => {
        expect(detectSeries([num(1)])).toEqual({ kind: 'copy' })
    })

    it('1,2 → linear-number {start:1, step:1}', () => {
        expect(detectSeries([num(1), num(2)])).toEqual({
            kind: 'linear-number',
            start: 1,
            step: 1,
        })
    })

    it('5,10 → linear-number {start:5, step:5}', () => {
        expect(detectSeries([num(5), num(10)])).toEqual({
            kind: 'linear-number',
            start: 5,
            step: 5,
        })
    })

    it('5,10,15 → linear-number {start:5, step:5}', () => {
        expect(detectSeries([num(5), num(10), num(15)])).toEqual({
            kind: 'linear-number',
            start: 5,
            step: 5,
        })
    })

    it('5,5,5 → linear-number {step:0}', () => {
        expect(detectSeries([num(5), num(5), num(5)])).toEqual({
            kind: 'linear-number',
            start: 5,
            step: 0,
        })
    })

    it('1,2,4 → copy (no geometric inference)', () => {
        expect(detectSeries([num(1), num(2), num(4)])).toEqual({ kind: 'copy' })
    })

    it('1,3,5 → linear-number {step:2}', () => {
        expect(detectSeries([num(1), num(3), num(5)])).toEqual({
            kind: 'linear-number',
            start: 1,
            step: 2,
        })
    })

    it('negative step (10,8) → linear-number {step:-2}', () => {
        expect(detectSeries([num(10), num(8)])).toEqual({
            kind: 'linear-number',
            start: 10,
            step: -2,
        })
    })

    it('fractional steps (1.5, 2.0) → linear-number', () => {
        expect(detectSeries([num(1.5), num(2)])).toEqual({
            kind: 'linear-number',
            start: 1.5,
            step: 0.5,
        })
    })
})

describe('detectSeries — linear date', () => {
    it('single-cell date → copy', () => {
        expect(detectSeries([dateCell('2024-01-01')])).toEqual({ kind: 'copy' })
    })

    it('day-stepped 2024-01-01, 2024-01-02 → linear-date', () => {
        const plan = detectSeries([dateCell('2024-01-01'), dateCell('2024-01-02')])
        expect(plan).toEqual({
            kind: 'linear-date',
            startMs: Date.parse('2024-01-01'),
            stepMs: 86400_000,
        })
    })

    it('three-day step → linear-date', () => {
        const plan = detectSeries([
            dateCell('2024-01-01'),
            dateCell('2024-01-04'),
            dateCell('2024-01-07'),
        ])
        expect(plan).toEqual({
            kind: 'linear-date',
            startMs: Date.parse('2024-01-01'),
            stepMs: 3 * 86400_000,
        })
    })

    it('month-stepped 2024-01-01, 2024-02-01 → copy (calendar-inconsistent ms-delta not extrapolated)', () => {
        // Jan→Feb = 31 days, Feb→Mar = 29 days in 2024 (leap year). Even
        // a two-cell source has only one delta, but consciously we still
        // skip month inference in v1 by design — but the documented test
        // is for the 3-cell case where the deltas differ.
        const plan = detectSeries([
            dateCell('2024-01-01'),
            dateCell('2024-02-01'),
            dateCell('2024-03-01'),
        ])
        expect(plan).toEqual({ kind: 'copy' })
    })
})

describe('detectSeries — linear formula', () => {
    it('two formula cells → linear-formula', () => {
        expect(detectSeries([formula('=A1'), formula('=A2')])).toEqual({
            kind: 'linear-formula',
        })
    })

    it('single formula → linear-formula (the rewriter handles per-step shift)', () => {
        expect(detectSeries([formula('=A1')])).toEqual({ kind: 'linear-formula' })
    })

    it('formula with missing formula text → copy (defensive)', () => {
        expect(detectSeries([{ kind: 'formula', raw: null }])).toEqual({ kind: 'copy' })
    })
})

describe('detectSeries — suffix-int strings', () => {
    it('"Foo 1","Foo 2" → suffix-int {prefix:"Foo ", start:1, step:1, pad:1}', () => {
        expect(detectSeries([str('Foo 1'), str('Foo 2')])).toEqual({
            kind: 'suffix-int',
            prefix: 'Foo ',
            start: 1,
            step: 1,
            pad: 1,
        })
    })

    it('"Foo 01","Foo 02" → suffix-int with pad:2', () => {
        expect(detectSeries([str('Foo 01'), str('Foo 02')])).toEqual({
            kind: 'suffix-int',
            prefix: 'Foo ',
            start: 1,
            step: 1,
            pad: 2,
        })
    })

    it('"Foo 09","Foo 10" → suffix-int with pad:1 (min digit-count across source)', () => {
        expect(detectSeries([str('Foo 09'), str('Foo 10')])).toEqual({
            kind: 'suffix-int',
            prefix: 'Foo ',
            start: 9,
            step: 1,
            pad: 1,
        })
    })

    it('"Item 5","Item 8" → suffix-int with step:3', () => {
        expect(detectSeries([str('Item 5'), str('Item 8')])).toEqual({
            kind: 'suffix-int',
            prefix: 'Item ',
            start: 5,
            step: 3,
            pad: 1,
        })
    })

    it('three-cell ramp "A1","A2","A3" → suffix-int', () => {
        expect(detectSeries([str('A1'), str('A2'), str('A3')])).toEqual({
            kind: 'suffix-int',
            prefix: 'A',
            start: 1,
            step: 1,
            pad: 1,
        })
    })

    it('inconsistent step "A1","A3","A4" → copy', () => {
        expect(detectSeries([str('A1'), str('A3'), str('A4')])).toEqual({ kind: 'copy' })
    })

    it('different prefixes "A1","B2" → copy', () => {
        expect(detectSeries([str('A1'), str('B2')])).toEqual({ kind: 'copy' })
    })

    it('"Foo -2","Foo -1" → suffix-int (negative integers parse)', () => {
        expect(detectSeries([str('Foo -2'), str('Foo -1')])).toEqual({
            kind: 'suffix-int',
            prefix: 'Foo ',
            start: -2,
            step: 1,
            pad: 1,
        })
    })

    it('single string with no trailing digit "hello" → copy', () => {
        expect(detectSeries([str('hello')])).toEqual({ kind: 'copy' })
    })

    it('single string "Foo 5" → suffix-int (single-cell extrapolation is unambiguous)', () => {
        expect(detectSeries([str('Foo 5')])).toEqual({
            kind: 'suffix-int',
            prefix: 'Foo ',
            start: 5,
            step: 1,
            pad: 1,
        })
    })
})

describe('detectSeries — month names', () => {
    it('"Jan","Feb" → month {long:false, casing:title}', () => {
        expect(detectSeries([str('Jan'), str('Feb')])).toEqual({
            kind: 'month',
            startIdx: 0,
            step: 1,
            long: false,
            casing: 'title',
        })
    })

    it('"January","February" → month {long:true}', () => {
        expect(detectSeries([str('January'), str('February')])).toEqual({
            kind: 'month',
            startIdx: 0,
            step: 1,
            long: true,
            casing: 'title',
        })
    })

    it('"JAN","FEB" all-caps → month with casing=upper', () => {
        expect(detectSeries([str('JAN'), str('FEB')])).toEqual({
            kind: 'month',
            startIdx: 0,
            step: 1,
            long: false,
            casing: 'upper',
        })
    })

    it('"jan","feb" all-lower → month with casing=lower', () => {
        expect(detectSeries([str('jan'), str('feb')])).toEqual({
            kind: 'month',
            startIdx: 0,
            step: 1,
            long: false,
            casing: 'lower',
        })
    })

    it('mixed case "Jan","FEB" → copy', () => {
        expect(detectSeries([str('Jan'), str('FEB')])).toEqual({ kind: 'copy' })
    })

    it('"Dec" wraps backwards step → forward-1', () => {
        // Dec(11) → Jan(0) → Feb(1) reads as step 1 modulo 12.
        expect(detectSeries([str('Dec'), str('Jan'), str('Feb')])).toEqual({
            kind: 'month',
            startIdx: 11,
            step: 1,
            long: false,
            casing: 'title',
        })
    })

    it('every-other-month "Jan","Mar","May" → step:2', () => {
        expect(detectSeries([str('Jan'), str('Mar'), str('May')])).toEqual({
            kind: 'month',
            startIdx: 0,
            step: 2,
            long: false,
            casing: 'title',
        })
    })

    it('mixing long and short "Jan","February" → copy', () => {
        expect(detectSeries([str('Jan'), str('February')])).toEqual({ kind: 'copy' })
    })

    it('non-month string "Foo","Bar" → copy', () => {
        expect(detectSeries([str('Foo'), str('Bar')])).toEqual({ kind: 'copy' })
    })
})

describe('detectSeries — weekday names', () => {
    it('"Mon","Tue" → weekday {startIdx:0, step:1, long:false}', () => {
        expect(detectSeries([str('Mon'), str('Tue')])).toEqual({
            kind: 'weekday',
            startIdx: 0,
            step: 1,
            long: false,
            casing: 'title',
        })
    })

    it('"Monday","Tuesday" → weekday {long:true}', () => {
        expect(detectSeries([str('Monday'), str('Tuesday')])).toEqual({
            kind: 'weekday',
            startIdx: 0,
            step: 1,
            long: true,
            casing: 'title',
        })
    })

    it('"Sun","Mon","Tue" wraps Sun(6)→Mon(0) as step:1', () => {
        expect(detectSeries([str('Sun'), str('Mon'), str('Tue')])).toEqual({
            kind: 'weekday',
            startIdx: 6,
            step: 1,
            long: false,
            casing: 'title',
        })
    })

    it('"MON","TUE" all-caps → weekday casing:upper', () => {
        expect(detectSeries([str('MON'), str('TUE')])).toEqual({
            kind: 'weekday',
            startIdx: 0,
            step: 1,
            long: false,
            casing: 'upper',
        })
    })
})

describe('projectSeries — copy', () => {
    it('cycles through source modulo length', () => {
        const a = str('a')
        const b = str('b')
        const c = str('c')
        expect(projectSeries({ kind: 'copy' }, [a, b, c], 0)).toEqual({
            kind: 'string',
            raw: 'a',
            formula: undefined,
        })
        expect(projectSeries({ kind: 'copy' }, [a, b, c], 4)).toEqual({
            kind: 'string',
            raw: 'b',
            formula: undefined,
        })
        expect(projectSeries({ kind: 'copy' }, [a, b, c], 5)).toEqual({
            kind: 'string',
            raw: 'c',
            formula: undefined,
        })
    })

    it('does not propagate style', () => {
        const styled: ClipboardCell = {
            kind: 'string',
            raw: 'foo',
            style: { font: { bold: true } },
        }
        const result = projectSeries({ kind: 'copy' }, [styled], 0)
        expect(result.style).toBeUndefined()
    })
})

describe('projectSeries — linear-number', () => {
    it('1,2 stepIndex 2 → 3', () => {
        const plan = detectSeries([num(1), num(2)])
        expect(projectSeries(plan, [num(1), num(2)], 2)).toEqual({
            kind: 'number',
            raw: 3,
        })
    })

    it('1,2 stepIndex 5 → 6', () => {
        const plan = detectSeries([num(1), num(2)])
        expect(projectSeries(plan, [num(1), num(2)], 5)).toEqual({
            kind: 'number',
            raw: 6,
        })
    })

    it('5,10 stepIndex 4 → 25', () => {
        const plan = detectSeries([num(5), num(10)])
        expect(projectSeries(plan, [num(5), num(10)], 4)).toEqual({
            kind: 'number',
            raw: 25,
        })
    })

    it('step 0 stays at start', () => {
        const plan: ReturnType<typeof detectSeries> = {
            kind: 'linear-number',
            start: 5,
            step: 0,
        }
        expect(projectSeries(plan, [num(5), num(5)], 7)).toEqual({
            kind: 'number',
            raw: 5,
        })
    })
})

describe('projectSeries — linear-date', () => {
    it('day-step projection round-trips ISO date-only', () => {
        const plan = detectSeries([dateCell('2024-01-01'), dateCell('2024-01-02')])
        expect(projectSeries(plan, [dateCell('2024-01-01'), dateCell('2024-01-02')], 5)).toEqual({
            kind: 'date',
            raw: '2024-01-06',
        })
    })

    it('week-step projection', () => {
        const plan = detectSeries([dateCell('2024-01-01'), dateCell('2024-01-08')])
        expect(projectSeries(plan, [dateCell('2024-01-01'), dateCell('2024-01-08')], 3)).toEqual({
            kind: 'date',
            raw: '2024-01-22',
        })
    })
})

describe('projectSeries — linear-formula', () => {
    it('returns the source formula verbatim, cycled modulo length', () => {
        const cells = [formula('=A1'), formula('=A2')]
        const plan = detectSeries(cells)
        // The commit path overlays rewriteFormula afterward; this
        // function returns the un-rewritten source formula.
        expect(projectSeries(plan, cells, 2)).toEqual({
            kind: 'formula',
            raw: null,
            formula: '=A1',
        })
        expect(projectSeries(plan, cells, 3)).toEqual({
            kind: 'formula',
            raw: null,
            formula: '=A2',
        })
    })
})

describe('projectSeries — suffix-int', () => {
    it('{prefix:"Foo ", start:1, step:1, pad:2}, stepIndex 5 → "Foo 06"', () => {
        const plan: ReturnType<typeof detectSeries> = {
            kind: 'suffix-int',
            prefix: 'Foo ',
            start: 1,
            step: 1,
            pad: 2,
        }
        expect(projectSeries(plan, [str('Foo 01'), str('Foo 02')], 5)).toEqual({
            kind: 'string',
            raw: 'Foo 06',
        })
    })

    it('crosses natural width — pad:1 with start:9, step:1 at stepIndex 2 → "Foo 11"', () => {
        const plan: ReturnType<typeof detectSeries> = {
            kind: 'suffix-int',
            prefix: 'Foo ',
            start: 9,
            step: 1,
            pad: 1,
        }
        expect(projectSeries(plan, [str('Foo 09'), str('Foo 10')], 2)).toEqual({
            kind: 'string',
            raw: 'Foo 11',
        })
    })

    it('negative result projects with sign', () => {
        const plan: ReturnType<typeof detectSeries> = {
            kind: 'suffix-int',
            prefix: 'x',
            start: 1,
            step: -1,
            pad: 1,
        }
        expect(projectSeries(plan, [str('x1'), str('x0')], 3)).toEqual({
            kind: 'string',
            raw: 'x-2',
        })
    })

    it('preserves padding for small values when pad >= digit-count', () => {
        const plan: ReturnType<typeof detectSeries> = {
            kind: 'suffix-int',
            prefix: 'P',
            start: 1,
            step: 1,
            pad: 3,
        }
        expect(projectSeries(plan, [str('P001'), str('P002')], 4)).toEqual({
            kind: 'string',
            raw: 'P005',
        })
    })
})

describe('projectSeries — month wraparound', () => {
    it('startIdx:0, step:1, stepIndex:12 → "Jan" (wraps the year)', () => {
        const plan: ReturnType<typeof detectSeries> = {
            kind: 'month',
            startIdx: 0,
            step: 1,
            long: false,
            casing: 'title',
        }
        expect(projectSeries(plan, [str('Jan'), str('Feb')], 12)).toEqual({
            kind: 'string',
            raw: 'Jan',
        })
    })

    it('preserves all-caps casing across wrap', () => {
        const plan: ReturnType<typeof detectSeries> = {
            kind: 'month',
            startIdx: 0,
            step: 1,
            long: false,
            casing: 'upper',
        }
        expect(projectSeries(plan, [str('JAN'), str('FEB')], 2)).toEqual({
            kind: 'string',
            raw: 'MAR',
        })
    })

    it('preserves lowercase casing', () => {
        const plan: ReturnType<typeof detectSeries> = {
            kind: 'month',
            startIdx: 0,
            step: 1,
            long: false,
            casing: 'lower',
        }
        expect(projectSeries(plan, [str('jan'), str('feb')], 2)).toEqual({
            kind: 'string',
            raw: 'mar',
        })
    })

    it('long-name month projection', () => {
        const plan: ReturnType<typeof detectSeries> = {
            kind: 'month',
            startIdx: 0,
            step: 1,
            long: true,
            casing: 'title',
        }
        expect(projectSeries(plan, [str('January'), str('February')], 2)).toEqual({
            kind: 'string',
            raw: 'March',
        })
    })
})

describe('projectSeries — weekday wraparound', () => {
    it('startIdx:0, step:1, stepIndex:7 → "Mon" (wraps the week)', () => {
        const plan: ReturnType<typeof detectSeries> = {
            kind: 'weekday',
            startIdx: 0,
            step: 1,
            long: false,
            casing: 'title',
        }
        expect(projectSeries(plan, [str('Mon'), str('Tue')], 7)).toEqual({
            kind: 'string',
            raw: 'Mon',
        })
    })

    it('long-name weekday projection wraps', () => {
        const plan: ReturnType<typeof detectSeries> = {
            kind: 'weekday',
            startIdx: 0,
            step: 1,
            long: true,
            casing: 'title',
        }
        expect(projectSeries(plan, [str('Monday'), str('Tuesday')], 7)).toEqual({
            kind: 'string',
            raw: 'Monday',
        })
    })
})
