import {
    type RemoteAwarenessEntry,
    useRemoteAwareness,
} from '@tinycld/core/lib/realtime/use-remote-awareness'
import { useMemo } from 'react'
import type { Awareness } from 'y-protocols/awareness'

export interface PresenceUser {
    id: string
    name: string
    color: string
}

export interface PresenceSelection {
    row: number
    col: number
}

export interface PresenceEditing extends PresenceSelection {
    draft: string
}

export interface PresenceState {
    user: PresenceUser
    sheetId: string | null
    selection: PresenceSelection | null
    editing: PresenceEditing | null
}

// RemotePresence keeps the same shape calc components have always
// expected: a flat object combining the remote clientID with the
// parsed PresenceState.
export interface RemotePresence extends PresenceState {
    clientID: number
}

// usePresence returns the list of *other* clients' awareness states
// parsed into the calc-specific PresenceState shape. Wraps core's
// generic useRemoteAwareness with the calc parser + equality check.
export function usePresence(awareness: Awareness | null): RemotePresence[] {
    // parse and equals are stable across renders so useRemoteAwareness'
    // useCallback inside its useSyncExternalStore stays stable too.
    const options = useMemo(() => ({ parse: parsePresence, equals: samePresence }), [])

    const entries = useRemoteAwareness<PresenceState>(awareness, options)

    // Flatten {clientID, state} into the historic flat shape so existing
    // Grid call sites read presence.user, presence.selection, etc.
    return useMemo(() => entries.map(e => ({ clientID: e.clientID, ...e.state })), [entries])
}

function parsePresence(raw: unknown): PresenceState | null {
    if (raw == null || typeof raw !== 'object') return null
    const obj = raw as Record<string, unknown>
    const userObj = obj.user as Record<string, unknown> | undefined
    if (
        userObj == null ||
        typeof userObj.id !== 'string' ||
        typeof userObj.name !== 'string' ||
        typeof userObj.color !== 'string'
    ) {
        return null
    }
    return {
        user: { id: userObj.id, name: userObj.name, color: userObj.color },
        sheetId: typeof obj.sheetId === 'string' ? obj.sheetId : null,
        selection: parseSelection(obj.selection),
        editing: parseEditing(obj.editing),
    }
}

function parseSelection(raw: unknown): PresenceSelection | null {
    if (raw == null || typeof raw !== 'object') return null
    const obj = raw as Record<string, unknown>
    if (typeof obj.row !== 'number' || typeof obj.col !== 'number') return null
    return { row: obj.row, col: obj.col }
}

function parseEditing(raw: unknown): PresenceEditing | null {
    if (raw == null || typeof raw !== 'object') return null
    const obj = raw as Record<string, unknown>
    if (
        typeof obj.row !== 'number' ||
        typeof obj.col !== 'number' ||
        typeof obj.draft !== 'string'
    ) {
        return null
    }
    return { row: obj.row, col: obj.col, draft: obj.draft }
}

function samePresence(a: PresenceState, b: PresenceState): boolean {
    return (
        a.user.id === b.user.id &&
        a.user.name === b.user.name &&
        a.user.color === b.user.color &&
        a.sheetId === b.sheetId &&
        sameSelection(a.selection, b.selection) &&
        sameEditing(a.editing, b.editing)
    )
}

function sameSelection(a: PresenceSelection | null, b: PresenceSelection | null): boolean {
    if (a == null || b == null) return a === b
    return a.row === b.row && a.col === b.col
}

function sameEditing(a: PresenceEditing | null, b: PresenceEditing | null): boolean {
    if (a == null || b == null) return a === b
    return a.row === b.row && a.col === b.col && a.draft === b.draft
}

// RemoteAwarenessEntry is re-exported for callers who want to
// short-circuit the flattening — useful in tests.
export type { RemoteAwarenessEntry }
