import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    createGridStore,
    type GridStoreDeps,
    type StructuralOp,
} from '../tinycld/calc/hooks/grid-store'

// Clipboard marker lifecycle on the grid store: setClipboardMarker
// captures the in-memory fidelity marker, source range, and cut/copy
// discriminator; clearClipboardMarker wipes them; the auto-clear
// timeout fires after 30s. The marching-ants overlay reads these
// fields; the paste action reads cutPending to decide whether to
// clear the source cells in the same transaction as the destination
// write.

function makeStubDeps(): GridStoreDeps {
    return {
        readOnly: false,
        writeCell: () => {},
        focusActiveInput: () => {},
        applyStructuralMutation: (_op: StructuralOp) => {},
        applyFill: () => {},
        resolveMergeAnchor: (row, col) => ({ row, col }),
        expandRangeOverMerges: r => r,
        findMergesInRange: () => [],
        mergeRange: () => {},
        unmergeAt: () => {},
        setFrozenRows: () => {},
        setFrozenCols: () => {},
    }
}

const RANGE = { startRow: 1, startCol: 1, endRow: 2, endCol: 2 }

describe('grid-store clipboard marker', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('starts with no marker, no source range, cutPending=false', () => {
        const store = createGridStore(makeStubDeps())
        const s = store.getState()
        expect(s.clipboardMarker).toBeNull()
        expect(s.copySourceRange).toBeNull()
        expect(s.cutPending).toBe(false)
    })

    it('setClipboardMarker(copy) stores the marker with cutPending=false', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().setClipboardMarker('mk-1', RANGE, false)
        const s = store.getState()
        expect(s.clipboardMarker).toBe('mk-1')
        expect(s.copySourceRange).toEqual(RANGE)
        expect(s.cutPending).toBe(false)
    })

    it('setClipboardMarker(cut) sets cutPending=true', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().setClipboardMarker('mk-2', RANGE, true)
        expect(store.getState().cutPending).toBe(true)
    })

    it('clearClipboardMarker resets all three fields', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().setClipboardMarker('mk-3', RANGE, true)
        store.getState().clearClipboardMarker()
        const s = store.getState()
        expect(s.clipboardMarker).toBeNull()
        expect(s.copySourceRange).toBeNull()
        expect(s.cutPending).toBe(false)
    })

    it('auto-clears the marker after 30 seconds', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().setClipboardMarker('mk-4', RANGE, false)
        // 29s: still active.
        vi.advanceTimersByTime(29_000)
        expect(store.getState().clipboardMarker).toBe('mk-4')
        // +2s: timeout fires.
        vi.advanceTimersByTime(2_000)
        expect(store.getState().clipboardMarker).toBeNull()
        expect(store.getState().copySourceRange).toBeNull()
    })

    it('a fresh setClipboardMarker cancels the prior timeout', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().setClipboardMarker('mk-a', RANGE, false)
        vi.advanceTimersByTime(20_000)
        store.getState().setClipboardMarker('mk-b', RANGE, false)
        // Original 30s window from mk-a would have fired by now, but
        // the new call extended it. Marker should still be present.
        vi.advanceTimersByTime(15_000)
        expect(store.getState().clipboardMarker).toBe('mk-b')
        // 30s after mk-b: fires.
        vi.advanceTimersByTime(20_000)
        expect(store.getState().clipboardMarker).toBeNull()
    })

    it('clearClipboardMarker cancels the auto-clear timeout', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().setClipboardMarker('mk-5', RANGE, false)
        store.getState().clearClipboardMarker()
        // If the timeout were still armed it'd fire here and write
        // null over null — harmless, but the intent is to prevent it
        // from firing at all so a *subsequent* set isn't suprised.
        store.getState().setClipboardMarker('mk-6', RANGE, false)
        vi.advanceTimersByTime(20_000)
        expect(store.getState().clipboardMarker).toBe('mk-6')
        vi.advanceTimersByTime(15_000)
        expect(store.getState().clipboardMarker).toBeNull()
    })
})
