import { describe, expect, it } from 'vitest'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'

// Awareness is the wire format that carries presence (selection,
// editing.draft, user info) between connected tabs. The Grid expects
// any state it sets locally to round-trip through encodeAwarenessUpdate
// + applyAwarenessUpdate without loss. This test pins that contract.

interface PresenceState {
    user: { id: string; name: string; color: string }
    sheetId: string | null
    selection: { row: number; col: number } | null
    editing: { row: number; col: number; draft: string } | null
}

function makeAwareness(): Awareness {
    const doc = new Y.Doc()
    return new Awareness(doc)
}

describe('awareness round trip', () => {
    it('encodes + decodes a fully populated state losslessly', () => {
        const a = makeAwareness()
        const b = makeAwareness()

        const localState: PresenceState = {
            user: { id: 'u1', name: 'Alice', color: 'hsl(120, 70%, 45%)' },
            sheetId: 'sheet1',
            selection: { row: 4, col: 7 },
            editing: { row: 9, col: 2, draft: 'in-progress' },
        }
        a.setLocalState(localState)

        const wire = encodeAwarenessUpdate(a, [a.clientID])
        applyAwarenessUpdate(b, wire, 'remote')

        const remoteSeen = b.getStates().get(a.clientID) as PresenceState | undefined
        expect(remoteSeen).toEqual(localState)
    })

    it('decodes selection-only state with editing null', () => {
        const a = makeAwareness()
        const b = makeAwareness()

        a.setLocalState({
            user: { id: 'u1', name: 'Alice', color: 'red' },
            sheetId: 'sheet1',
            selection: { row: 1, col: 1 },
            editing: null,
        })

        applyAwarenessUpdate(b, encodeAwarenessUpdate(a, [a.clientID]), 'remote')
        const seen = b.getStates().get(a.clientID) as PresenceState | undefined
        expect(seen?.selection).toEqual({ row: 1, col: 1 })
        expect(seen?.editing).toBeNull()
    })

    it('successive draft updates overwrite the slot', () => {
        const a = makeAwareness()
        const b = makeAwareness()

        a.setLocalState({
            user: { id: 'u1', name: 'Alice', color: 'red' },
            sheetId: 'sheet1',
            selection: null,
            editing: { row: 2, col: 3, draft: 'h' },
        })
        applyAwarenessUpdate(b, encodeAwarenessUpdate(a, [a.clientID]), 'remote')
        a.setLocalState({
            user: { id: 'u1', name: 'Alice', color: 'red' },
            sheetId: 'sheet1',
            selection: null,
            editing: { row: 2, col: 3, draft: 'hel' },
        })
        applyAwarenessUpdate(b, encodeAwarenessUpdate(a, [a.clientID]), 'remote')

        const seen = b.getStates().get(a.clientID) as PresenceState | undefined
        expect(seen?.editing?.draft).toBe('hel')
    })

    it('two clients do not collide; each has its own slot', () => {
        const a = makeAwareness()
        const b = makeAwareness()
        const observer = makeAwareness()

        a.setLocalState({
            user: { id: 'a', name: 'A', color: 'red' },
            sheetId: 'sheet1',
            selection: { row: 1, col: 1 },
            editing: null,
        })
        b.setLocalState({
            user: { id: 'b', name: 'B', color: 'blue' },
            sheetId: 'sheet1',
            selection: { row: 5, col: 5 },
            editing: null,
        })

        applyAwarenessUpdate(observer, encodeAwarenessUpdate(a, [a.clientID]), 'remote')
        applyAwarenessUpdate(observer, encodeAwarenessUpdate(b, [b.clientID]), 'remote')

        const states = observer.getStates()
        // Includes the observer's own (empty default) slot, plus a and b.
        const seenA = states.get(a.clientID) as PresenceState | undefined
        const seenB = states.get(b.clientID) as PresenceState | undefined
        expect(seenA?.user.id).toBe('a')
        expect(seenB?.user.id).toBe('b')
        expect(seenA?.selection).toEqual({ row: 1, col: 1 })
        expect(seenB?.selection).toEqual({ row: 5, col: 5 })
    })
})
