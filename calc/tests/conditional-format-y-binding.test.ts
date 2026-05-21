import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { newRuleId } from '../tinycld/calc/lib/conditional-format/mutate'
import type { CFRule } from '../tinycld/calc/lib/conditional-format/types'
import {
    deleteRule,
    readRulesForSheet,
    reorderRule,
    updateRule,
    writeRule,
} from '../tinycld/calc/lib/conditional-format/y-binding'
import { SHEETS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

function makeDoc(): { doc: Y.Doc; sheetId: string } {
    const doc = new Y.Doc()
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = new Y.Map<unknown>()
    meta.set('name', 'Sheet1')
    sheetsMap.set('sheet1', meta)
    return { doc, sheetId: 'sheet1' }
}

function ruleFixture(overrides: Partial<CFRule> = {}): CFRule {
    return {
        id: newRuleId(),
        ranges: ['A1:A10'],
        condition: { type: 'numberGreater', value1: '50' },
        style: { fill: { fgColor: '#FF0000' } },
        ...overrides,
    }
}

describe('CF y-binding round-trip', () => {
    it('writes and reads a rule', () => {
        const { doc, sheetId } = makeDoc()
        const rule = ruleFixture()
        expect(writeRule(doc, sheetId, rule)).toBe(true)
        const out = readRulesForSheet(doc, sheetId)
        expect(out).toHaveLength(1)
        expect(out[0].id).toBe(rule.id)
        expect(out[0].ranges).toEqual(['A1:A10'])
        expect(out[0].condition).toEqual(rule.condition)
        expect(out[0].style.fill?.fgColor).toBe('#FF0000')
    })

    it('preserves order across multiple writes', () => {
        const { doc, sheetId } = makeDoc()
        const a = ruleFixture({ id: 'a' })
        const b = ruleFixture({ id: 'b' })
        const c = ruleFixture({ id: 'c' })
        writeRule(doc, sheetId, a)
        writeRule(doc, sheetId, b)
        writeRule(doc, sheetId, c)
        const out = readRulesForSheet(doc, sheetId)
        expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    })

    it('round-trips customFormula condition', () => {
        const { doc, sheetId } = makeDoc()
        const rule = ruleFixture({
            condition: { type: 'customFormula', formula: '$A1="Yes"' },
        })
        writeRule(doc, sheetId, rule)
        const [restored] = readRulesForSheet(doc, sheetId)
        expect(restored.condition.type).toBe('customFormula')
        expect(restored.condition.formula).toBe('$A1="Yes"')
    })

    it('round-trips opaque xlsx blob', () => {
        const { doc, sheetId } = makeDoc()
        const rule = ruleFixture({
            condition: {
                type: 'xlsxOpaque',
                opaqueXlsx: { Type: 'duplicate', Format: 5 },
            },
        })
        writeRule(doc, sheetId, rule)
        const [restored] = readRulesForSheet(doc, sheetId)
        expect(restored.condition.opaqueXlsx?.Type).toBe('duplicate')
        expect(restored.condition.opaqueXlsx?.Format).toBe(5)
    })

    it('multi-range encoding', () => {
        const { doc, sheetId } = makeDoc()
        const rule = ruleFixture({ ranges: ['A1:A10', 'C1:C10', 'E:E'] })
        writeRule(doc, sheetId, rule)
        const [restored] = readRulesForSheet(doc, sheetId)
        expect(restored.ranges).toEqual(['A1:A10', 'C1:C10', 'E:E'])
    })

    it('deleteRule removes by id', () => {
        const { doc, sheetId } = makeDoc()
        writeRule(doc, sheetId, ruleFixture({ id: 'keep' }))
        writeRule(doc, sheetId, ruleFixture({ id: 'drop' }))
        expect(deleteRule(doc, sheetId, 'drop')).toBe(true)
        expect(readRulesForSheet(doc, sheetId).map((r) => r.id)).toEqual(['keep'])
    })

    it('updateRule replaces in place', () => {
        const { doc, sheetId } = makeDoc()
        const id = 'r1'
        writeRule(doc, sheetId, ruleFixture({ id }))
        const next: CFRule = {
            id,
            ranges: ['B:B'],
            condition: { type: 'isEmpty' },
            style: { font: { bold: true } },
        }
        expect(updateRule(doc, sheetId, id, next)).toBe(true)
        const [r] = readRulesForSheet(doc, sheetId)
        expect(r.condition.type).toBe('isEmpty')
        expect(r.ranges).toEqual(['B:B'])
        expect(r.style.font?.bold).toBe(true)
    })

    it('reorderRule moves entries', () => {
        const { doc, sheetId } = makeDoc()
        writeRule(doc, sheetId, ruleFixture({ id: 'a' }))
        writeRule(doc, sheetId, ruleFixture({ id: 'b' }))
        writeRule(doc, sheetId, ruleFixture({ id: 'c' }))
        // Move 'c' to the front.
        expect(reorderRule(doc, sheetId, 'c', 0)).toBe(true)
        expect(readRulesForSheet(doc, sheetId).map((r) => r.id)).toEqual(['c', 'a', 'b'])
    })

    it('returns empty when sheet has no rules', () => {
        const { doc, sheetId } = makeDoc()
        expect(readRulesForSheet(doc, sheetId)).toEqual([])
    })
})
