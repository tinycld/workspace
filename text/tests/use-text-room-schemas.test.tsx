// useTextRoom narrows the realtime room's opaque serverHello/
// serverSlot payloads to text-specific shapes via zod. The schemas
// are the source of truth — a server-side drift (broker upgrade,
// new field, type rename) must be caught at parse time and routed
// to captureException, not silently miscast.
//
// This file covers (a) round-trip parsing of well-formed payloads,
// (b) the safe-default fallback for malformed payloads, and (c) the
// captureException side effect on parse failure. The wider behaviour
// of typedServerHello/typedServerSlot (room == null, pre-handshake)
// is locked in use-text-document.test.tsx.

import { Awareness } from 'y-protocols/awareness'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import type { RealtimeRoomHandle } from '@tinycld/core/lib/realtime/use-realtime-room'

const captureExceptionMock = vi.fn()
vi.mock('@tinycld/core/lib/errors', () => ({
    captureException: (...args: unknown[]) => captureExceptionMock(...args),
}))

// Import under test AFTER the mock so the module picks up the mock.
import {
    serverHelloSchema,
    serverSlotSchema,
    typedServerHello,
    typedServerSlot,
} from '../tinycld/text/hooks/useTextRoom'

function makeRoom(opts: {
    serverHello?: unknown
    serverSlot?: unknown
}): RealtimeRoomHandle {
    const yDoc = new Y.Doc()
    const awareness = new Awareness(yDoc)
    return {
        doc: yDoc,
        awareness,
        isReady: true,
        isConnected: true,
        serverHello: opts.serverHello ?? null,
        serverSlot: opts.serverSlot ?? null,
    }
}

beforeEach(() => {
    captureExceptionMock.mockClear()
})

describe('serverHelloSchema', () => {
    it('accepts a minimal payload with empty warnings', () => {
        const parsed = serverHelloSchema.parse({
            readOnly: false,
            importWarnings: [],
        })
        expect(parsed).toEqual({ readOnly: false, importWarnings: [] })
    })

    it('accepts warnings with optional detail field', () => {
        const parsed = serverHelloSchema.parse({
            readOnly: true,
            importWarnings: [
                { code: 'unsupported-feature' },
                { code: 'image-inlined', detail: '120kb' },
            ],
        })
        expect(parsed.importWarnings).toHaveLength(2)
        expect(parsed.importWarnings[1].detail).toBe('120kb')
    })

    it('rejects a payload missing readOnly', () => {
        const result = serverHelloSchema.safeParse({ importWarnings: [] })
        expect(result.success).toBe(false)
    })

    it('rejects warnings with non-string code', () => {
        const result = serverHelloSchema.safeParse({
            readOnly: false,
            importWarnings: [{ code: 42 }],
        })
        expect(result.success).toBe(false)
    })
})

describe('serverSlotSchema', () => {
    it("accepts saveStatus 'ok'", () => {
        expect(serverSlotSchema.parse({ saveStatus: 'ok' })).toEqual({
            saveStatus: 'ok',
        })
    })

    it("accepts saveStatus 'failed'", () => {
        expect(serverSlotSchema.parse({ saveStatus: 'failed' })).toEqual({
            saveStatus: 'failed',
        })
    })

    it('rejects unknown saveStatus literal', () => {
        const result = serverSlotSchema.safeParse({ saveStatus: 'pending' })
        expect(result.success).toBe(false)
    })
})

describe('typedServerHello with zod validation', () => {
    it('returns the parsed payload verbatim for a valid hello', () => {
        const hello = typedServerHello(
            makeRoom({
                serverHello: {
                    readOnly: true,
                    importWarnings: [{ code: 'comments', detail: '3 markers stripped' }],
                },
            })
        )
        expect(hello.readOnly).toBe(true)
        expect(hello.importWarnings[0].code).toBe('comments')
        expect(captureExceptionMock).not.toHaveBeenCalled()
    })

    it('falls back to defaults and reports to captureException for garbage payloads', () => {
        const hello = typedServerHello(
            makeRoom({ serverHello: { totallyWrong: 'shape' } })
        )
        expect(hello).toEqual({ readOnly: false, importWarnings: [] })
        expect(captureExceptionMock).toHaveBeenCalledOnce()
        const [tag] = captureExceptionMock.mock.calls[0]
        expect(tag).toBe('useTextRoom.serverHello.parse')
    })

    it('does not invoke captureException when the room has no hello yet', () => {
        typedServerHello(makeRoom({}))
        expect(captureExceptionMock).not.toHaveBeenCalled()
    })
})

describe('typedServerSlot with zod validation', () => {
    it('returns the parsed payload verbatim for a valid slot', () => {
        const slot = typedServerSlot(
            makeRoom({ serverSlot: { saveStatus: 'failed' } })
        )
        expect(slot.saveStatus).toBe('failed')
        expect(captureExceptionMock).not.toHaveBeenCalled()
    })

    it('falls back to ok and reports to captureException for garbage payloads', () => {
        const slot = typedServerSlot(
            makeRoom({ serverSlot: { saveStatus: 'maybe?' } })
        )
        expect(slot).toEqual({ saveStatus: 'ok' })
        expect(captureExceptionMock).toHaveBeenCalledOnce()
        const [tag] = captureExceptionMock.mock.calls[0]
        expect(tag).toBe('useTextRoom.serverSlot.parse')
    })

    it('does not invoke captureException when the room has no slot yet', () => {
        typedServerSlot(makeRoom({}))
        expect(captureExceptionMock).not.toHaveBeenCalled()
    })
})
