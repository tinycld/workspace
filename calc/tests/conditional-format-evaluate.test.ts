import { describe, expect, it } from 'vitest'
import type { EvaluableCell } from '../tinycld/calc/lib/conditional-format/evaluate'
import {
    coerceFormulaResultToBoolean,
    evaluateRulesForCell,
    matchesCondition,
} from '../tinycld/calc/lib/conditional-format/evaluate'
import type {
    CFCondition,
    CFRule,
} from '../tinycld/calc/lib/conditional-format/types'

function cell(
    overrides: Partial<EvaluableCell> & { kind: EvaluableCell['kind']; raw: EvaluableCell['raw'] }
): EvaluableCell {
    return { display: '', ...overrides }
}

function ctx() {
    return {
        sheetName: 'Sheet1',
        row: 1,
        col: 1,
        evalFormulaAt: () => null,
    }
}

describe('matchesCondition — empty', () => {
    it('isEmpty matches null cell', () => {
        expect(matchesCondition({ type: 'isEmpty' }, null, ctx())).toBe(true)
    })
    it('isEmpty matches an empty string', () => {
        expect(
            matchesCondition({ type: 'isEmpty' }, cell({ kind: 'string', raw: '' }), ctx())
        ).toBe(true)
    })
    it('isEmpty rejects a number cell', () => {
        expect(
            matchesCondition({ type: 'isEmpty' }, cell({ kind: 'number', raw: 0, display: '0' }), ctx())
        ).toBe(false)
    })
    it('isNotEmpty matches any non-empty string', () => {
        expect(
            matchesCondition(
                { type: 'isNotEmpty' },
                cell({ kind: 'string', raw: 'x' }),
                ctx()
            )
        ).toBe(true)
    })
    it('isNotEmpty rejects null', () => {
        expect(matchesCondition({ type: 'isNotEmpty' }, null, ctx())).toBe(false)
    })
})

describe('matchesCondition — text', () => {
    const c = cell({ kind: 'string', raw: 'Hello World' })

    it('textContains is case-insensitive', () => {
        expect(matchesCondition({ type: 'textContains', value1: 'hello' }, c, ctx())).toBe(true)
        expect(matchesCondition({ type: 'textContains', value1: 'HELLO' }, c, ctx())).toBe(true)
    })
    it('textDoesNotContain inverts', () => {
        expect(
            matchesCondition({ type: 'textDoesNotContain', value1: 'foo' }, c, ctx())
        ).toBe(true)
        expect(
            matchesCondition({ type: 'textDoesNotContain', value1: 'hello' }, c, ctx())
        ).toBe(false)
    })
    it('textStartsWith / textEndsWith', () => {
        expect(matchesCondition({ type: 'textStartsWith', value1: 'hello' }, c, ctx())).toBe(true)
        expect(matchesCondition({ type: 'textStartsWith', value1: 'world' }, c, ctx())).toBe(false)
        expect(matchesCondition({ type: 'textEndsWith', value1: 'world' }, c, ctx())).toBe(true)
        expect(matchesCondition({ type: 'textEndsWith', value1: 'hello' }, c, ctx())).toBe(false)
    })
    it('textEquals is case-insensitive', () => {
        expect(matchesCondition({ type: 'textEquals', value1: 'HELLO WORLD' }, c, ctx())).toBe(true)
        expect(matchesCondition({ type: 'textEquals', value1: 'hello' }, c, ctx())).toBe(false)
    })
    it('returns false when operand is undefined', () => {
        expect(matchesCondition({ type: 'textContains' }, c, ctx())).toBe(false)
    })
})

describe('matchesCondition — number', () => {
    const c = cell({ kind: 'number', raw: 50 })

    it('numberEquals', () => {
        expect(matchesCondition({ type: 'numberEquals', value1: '50' }, c, ctx())).toBe(true)
        expect(matchesCondition({ type: 'numberEquals', value1: '51' }, c, ctx())).toBe(false)
    })
    it('numberNotEquals', () => {
        expect(matchesCondition({ type: 'numberNotEquals', value1: '50' }, c, ctx())).toBe(false)
        expect(matchesCondition({ type: 'numberNotEquals', value1: '51' }, c, ctx())).toBe(true)
    })
    it('numberGreater / numberGreaterOrEqual', () => {
        expect(matchesCondition({ type: 'numberGreater', value1: '40' }, c, ctx())).toBe(true)
        expect(matchesCondition({ type: 'numberGreater', value1: '50' }, c, ctx())).toBe(false)
        expect(matchesCondition({ type: 'numberGreaterOrEqual', value1: '50' }, c, ctx())).toBe(true)
    })
    it('numberLess / numberLessOrEqual', () => {
        expect(matchesCondition({ type: 'numberLess', value1: '60' }, c, ctx())).toBe(true)
        expect(matchesCondition({ type: 'numberLess', value1: '50' }, c, ctx())).toBe(false)
        expect(matchesCondition({ type: 'numberLessOrEqual', value1: '50' }, c, ctx())).toBe(true)
    })
    it('numberBetween / numberNotBetween', () => {
        expect(
            matchesCondition({ type: 'numberBetween', value1: '40', value2: '60' }, c, ctx())
        ).toBe(true)
        expect(
            matchesCondition({ type: 'numberBetween', value1: '60', value2: '70' }, c, ctx())
        ).toBe(false)
        expect(
            matchesCondition({ type: 'numberNotBetween', value1: '60', value2: '70' }, c, ctx())
        ).toBe(true)
    })
    it('numberBetween accepts reversed operands', () => {
        // Min/Max are auto-sorted so the operand order doesn't matter.
        expect(
            matchesCondition({ type: 'numberBetween', value1: '60', value2: '40' }, c, ctx())
        ).toBe(true)
    })
    it('numberBetween rejects when any operand is missing', () => {
        expect(
            matchesCondition({ type: 'numberBetween', value1: '40' }, c, ctx())
        ).toBe(false)
    })
    it('string cell with numeric content coerces', () => {
        const numericString = cell({ kind: 'string', raw: '50' })
        expect(matchesCondition({ type: 'numberGreater', value1: '40' }, numericString, ctx())).toBe(true)
    })
    it('non-numeric string is rejected', () => {
        const text = cell({ kind: 'string', raw: 'abc' })
        expect(matchesCondition({ type: 'numberGreater', value1: '40' }, text, ctx())).toBe(false)
    })
    it('booleans coerce to 1/0', () => {
        const bTrue = cell({ kind: 'boolean', raw: true })
        const bFalse = cell({ kind: 'boolean', raw: false })
        expect(matchesCondition({ type: 'numberEquals', value1: '1' }, bTrue, ctx())).toBe(true)
        expect(matchesCondition({ type: 'numberEquals', value1: '0' }, bFalse, ctx())).toBe(true)
    })
})

