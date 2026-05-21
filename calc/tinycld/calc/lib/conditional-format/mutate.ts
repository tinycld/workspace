// High-level mutators for conditional-formatting rules. Thin wrappers
// over y-binding.ts that the panel UI calls — keeps the panel code
// free of Y.Doc primitives.
//
// Every write goes through y-binding's writers, which wrap the
// transaction in LOCAL_ORIGIN so the calc undo manager captures rule
// edits as undoable steps (SHEETS_MAP is already in the undo scope).

import type * as Y from 'yjs'
import {
    deleteRule as bindingDeleteRule,
    reorderRule as bindingReorderRule,
    updateRule as bindingUpdateRule,
    writeRule as bindingWriteRule,
} from './y-binding'
import type { CFRule } from './types'

export function addRule(doc: Y.Doc, sheetId: string, rule: CFRule): boolean {
    return bindingWriteRule(doc, sheetId, rule)
}

export function updateRule(
    doc: Y.Doc,
    sheetId: string,
    ruleId: string,
    next: CFRule
): boolean {
    return bindingUpdateRule(doc, sheetId, ruleId, next)
}

export function deleteRule(doc: Y.Doc, sheetId: string, ruleId: string): boolean {
    return bindingDeleteRule(doc, sheetId, ruleId)
}

export function reorderRule(
    doc: Y.Doc,
    sheetId: string,
    ruleId: string,
    newIndex: number
): boolean {
    return bindingReorderRule(doc, sheetId, ruleId, newIndex)
}

// newRuleId produces an opaque, collision-resistant id for a fresh
// rule. crypto.randomUUID on web and modern Node; a hex fallback for
// older environments. Rule ids are only used as Y.Map keys and panel
// row keys — any unique string works.
export function newRuleId(): string {
    const c = globalThis.crypto as { randomUUID?: () => string } | undefined
    if (c?.randomUUID) return c.randomUUID()
    let s = ''
    for (let i = 0; i < 32; i++) {
        s += Math.floor(Math.random() * 16).toString(16)
    }
    return s
}
