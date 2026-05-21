import * as Clipboard from 'expo-clipboard'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    readFromOsClipboard,
    writeToOsClipboard,
} from '../tinycld/calc/lib/clipboard/adapter-native'
import { clearAll } from '../tinycld/calc/lib/clipboard/store'
import type { ClipboardPayload } from '../tinycld/calc/lib/clipboard/types'

// adapter-native bridges ClipboardPayload to/from expo-clipboard. The
// project's vitest config aliases expo-clipboard to a tiny in-memory
// stub (`tests/expo-clipboard-stub.ts`) so the adapter can run under
// Node without expo-modules-core's load-time side effects.

// __resetClipboardTextForTest is exposed by the stub so tests can
// start from a clean clipboard. Cast the import to whatever the stub
// shape is — TypeScript only sees expo-clipboard's real types here.
const clipboardStub = Clipboard as unknown as { __resetClipboardTextForTest: () => void }

function makePayload(): ClipboardPayload {
    return {
        rows: 1,
        cols: 2,
        cells: [
            [
                { kind: 'string', raw: 'native' },
                { kind: 'number', raw: 99 },
            ],
        ],
        sourceAnchor: { row: 1, col: 1 },
    }
}

describe('adapter-native — write / read round trip', () => {
    beforeEach(() => {
        clearAll()
        clipboardStub.__resetClipboardTextForTest()
    })

    it('writes TSV to the OS clipboard and returns a marker', async () => {
        const { markerId, osWriteOk } = await writeToOsClipboard(makePayload())
        expect(osWriteOk).toBe(true)
        expect(markerId.length).toBeGreaterThan(0)
        expect(await Clipboard.getStringAsync()).toBe('native\t99')
    })

    it('recovers the fidelity payload when the OS clipboard text matches the hash', async () => {
        const written = makePayload()
        const { markerId } = await writeToOsClipboard(written)
        const result = await readFromOsClipboard()
        expect(result).not.toBeNull()
        expect(result?.markerId).toBe(markerId)
        // Number kind survives — the fidelity path was hit, not TSV.
        expect(result?.payload.cells[0][1]).toEqual({ kind: 'number', raw: 99 })
    })

    it('falls back to TSV parse when the OS text is foreign', async () => {
        await Clipboard.setStringAsync('foreign\tdata')
        const result = await readFromOsClipboard()
        expect(result).not.toBeNull()
        expect(result?.markerId).toBeNull()
        expect(result?.payload.cells[0][1]).toEqual({ kind: 'string', raw: 'data' })
    })

    it('returns null when the OS clipboard is empty', async () => {
        expect(await readFromOsClipboard()).toBeNull()
    })
})