describe('matchesCondition — date', () => {
    const c = cell({ kind: 'date', raw: '2024-06-15' })

    it('dateIs', () => {
        expect(matchesCondition({ type: 'dateIs', value1: '2024-06-15' }, c, ctx())).toBe(true)
        expect(matchesCondition({ type: 'dateIs', value1: '2024-06-16' }, c, ctx())).toBe(false)
    })
    it('dateBefore / dateAfter', () => {
        expect(matchesCondition({ type: 'dateBefore', value1: '2024-06-16' }, c, ctx())).toBe(true)
        expect(matchesCondition({ type: 'dateBefore', value1: '2024-06-15' }, c, ctx())).toBe(false)
        expect(matchesCondition({ type: 'dateAfter', value1: '2024-06-14' }, c, ctx())).toBe(true)
        expect(matchesCondition({ type: 'dateAfter', value1: '2024-06-15' }, c, ctx())).toBe(false)
    })
    it('full ISO timestamps collapse to day granularity', () => {
        const cTs = cell({ kind: 'date', raw: '2024-06-15T12:34:56Z' })
        expect(matchesCondition({ type: 'dateIs', value1: '2024-06-15' }, cTs, ctx())).toBe(true)
    })
})

describe('matchesCondition — customFormula', () => {
    it('truthy formula result matches', () => {
        const c = cell({ kind: 'number', raw: 5 })
        const callContext = {
            ...ctx(),
            evalFormulaAt: () => true,
        }
        expect(
            matchesCondition({ type: 'customFormula', formula: 'A1>3' }, c, callContext)
        ).toBe(true)
    })
    it('falsy formula result does not match', () => {
        const c = cell({ kind: 'number', raw: 5 })
        const callContext = {
            ...ctx(),
            evalFormulaAt: () => false,
        }
        expect(
            matchesCondition({ type: 'customFormula', formula: 'A1>10' }, c, callContext)
        ).toBe(false)
    })
    it('missing formula does not match', () => {
        const c = cell({ kind: 'number', raw: 5 })
        expect(matchesCondition({ type: 'customFormula' }, c, ctx())).toBe(false)
    })
})

describe('matchesCondition — xlsxOpaque', () => {
    it('never matches in v1', () => {
        const c = cell({ kind: 'number', raw: 5 })
        expect(matchesCondition({ type: 'xlsxOpaque' }, c, ctx())).toBe(false)
    })
})

describe('coerceFormulaResultToBoolean', () => {
    it.each([
        [true, true],
        [false, false],
        [1, true],
        [0, false],
        [-1, true],
        ['TRUE', true],
        ['FALSE', false],
        ['true', true],
        ['false', false],
        ['hello', true],
        ['', false],
        ['0', false],
        ['1', true],
        ['1.5', true],
        [null, false],
        [undefined, false],
    ] as const)('%p -> %p', (input, expected) => {
        expect(coerceFormulaResultToBoolean(input)).toBe(expected)
    })
})

describe('evaluateRulesForCell — first match wins', () => {
    const c = cell({ kind: 'number', raw: 75 })
    const ruleRed: CFRule = {
        id: 'r1',
        ranges: ['A1:A10'],
        condition: { type: 'numberGreater', value1: '50' },
        style: { fill: { fgColor: '#FF0000' } },
    }
    const ruleGreen: CFRule = {
        id: 'r2',
        ranges: ['A1:A10'],
        condition: { type: 'numberBetween', value1: '70', value2: '80' },
        style: { fill: { fgColor: '#00FF00' } },
    }

    it('returns the first matching rule', () => {
        const style = evaluateRulesForCell([ruleRed, ruleGreen], c, ctx())
        expect(style?.fill?.fgColor).toBe('#FF0000')
    })
    it('reordering changes the winner', () => {
        const style = evaluateRulesForCell([ruleGreen, ruleRed], c, ctx())
        expect(style?.fill?.fgColor).toBe('#00FF00')
    })
    it('returns null when no rule matches', () => {
        const lowCell = cell({ kind: 'number', raw: 10 })
        expect(evaluateRulesForCell([ruleRed, ruleGreen], lowCell, ctx())).toBeNull()
    })
})
