import { beforeEach, describe, expect, it } from 'vitest'
import { clearAll, clearPayload, getPayload, putPayload } from '../tinycld/calc/lib/clipboard/store'
import type { ClipboardPayload } from '../tinycld/calc/lib/clipboard/types'

// The fidelity store is module-level. Tests share its state; reset it
// at the top of each test so order-dependence doesn't leak in.

function makePayload(rows = 1, cols = 1): ClipboardPayload {
    return {
        rows,
        cols,
        cells: [[{ kind: 'string', raw: 'x' }]],
        sourceAnchor: { row: 1, col: 1 },
    }
}

describe('clipboard fidelity store', () => {
    beforeEach(() => {
        clearAll()
    })

    it('put returns a non-empty marker and get retrieves the same payload', () => {
        const payload = makePayload()
        const marker = putPayload(payload)
        expect(typeof marker).toBe('string')
        expect(marker.length).toBeGreaterThan(0)
        expect(getPayload(marker)).toBe(payload)
    })

    it('returns null for an unknown marker', () => {
        expect(getPayload('not-a-real-marker')).toBeNull()
    })

    it('mints distinct markers for repeated puts of the same payload', () => {
        const a = putPayload(makePayload())
        const b = putPayload(makePayload())
        expect(a).not.toBe(b)
    })

    it('clearPayload removes only the targeted entry', () => {
        const a = putPayload(makePayload())
        const b = putPayload(makePayload())
        clearPayload(a)
        expect(getPayload(a)).toBeNull()
        expect(getPayload(b)).not.toBeNull()
    })

    it('evicts the oldest entry once the cap is exceeded', () => {
        // Cap is internal; this test pins the LRU-ish (insertion-order)
        // eviction behavior by inserting one more than the cap and
        // verifying the first marker has been dropped.
        const markers: string[] = []
        for (let i = 0; i < 20; i++) {
            markers.push(putPayload(makePayload()))
        }
        // First inserted marker should be gone; last should still be live.
        expect(getPayload(markers[0])).toBeNull()
        expect(getPayload(markers[markers.length - 1])).not.toBeNull()
    })
})
