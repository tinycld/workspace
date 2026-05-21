// Y.Doc binding for conditional-format rules. Owns the encoding from
// plain CFRule POJOs to the Y.Array / Y.Map tree under each sheet's
// metadata Y.Map at the CONDITIONAL_FORMATS_KEY, and the inverse read
// path.
//
// Storage shape (per sheet):
//   sheetMeta[CONDITIONAL_FORMATS_KEY] : Y.Array<Y.Map>
//     each entry Y.Map:
//       id          : string
//       ranges      : Y.Array<string>
//       condition   : Y.Map  (type, value1?, value2?, formula?,
//                              opaqueXlsx?)
//       style       : Y.Map  (buildStyleYMap shape — same as cell style)
//
// Rule order in the Y.Array IS the priority order — first match wins,
// per Sheets parity. Reorder = Y.Array move (delete + insert).

import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import * as Y from 'yjs'
import type { CellStyle } from '../workbook-types'
import { buildStyleYMap, readStyleFromYMapEntry, SHEETS_MAP } from '../y-doc-bootstrap'
import type { CFCondition, CFConditionType, CFRule } from './types'

// CONDITIONAL_FORMATS_KEY is the per-sheet meta key holding the rules
// Y.Array for that sheet. Absent on sheets that have never had a CF
// rule (no migration needed — the readers treat absence as "no rules").
export const CONDITIONAL_FORMATS_KEY = 'conditionalFormats'

const VALID_TYPES: ReadonlySet<CFConditionType> = new Set<CFConditionType>([
    'isEmpty',
    'isNotEmpty',
    'textContains',
    'textDoesNotContain',
    'textStartsWith',
    'textEndsWith',
    'textEquals',
    'dateIs',
    'dateBefore',
    'dateAfter',
    'numberEquals',
    'numberNotEquals',
    'numberGreater',
    'numberGreaterOrEqual',
    'numberLess',
    'numberLessOrEqual',
    'numberBetween',
    'numberNotBetween',
    'customFormula',
    'xlsxOpaque',
])

function rulesArray(doc: Y.Doc, sheetId: string): Y.Array<Y.Map<unknown>> | null {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const sheet = sheetsMap.get(sheetId)
    if (!(sheet instanceof Y.Map)) return null
    const arr = sheet.get(CONDITIONAL_FORMATS_KEY)
    if (arr instanceof Y.Array) return arr as Y.Array<Y.Map<unknown>>
    return null
}

// ensureRulesArray returns the per-sheet rules array, creating an
// empty one on first write. Callers must invoke inside a doc.transact
// — the Y.Array gets attached to the sheet's meta Y.Map, so the write
// belongs to the surrounding transaction.
function ensureRulesArray(doc: Y.Doc, sheetId: string): Y.Array<Y.Map<unknown>> | null {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const sheet = sheetsMap.get(sheetId)
    if (!(sheet instanceof Y.Map)) return null
    const existing = sheet.get(CONDITIONAL_FORMATS_KEY)
    if (existing instanceof Y.Array) return existing as Y.Array<Y.Map<unknown>>
    const fresh = new Y.Array<Y.Map<unknown>>()
    sheet.set(CONDITIONAL_FORMATS_KEY, fresh)
    return fresh
}

export function readRulesForSheet(doc: Y.Doc, sheetId: string): CFRule[] {
    const arr = rulesArray(doc, sheetId)
    if (arr == null) return []
    const out: CFRule[] = []
    arr.forEach((entry) => {
        if (!(entry instanceof Y.Map)) return
        const rule = readRuleFromMap(entry)
        if (rule != null) out.push(rule)
    })
    return out
}

export function readRuleFromMap(entry: Y.Map<unknown>): CFRule | null {
    const id = entry.get('id')
    if (typeof id !== 'string' || id === '') return null
    const ranges = readStringArray(entry.get('ranges'))
    const condition = readCondition(entry.get('condition'))
    if (condition == null) return null
    const styleEntry = entry.get('style')
    const style: CellStyle =
        styleEntry instanceof Y.Map ? (readStyleFromYMapEntry(styleEntry) ?? {}) : {}
    return { id, ranges, condition, style }
}

export function writeRule(doc: Y.Doc, sheetId: string, rule: CFRule): boolean {
    let ok = false
    doc.transact(() => {
        const arr = ensureRulesArray(doc, sheetId)
        if (arr == null) return
        arr.push([buildRuleMap(rule)])
        ok = true
    }, LOCAL_ORIGIN)
    return ok
}

