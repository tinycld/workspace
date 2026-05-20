import { getShortcuts } from './registry'
import { topScope } from './scopes'
import type { Shortcut } from './types'

const SEQUENCE_TIMEOUT_MS = 1000

interface MatcherState {
    sequence: string[]
    timer: ReturnType<typeof setTimeout> | null
}

/**
 * Extract the list of unique single atoms from a set of shortcuts.
 * An atom is either a single combo ("$mod+Enter", "?", "g") or one
 * space-separated step of a sequence ("g i" → ["g", "i"]).
 */
export function atomsForShortcuts(shortcuts: Iterable<Shortcut>): string[] {
    const set = new Set<string>()
    for (const s of shortcuts) {
        for (const atom of s.keys.split(/\s+/).filter(Boolean)) {
            set.add(atom)
        }
    }
    return Array.from(set)
}

export interface MatcherContext {
    inInput: boolean
}

function matches(shortcut: Shortcut, ctx: MatcherContext): boolean {
    const top = topScope()
    if (shortcut.scope !== 'global' && shortcut.scope !== top) return false
    if (ctx.inInput && !shortcut.allowInInputs) return false
    if (shortcut.when && !shortcut.when()) return false
    return true
}

/**
 * Find a registered shortcut that exactly matches the given keys string.
 * Returns the first match in iteration order.
 */
function findExactMatch(keys: string, ctx: MatcherContext): Shortcut | null {
    for (const shortcut of getShortcuts().values()) {
        if (shortcut.keys !== keys) continue
        if (!matches(shortcut, ctx)) continue
        return shortcut
    }
    return null
}

/**
 * Does any registered shortcut's keys string *start with* the given sequence,
 * with more atoms to come? Used to decide whether to keep buffering.
 */
function hasPrefixMatch(prefix: string, ctx: MatcherContext): boolean {
    const prefixAtoms = prefix.split(/\s+/).filter(Boolean)
    for (const shortcut of getShortcuts().values()) {
        const keyAtoms = shortcut.keys.split(/\s+/).filter(Boolean)
        if (keyAtoms.length <= prefixAtoms.length) continue
        if (!matches(shortcut, ctx)) continue
        let ok = true
        for (let i = 0; i < prefixAtoms.length; i++) {
            if (keyAtoms[i] !== prefixAtoms[i]) {
                ok = false
                break
            }
        }
        if (ok) return true
    }
    return false
}

export function createMatcher() {
    const state: MatcherState = { sequence: [], timer: null }

    function reset() {
        state.sequence = []
        if (state.timer) {
            clearTimeout(state.timer)
            state.timer = null
        }
    }

    function armTimer() {
        if (state.timer) clearTimeout(state.timer)
        state.timer = setTimeout(reset, SEQUENCE_TIMEOUT_MS)
    }

    /**
     * Feed a single key atom into the matcher. Returns true if the atom was
     * consumed (either fired a shortcut or is building toward a sequence).
     * Callers should preventDefault when true.
     */
    function feedAtom(atom: string, ctx: MatcherContext): boolean {
        const candidate = [...state.sequence, atom].join(' ')

        const exact = findExactMatch(candidate, ctx)
        if (exact) {
            reset()
            exact.run({ keys: candidate })
            return true
        }

        if (hasPrefixMatch(candidate, ctx)) {
            state.sequence.push(atom)
            armTimer()
            return true
        }

        // The atom didn't match any exact or prefix — if we were mid-sequence,
        // reset and try the atom again as a fresh first atom.
        if (state.sequence.length > 0) {
            reset()
            return feedAtom(atom, ctx)
        }

        return false
    }

    return { feedAtom, reset, getSequence: () => [...state.sequence] }
}

export type Matcher = ReturnType<typeof createMatcher>
