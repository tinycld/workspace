// useTextDocument composes useDocumentEditor (Tiptap binding) with
// the realtime room's typed slot helpers (saveStatus, readOnly,
// importWarnings). The Tiptap-driven side of the hook can't run in
// the Vitest node environment — Tiptap needs a real DOM and a
// mounted EditorView. End-to-end coverage of the editor binding
// lands in the M6.20 Playwright suite.
//
// What we DO test here are the pure narrowing helpers
// (`typedServerHello`, `typedServerSlot`) the hook composes — they
// guard against the realtime room shipping a typed payload of the
// wrong shape (broker upgrade, server-side schema change, etc.). The
// helpers' contract is that consumers get a default that doesn't
// flicker false-positive UI (no red "save failed" while the room is
// still establishing, no read-only lockout before the hello arrives).

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import type { RealtimeRoomHandle } from '@tinycld/core/lib/realtime/use-realtime-room'
import {
    typedServerHello,
    typedServerSlot,
} from '../tinycld/text/hooks/useTextRoom'

function makeRoom(opts: {
    serverHello?: unknown
    serverSlot?: unknown
    isConnected?: boolean
}): RealtimeRoomHandle {
    const yDoc = new Y.Doc()
    const awareness = new Awareness(yDoc)
    return {
        doc: yDoc,
        awareness,
        isReady: true,
        isConnected: opts.isConnected ?? true,
        serverHello: opts.serverHello ?? null,
        serverSlot: opts.serverSlot ?? null,
    }
}

describe('typedServerHello', () => {
    it('returns the non-readOnly default with no warnings when the room is null', () => {
        const hello = typedServerHello(null)
        expect(hello.readOnly).toBe(false)
        expect(hello.importWarnings).toEqual([])
    })

    it('returns the same defaults when the room has no hello yet (pre-handshake)', () => {
        // During the open handshake the room handle exists but the
        // server hasn't sent MsgServerHello yet. Defaulting to
        // readOnly:false avoids locking the user out of an
        // already-rendered editor while bytes are in flight.
        const hello = typedServerHello(makeRoom({}))
        expect(hello.readOnly).toBe(false)
        expect(hello.importWarnings).toEqual([])
    })

    it('passes through readOnly=true so the editor surfaces the viewer affordance', () => {
        const room = makeRoom({
            serverHello: { readOnly: true, importWarnings: [] },
        })
        expect(typedServerHello(room).readOnly).toBe(true)
    })

    it('passes through readOnly=false explicitly (editor / owner role)', () => {
        const room = makeRoom({
            serverHello: { readOnly: false, importWarnings: [] },
        })
        expect(typedServerHello(room).readOnly).toBe(false)
    })

    it('preserves importWarnings array contents verbatim', () => {
        const room = makeRoom({
            serverHello: {
                readOnly: false,
                importWarnings: [
                    { code: 'unsupported-feature' },
                    { code: 'image-inlined', detail: '120kb' },
                ],
            },
        })
        const hello = typedServerHello(room)
        expect(hello.importWarnings).toHaveLength(2)
        expect(hello.importWarnings[0].code).toBe('unsupported-feature')
        expect(hello.importWarnings[1].detail).toBe('120kb')
    })
})

describe('typedServerSlot', () => {
    it("defaults to 'ok' so the indicator doesn't flash 'failed' before the first slot frame arrives", () => {
        expect(typedServerSlot(null).saveStatus).toBe('ok')
        expect(typedServerSlot(makeRoom({})).saveStatus).toBe('ok')
    })

    it("propagates 'failed' when the server reports a save failure", () => {
        const room = makeRoom({ serverSlot: { saveStatus: 'failed' } })
        expect(typedServerSlot(room).saveStatus).toBe('failed')
    })

    it("propagates 'ok' explicitly", () => {
        const room = makeRoom({ serverSlot: { saveStatus: 'ok' } })
        expect(typedServerSlot(room).saveStatus).toBe('ok')
    })

    it("preserves the slot when the room is disconnected (saveStatus reflects last known server state, not connection)", () => {
        // SaveStatusIndicator is responsible for layering its own
        // 'syncing' state on top of saveStatus when isConnected is
        // false — the typed-narrowing helper just exposes the slot
        // unchanged. This test locks that contract so a future
        // change to "default to 'failed' on disconnect" would
        // require an explicit decision.
        const room = makeRoom({
            serverSlot: { saveStatus: 'ok' },
            isConnected: false,
        })
        expect(typedServerSlot(room).saveStatus).toBe('ok')
    })
})
