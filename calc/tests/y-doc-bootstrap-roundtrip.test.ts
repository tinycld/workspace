import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { describe, expect, it } from 'vitest'
import { readSyncMessage } from 'y-protocols/sync'
import * as Y from 'yjs'
import { cellKey, type WorkbookModel } from '../tinycld/calc/lib/workbook-types'
import { bootstrapYDocFromWorkbook } from '../tinycld/calc/lib/y-doc-bootstrap'

// These tests reproduce what the realtime client actually does when a
// SYNC_REPLY arrives: it calls y-protocols/sync.readSyncMessage on the
// payload. The previous version of these tests called Y.applyUpdate
// directly, which is *not* what the client does and which masked the
// broker-side framing bug we hit in the browser.
//
// The wire shape the broker must send for a SYNC_REPLY when a server
// mirror is present is a y-protocols sync step2 envelope:
//
//     varuint(1) || varuint(len(stateBytes)) || stateBytes
//
// where stateBytes is the server's Y.encodeStateAsUpdate output.
// Without the envelope, readSyncMessage misinterprets the leading byte
// as a message-type tag and (for an empty server doc, where the byte
// is 0) dispatches to readSyncStep1 with a buffer that's too short —
// throwing lib0's "Unexpected end of array".

function workbookWithBoldCell(): WorkbookModel {
    return {
        sheets: [
            {
                name: 'Sheet1',
                rowCount: 2,
                colCount: 2,
                cells: {
                    [cellKey(1, 1)]: { raw: 'A1', display: 'A1' },
                    [cellKey(2, 2)]: {
                        raw: 'B2',
                        display: 'B2',
                        style: { font: { bold: true } },
                    },
                },
            },
        ],
    }
}

// wrapAsSyncStep2 mirrors core/realtime's encodeSyncStep2 (Go) — the
// y-protocols sync step2 message that the broker should produce.
function wrapAsSyncStep2(state: Uint8Array): Uint8Array {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, 1) // messageYjsSyncStep2
    encoding.writeVarUint8Array(enc, state)
    return encoding.toUint8Array(enc)
}

describe('bootstrap → SYNC_REPLY roundtrip via y-protocols/sync', () => {
    it('a wrapped reply from an empty server doc applies cleanly', () => {
        // Server-side doc starts empty, broker sends a sync step2 with
        // an empty Y.encodeStateAsUpdate output. The client must not
        // throw when readSyncMessage processes it.
        const serverDoc = new Y.Doc()
        const state = Y.encodeStateAsUpdate(serverDoc)
        const wrapped = wrapAsSyncStep2(state)

        const clientDoc = new Y.Doc()
        const decoder = decoding.createDecoder(wrapped)
        const replyEnc = encoding.createEncoder()
        expect(() => readSyncMessage(decoder, replyEnc, clientDoc, null)).not.toThrow()
    })

    it('a wrapped reply from a populated server doc applies cleanly', () => {
        const serverDoc = new Y.Doc()
        bootstrapYDocFromWorkbook(serverDoc, workbookWithBoldCell())
        const state = Y.encodeStateAsUpdate(serverDoc)
        const wrapped = wrapAsSyncStep2(state)

        const clientDoc = new Y.Doc()
        const decoder = decoding.createDecoder(wrapped)
        const replyEnc = encoding.createEncoder()
        expect(() => readSyncMessage(decoder, replyEnc, clientDoc, null)).not.toThrow()
    })

    it('an UNWRAPPED raw state (the old broker bug) throws', () => {
        // Negative test: confirms the failure mode is exactly what we
        // saw in the browser when the broker forwarded raw bytes.
        const serverDoc = new Y.Doc()
        const state = Y.encodeStateAsUpdate(serverDoc)

        const clientDoc = new Y.Doc()
        const decoder = decoding.createDecoder(state)
        const replyEnc = encoding.createEncoder()
        expect(() => readSyncMessage(decoder, replyEnc, clientDoc, null)).toThrow()
    })
})
