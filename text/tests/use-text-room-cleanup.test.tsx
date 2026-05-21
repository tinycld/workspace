// Awareness cleanup contract: when a user closes the doc tab (or
// logs out), remote peers must see a clean awareness-removal frame
// instead of a frozen ghost cursor until the protocol timeout
// catches it. See docs/TODO.md item 10.
//
// Core's useRealtimeRoom already calls
// `awareness.setLocalState(null)` in its effect cleanup before
// destroying the WebSocket. useTextRoom does NOT add a separate
// cleanup effect — duplicating the call would either race with the
// hook's teardown or run on every render. This test locks the
// contract by exercising the core hook directly: a manual
// awareness.setLocalState(null) call drops the local state
// immediately, matching what core's cleanup does.
//
// We can't drive useTextRoom under Vitest because it opens a real
// WebSocket; the contract this file enforces is "the cleanup
// primitive useRealtimeRoom relies on does what we think it does."

import { describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

describe('awareness cleanup primitive', () => {
    it('drops local state immediately when setLocalState(null) is called', () => {
        const doc = new Y.Doc()
        const awareness = new Awareness(doc)
        awareness.setLocalState({
            user: { id: 'u_1', name: 'Alice', color: '#ff0000' },
            cursor: null,
        })
        expect(awareness.getLocalState()).not.toBeNull()

        awareness.setLocalState(null)
        expect(awareness.getLocalState()).toBeNull()

        awareness.destroy()
        doc.destroy()
    })

    it('emits a change with the local clientID in removed when state goes to null', () => {
        // y-protocols/awareness fires 'change' with {added, updated,
        // removed} arrays. When a peer goes from a non-null state
        // to null, the local clientID lands in `removed`. That's
        // the signal remote tabs use to drop the ghost cursor
        // before the heartbeat timeout fires.
        const doc = new Y.Doc()
        const awareness = new Awareness(doc)
        awareness.setLocalState({ user: { id: 'u_1', name: 'Alice', color: '#ff0000' } })

        const removed: number[] = []
        awareness.on('change', (changes: { removed: number[] }) => {
            removed.push(...changes.removed)
        })

        awareness.setLocalState(null)
        expect(removed).toContain(awareness.clientID)

        awareness.destroy()
        doc.destroy()
    })
})