export function deleteRule(doc: Y.Doc, sheetId: string, ruleId: string): boolean {
    let ok = false
    doc.transact(() => {
        const arr = rulesArray(doc, sheetId)
        if (arr == null) return
        const idx = indexOfRule(arr, ruleId)
        if (idx < 0) return
        arr.delete(idx, 1)
        ok = true
    }, LOCAL_ORIGIN)
    return ok
}

// updateRule replaces the entry in-place by deleting and re-inserting
// at the same index. The Y.Array model has no in-place mutate, but
// rule entries are small and the undo manager captures the pair as a
// single transaction step.
export function updateRule(
    doc: Y.Doc,
    sheetId: string,
    ruleId: string,
    next: CFRule
): boolean {
    let ok = false
    doc.transact(() => {
        const arr = rulesArray(doc, sheetId)
        if (arr == null) return
        const idx = indexOfRule(arr, ruleId)
        if (idx < 0) return
        arr.delete(idx, 1)
        arr.insert(idx, [buildRuleMap(next)])
        ok = true
    }, LOCAL_ORIGIN)
    return ok
}

export function reorderRule(
    doc: Y.Doc,
    sheetId: string,
    ruleId: string,
    newIndex: number
): boolean {
    let ok = false
    doc.transact(() => {
        const arr = rulesArray(doc, sheetId)
        if (arr == null) return
        const idx = indexOfRule(arr, ruleId)
        if (idx < 0) return
        const entry = arr.get(idx)
        if (!(entry instanceof Y.Map)) return
        const rule = readRuleFromMap(entry)
        if (rule == null) return
        const clamped = Math.max(0, Math.min(arr.length - 1, newIndex))
        if (clamped === idx) {
            ok = true
            return
        }
        arr.delete(idx, 1)
        // After the delete, indices >= idx shift down by one. Re-target
        // when moving toward the end so the user-visible result matches
        // the requested "place at index N" semantics.
        const insertAt = clamped > idx ? clamped : clamped
        arr.insert(insertAt, [buildRuleMap(rule)])
        ok = true
    }, LOCAL_ORIGIN)
    return ok
}

function indexOfRule(arr: Y.Array<Y.Map<unknown>>, ruleId: string): number {
    for (let i = 0; i < arr.length; i++) {
        const entry = arr.get(i)
        if (entry instanceof Y.Map && entry.get('id') === ruleId) return i
    }
    return -1
}

function buildRuleMap(rule: CFRule): Y.Map<unknown> {
    const m = new Y.Map<unknown>()
    m.set('id', rule.id)
    const ranges = new Y.Array<string>()
    if (rule.ranges.length > 0) ranges.push(rule.ranges.slice())
    m.set('ranges', ranges)
    m.set('condition', buildConditionMap(rule.condition))
    const styleMap = buildStyleYMap(rule.style)
    if (styleMap != null) m.set('style', styleMap)
    return m
}

function buildConditionMap(cond: CFCondition): Y.Map<unknown> {
    const m = new Y.Map<unknown>()
    m.set('type', cond.type)
    if (cond.value1 != null) m.set('value1', cond.value1)
    if (cond.value2 != null) m.set('value2', cond.value2)
    if (cond.formula != null && cond.formula !== '') m.set('formula', cond.formula)
    if (cond.opaqueXlsx != null) m.set('opaqueXlsx', cond.opaqueXlsx)
    return m
}

function readCondition(raw: unknown): CFCondition | null {
    if (!(raw instanceof Y.Map)) return null
    const type = raw.get('type')
    if (typeof type !== 'string' || !VALID_TYPES.has(type as CFConditionType)) return null
    const cond: CFCondition = { type: type as CFConditionType }
    const v1 = raw.get('value1')
    if (typeof v1 === 'string') cond.value1 = v1
    const v2 = raw.get('value2')
    if (typeof v2 === 'string') cond.value2 = v2
    const formula = raw.get('formula')
    if (typeof formula === 'string' && formula !== '') cond.formula = formula
    const opaque = raw.get('opaqueXlsx')
    if (opaque != null && typeof opaque === 'object') {
        cond.opaqueXlsx = opaque as Record<string, unknown>
    }
    return cond
}

function readStringArray(raw: unknown): string[] {
    if (!(raw instanceof Y.Array)) return []
    const out: string[] = []
    raw.forEach((v) => {
        if (typeof v === 'string') out.push(v)
    })
    return out
}
