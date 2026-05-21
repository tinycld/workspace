import { LOCAL_ORIGIN, REMOTE_ORIGIN, SYNC_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { computeNextSnapshot } from '@tinycld/core/lib/realtime/use-y-undo-manager'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCell } from '../tinycld/calc/hooks/use-y-cell'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

// useYUndoManager itself is React-bound (keyboard listeners on
// window), so these tests exercise the underlying contract directly:
// a Y.UndoManager configured the same way the hook configures it
// must capture LOCAL_ORIGIN edits but not REMOTE_ORIGIN/SYNC_ORIGIN
// or default (null-origin) edits like bootstrap writes.
//
// This is the test that would have caught a mismatch between
// `setYCell`'s transaction origin and the manager's allowlist —
// without it, undo would silently no-op on real edits and the
// failure would be invisible until a user pressed Cmd-Z in the
// browser.

function newManager(doc: Y.Doc, captureTimeout = 500): Y.UndoManager {
    return new Y.UndoManager([doc.getMap(CELLS_MAP)], {
        captureTimeout,
        trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    })
}

describe('useYUndoManager allowlist', () => {
    it('captures setYCell edits as undoable', () => {
        const doc = new Y.Doc()
        const manager = newManager(doc)
        setYCell(doc, 'sheet1', 1, 1, 'hello')
        expect(manager.canUndo()).toBe(true)
    })

    it('does not capture REMOTE_ORIGIN updates', () => {
        const doc = new Y.Doc()
        const manager = newManager(doc)
        const cells = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        doc.transact(() => {
            const cell = new Y.Map<unknown>()
            cell.set('raw', 'remote')
            cell.set('display', 'remote')
            cells.set(yCellKey('sheet1', 1, 1), cell)
        }, REMOTE_ORIGIN)
        expect(manager.canUndo()).toBe(false)
    })

    it('does not capture SYNC_ORIGIN updates', () => {
        const doc = new Y.Doc()
        const manager = newManager(doc)
        const cells = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        doc.transact(() => {
            const cell = new Y.Map<unknown>()
            cell.set('raw', 'sync')
            cell.set('display', 'sync')
            cells.set(yCellKey('sheet1', 1, 1), cell)
        }, SYNC_ORIGIN)
        expect(manager.canUndo()).toBe(false)
    })

    it('does not capture default-origin updates (e.g. bootstrap with no explicit origin)', () => {
        const doc = new Y.Doc()
        const manager = newManager(doc)
        const cells = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        // Bootstrap writes use plain doc.transact() with no origin —
        // origin defaults to null. With LOCAL_ORIGIN as the only
        // tracked origin, these are not undoable, which is the
        // correct behavior (Cmd-Z shouldn't un-bootstrap).
        doc.transact(() => {
            const cell = new Y.Map<unknown>()
            cell.set('raw', 'bootstrap')
            cell.set('display', 'bootstrap')
            cells.set(yCellKey('sheet1', 1, 1), cell)
        })
        expect(manager.canUndo()).toBe(false)
    })

    it('undo restores the prior cell value across separate stack items', () => {
        // captureTimeout=0 forces every transaction into its own
        // undo stack item rather than grouping them. In production
        // we want grouping (so a typing burst is one undo step), but
        // for this test we want to verify two-step undo reaches the
        // first value rather than wiping the cell.
        const doc = new Y.Doc()
        const manager = newManager(doc, 0)
        const cells = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const key = yCellKey('sheet1', 1, 1)

        setYCell(doc, 'sheet1', 1, 1, 'first')
        expect(cells.get(key)?.get('raw')).toBe('first')

        setYCell(doc, 'sheet1', 1, 1, 'second')
        expect(cells.get(key)?.get('raw')).toBe('second')

        manager.undo()
        expect(cells.get(key)?.get('raw')).toBe('first')

        manager.undo()
        expect(cells.get(key)).toBeUndefined()

        manager.redo()
        expect(cells.get(key)?.get('raw')).toBe('first')
    })
})

// The toolbar buttons subscribe to canUndo/canRedo state via the hook's
// useSyncExternalStore wiring, which subscribes to these four events on
// the underlying Y.UndoManager. Locking the contract here protects the
// subscribe function in use-y-undo-manager.ts from silently breaking
// if upstream renames or removes any of them.
describe('Y.UndoManager stack-event contract (subscription surface)', () => {
    it("fires 'stack-item-added' when a tracked edit lands", () => {
        const doc = new Y.Doc()
        const manager = newManager(doc, 0)
        let added = 0
        manager.on('stack-item-added', () => {
            added++
        })
        setYCell(doc, 'sheet1', 1, 1, 'x')
        expect(added).toBeGreaterThan(0)
    })

    it("fires 'stack-item-popped' on undo and redo", () => {
        const doc = new Y.Doc()
        const manager = newManager(doc, 0)
        setYCell(doc, 'sheet1', 1, 1, 'x')
        let popped = 0
        manager.on('stack-item-popped', () => {
            popped++
        })
        manager.undo()
        expect(popped).toBe(1)
        manager.redo()
        expect(popped).toBe(2)
    })

    it("fires 'stack-cleared' on manager.clear()", () => {
        const doc = new Y.Doc()
        const manager = newManager(doc, 0)
        setYCell(doc, 'sheet1', 1, 1, 'x')
        let cleared = 0
        manager.on('stack-cleared', () => {
            cleared++
        })
        manager.clear()
        expect(cleared).toBe(1)
    })
})

// computeNextSnapshot is the cached-snapshot helper inside
// useYUndoManager. The snapshot getter passed to useSyncExternalStore
// MUST return the same object reference when nothing changed —
// otherwise React infinite-loops because every render observes a "new"
// snapshot. These tests pin that contract.
describe('computeNextSnapshot (useSyncExternalStore identity contract)', () => {
    it('returns the same reference when neither boolean changed', () => {
        const cached = { canUndo: false, canRedo: false }
        const next = computeNextSnapshot(cached, false, false)
        expect(next).toBe(cached)
    })

    it('returns the same reference when both booleans match cached values', () => {
        const cached = { canUndo: true, canRedo: false }
        const next = computeNextSnapshot(cached, true, false)
        expect(next).toBe(cached)
    })

    it('returns a new object when canUndo flipped', () => {
        const cached = { canUndo: false, canRedo: false }
        const next = computeNextSnapshot(cached, true, false)
        expect(next).not.toBe(cached)
        expect(next).toEqual({ canUndo: true, canRedo: false })
    })

    it('returns a new object when canRedo flipped', () => {
        const cached = { canUndo: true, canRedo: false }
        const next = computeNextSnapshot(cached, true, true)
        expect(next).not.toBe(cached)
        expect(next).toEqual({ canUndo: true, canRedo: true })
    })
})
