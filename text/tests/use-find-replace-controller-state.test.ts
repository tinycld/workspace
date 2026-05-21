// Unit tests for the cached-snapshot helper used by
// useFindReplaceControllerState. The hook itself is a useSyncExternalStore
// wrapper that's awkward to drive in a bare-Node test environment;
// the snapshot-identity contract is the load-bearing piece, so we
// exercise the pure helper directly. Mirrors the testing approach
// for use-y-undo-manager's computeNextSnapshot.
//
// The helper lives in find-replace-controller.ts (the platform-neutral
// module) rather than in the hook file, so this test can load it
// without dragging in react-native's Flow-syntax entry point.

import { describe, expect, it } from 'vitest'
import {
    computeNextFindReplaceSnapshot,
    FIND_REPLACE_EMPTY_STATE,
    type FindReplaceControllerState,
} from '../tinycld/text/lib/find-replace-controller'

describe('computeNextFindReplaceSnapshot', () => {
    it('returns the cached reference when every field is equal', () => {
        const cached: FindReplaceControllerState = { matchCount: 3, currentIndex: 1, query: 'foo' }
        const next: FindReplaceControllerState = { matchCount: 3, currentIndex: 1, query: 'foo' }
        const result = computeNextFindReplaceSnapshot(cached, next)
        expect(result).toBe(cached)
    })

    it('returns the next reference when matchCount changes', () => {
        const cached: FindReplaceControllerState = { matchCount: 3, currentIndex: 1, query: 'foo' }
        const next: FindReplaceControllerState = { matchCount: 4, currentIndex: 1, query: 'foo' }
        const result = computeNextFindReplaceSnapshot(cached, next)
        expect(result).toBe(next)
    })

    it('returns the next reference when currentIndex changes', () => {
        const cached: FindReplaceControllerState = { matchCount: 3, currentIndex: 1, query: 'foo' }
        const next: FindReplaceControllerState = { matchCount: 3, currentIndex: 2, query: 'foo' }
        const result = computeNextFindReplaceSnapshot(cached, next)
        expect(result).toBe(next)
    })

    it('returns the next reference when query changes', () => {
        const cached: FindReplaceControllerState = { matchCount: 3, currentIndex: 1, query: 'foo' }
        const next: FindReplaceControllerState = { matchCount: 3, currentIndex: 1, query: 'bar' }
        const result = computeNextFindReplaceSnapshot(cached, next)
        expect(result).toBe(next)
    })

    it('handles the empty/zero state idempotently', () => {
        // Two distinct empty objects: the cache holds one, the read
        // produces another. The hook must collapse them to a single
        // reference so useSyncExternalStore stops looping.
        const cached: FindReplaceControllerState = { matchCount: 0, currentIndex: 0, query: '' }
        const next: FindReplaceControllerState = { matchCount: 0, currentIndex: 0, query: '' }
        const result = computeNextFindReplaceSnapshot(cached, next)
        expect(result).toBe(cached)
    })

    it('FIND_REPLACE_EMPTY_STATE is frozen', () => {
        expect(Object.isFrozen(FIND_REPLACE_EMPTY_STATE)).toBe(true)
    })

    it('FIND_REPLACE_EMPTY_STATE matches its declared shape', () => {
        expect(FIND_REPLACE_EMPTY_STATE).toEqual({ matchCount: 0, currentIndex: 0, query: '' })
    })
})
