import { describe, expect, it, vi } from 'vitest'
import {
    type CellRange,
    createGridStore,
    type GridStoreDeps,
} from '../tinycld/calc/hooks/grid-store'
import {
    overallScope,
    primaryAnchor,
    primaryRange,
} from '../tinycld/calc/lib/selection-range'

// Fill-handle drag actions. Source range is captured at fillDragStart
// and never mutated; destRange grows under the pointer. Direction
// locks on the first move past the source's bottom or right edge and
// can't switch axes for the rest of the drag — Sheets behavior. End
// dispatches deps.applyFill exactly once with the final rectangle and
// snaps the post-fill selection to the dest rectangle.

interface StubDeps {
    deps: GridStoreDeps
    applyFill: ReturnType<typeof vi.fn>
}

function makeStubDeps(opts: { readOnly?: boolean } = {}): StubDeps {
    const applyFill = vi.fn()
    return {
        deps: {
            readOnly: opts.readOnly ?? false,
            writeCell: () => {},
            focusActiveInput: () => {},
            applyStructuralMutation: () => {},
            applyFill,
            resolveMergeAnchor: (row, col) => ({ row, col }),
            expandRangeOverMerges: r => r,
            findMergesInRange: () => [],
            mergeRange: () => {},
            unmergeAt: () => {},
            setFrozenRows: () => {},
            setFrozenCols: () => {},
        },
        applyFill,
    }
}

const SINGLE_CELL_RANGE: CellRange = {
    startRow: 2,
    endRow: 2,
    startCol: 3,
    endCol: 3,
}

const TWO_BY_ONE_RANGE: CellRange = {
    startRow: 1,
    endRow: 2,
    startCol: 1,
    endCol: 1,
}

describe('grid-store fill drag', () => {
    describe('initial state', () => {
        it('starts with fillDrag=null', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            expect(store.getState().fillDrag).toBeNull()
        })
    })

    describe('fillDragStart', () => {
        it('returns false and does nothing when there is no selection', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            const ok = store.getState().fillDragStart()
            expect(ok).toBe(false)
            expect(store.getState().fillDrag).toBeNull()
        })

        it('returns false in readOnly mode', () => {
            const stub = makeStubDeps({ readOnly: true })
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            const ok = store.getState().fillDragStart()
            expect(ok).toBe(false)
            expect(store.getState().fillDrag).toBeNull()
        })

        it('captures a single-cell source when only the anchor is selected', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 4, col: 5 })
            const ok = store.getState().fillDragStart()
            expect(ok).toBe(true)
            const drag = store.getState().fillDrag
            expect(drag).not.toBeNull()
            expect(drag?.sourceRange).toEqual({
                startRow: 4,
                endRow: 4,
                startCol: 5,
                endCol: 5,
            })
            expect(drag?.destRange).toEqual(drag?.sourceRange)
            expect(drag?.direction).toBe('down')
            expect(drag?.directionLocked).toBe(false)
        })

        it('captures the multi-cell selectionRange as source', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().extendActiveRangeTo({ row: 2, col: 1 })
            const ok = store.getState().fillDragStart()
            expect(ok).toBe(true)
            expect(store.getState().fillDrag?.sourceRange).toEqual(TWO_BY_ONE_RANGE)
            expect(store.getState().fillDrag?.destRange).toEqual(TWO_BY_ONE_RANGE)
        })
    })

    describe('fillDragMove', () => {
        it('is a no-op when there is no active drag', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().fillDragMove({ row: 5, col: 5 })
            expect(store.getState().fillDrag).toBeNull()
        })

        it('extends down when the pointer moves past the source bottom', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().extendActiveRangeTo({ row: 2, col: 1 })
            store.getState().fillDragStart()
            store.getState().fillDragMove({ row: 5, col: 1 })
            const drag = store.getState().fillDrag
            expect(drag?.direction).toBe('down')
            expect(drag?.directionLocked).toBe(true)
            expect(drag?.destRange).toEqual({
                startRow: 1,
                endRow: 5,
                startCol: 1,
                endCol: 1,
            })
        })

        it('extends right when the pointer moves past the source right edge', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().fillDragStart()
            store.getState().fillDragMove({ row: 1, col: 4 })
            const drag = store.getState().fillDrag
            expect(drag?.direction).toBe('right')
            expect(drag?.directionLocked).toBe(true)
            expect(drag?.destRange).toEqual({
                startRow: 1,
                endRow: 1,
                startCol: 1,
                endCol: 4,
            })
        })

        it('locks to the dominant axis when both deltas are positive', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            // Source 1x1 at (1,1). Move to (3,5) → dCol=4 > dRow=2,
            // direction locks to 'right'.
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().fillDragStart()
            store.getState().fillDragMove({ row: 3, col: 5 })
            expect(store.getState().fillDrag?.direction).toBe('right')
            expect(store.getState().fillDrag?.destRange).toEqual({
                startRow: 1,
                endRow: 1,
                startCol: 1,
                endCol: 5,
            })
        })

        it('breaks ties by picking down when both deltas are equal', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().fillDragStart()
            // dRow == dCol == 3, ties go to 'down'.
            store.getState().fillDragMove({ row: 4, col: 4 })
            expect(store.getState().fillDrag?.direction).toBe('down')
            expect(store.getState().fillDrag?.destRange).toEqual({
                startRow: 1,
                endRow: 4,
                startCol: 1,
                endCol: 1,
            })
        })

        it('keeps the locked axis once chosen, ignoring the other axis', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().fillDragStart()
            // Lock 'down' on the first move.
            store.getState().fillDragMove({ row: 5, col: 1 })
            expect(store.getState().fillDrag?.direction).toBe('down')
            // Now drag dominantly right — the lock holds at 'down',
            // and because dRow <= 0 the dest collapses to the source
            // (the move is along the wrong axis).
            store.getState().fillDragMove({ row: 1, col: 7 })
            const drag = store.getState().fillDrag
            expect(drag?.direction).toBe('down')
            expect(drag?.directionLocked).toBe(true)
            expect(drag?.destRange).toEqual(drag?.sourceRange)
        })

        it('extends further along the locked axis when subsequent moves continue down', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().fillDragStart()
            store.getState().fillDragMove({ row: 3, col: 1 })
            store.getState().fillDragMove({ row: 8, col: 1 })
            expect(store.getState().fillDrag?.destRange.endRow).toBe(8)
        })

        it('clamps dest back to source when the pointer drags above the source', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 5, col: 5 })
            store.getState().fillDragStart()
            // Drag back into / above the source (dRow <= 0, dCol <= 0):
            // dest collapses to source. directionLocked stays false
            // because we never escaped.
            store.getState().fillDragMove({ row: 3, col: 3 })
            const drag = store.getState().fillDrag
            expect(drag?.destRange).toEqual(drag?.sourceRange)
            expect(drag?.directionLocked).toBe(false)
        })

        it('clamps dest back to source on drag-back after the lock fires', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 5, col: 5 })
            store.getState().fillDragStart()
            store.getState().fillDragMove({ row: 9, col: 5 })
            expect(store.getState().fillDrag?.directionLocked).toBe(true)
            // Now drag back to / above source — dest collapses but the
            // direction lock is preserved so the user can drag down
            // again without re-deciding the axis.
            store.getState().fillDragMove({ row: 5, col: 5 })
            const drag = store.getState().fillDrag
            expect(drag?.destRange).toEqual(drag?.sourceRange)
            expect(drag?.directionLocked).toBe(true)
            expect(drag?.direction).toBe('down')
        })
    })

    describe('fillDragEnd', () => {
        it('is a no-op with no active drag', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().fillDragEnd()
            expect(stub.applyFill).not.toHaveBeenCalled()
            expect(store.getState().fillDrag).toBeNull()
        })

        it('clears fillDrag without calling applyFill when destRange equals sourceRange', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 2, col: 3 })
            store.getState().fillDragStart()
            store.getState().fillDragEnd()
            expect(stub.applyFill).not.toHaveBeenCalled()
            expect(store.getState().fillDrag).toBeNull()
            // Selection isn't touched by the no-op end.
            expect(primaryAnchor(store.getState().selection)).toEqual({ row: 2, col: 3 })
        })

        it('calls applyFill once with the captured source/dest/direction when extended', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().extendActiveRangeTo({ row: 2, col: 1 })
            store.getState().fillDragStart()
            store.getState().fillDragMove({ row: 5, col: 1 })
            store.getState().fillDragEnd()
            expect(stub.applyFill).toHaveBeenCalledTimes(1)
            expect(stub.applyFill).toHaveBeenCalledWith({
                sourceRange: TWO_BY_ONE_RANGE,
                destRange: {
                    startRow: 1,
                    endRow: 5,
                    startCol: 1,
                    endCol: 1,
                },
                direction: 'down',
            })
        })

        it('snaps selection to the full dest rectangle after a successful fill', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().fillDragStart()
            store.getState().fillDragMove({ row: 1, col: 5 })
            store.getState().fillDragEnd()
            const s = store.getState()
            expect(primaryAnchor(s.selection)).toEqual({ row: 1, col: 1 })
            expect(primaryRange(s.selection)).toEqual({
                startRow: 1,
                endRow: 1,
                startCol: 1,
                endCol: 5,
            })
            expect(overallScope(s.selection)).toBe('cells')
            expect(s.fillDrag).toBeNull()
        })

        it('clears fillDrag last so post-fill state has no drag artifact', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 2, col: 2 })
            store.getState().fillDragStart()
            store.getState().fillDragMove({ row: 5, col: 2 })
            store.getState().fillDragEnd()
            expect(store.getState().fillDrag).toBeNull()
        })
    })

    describe('action identity', () => {
        // Cells subscribe via `useGridStore(s => s.someAction)` and
        // rely on the function reference being stable across state
        // changes. If we ever re-create the action on each set(), every
        // cell re-renders on every keystroke — the perf-critical
        // property the store exists to preserve. Pin it.
        it('keeps fillDrag action references stable across selection changes', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            const before = {
                start: store.getState().fillDragStart,
                move: store.getState().fillDragMove,
                end: store.getState().fillDragEnd,
            }
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().fillDragStart()
            store.getState().fillDragMove({ row: 3, col: 1 })
            store.getState().fillDragEnd()
            const after = {
                start: store.getState().fillDragStart,
                move: store.getState().fillDragMove,
                end: store.getState().fillDragEnd,
            }
            expect(after.start).toBe(before.start)
            expect(after.move).toBe(before.move)
            expect(after.end).toBe(before.end)
        })
    })

    it('passes SINGLE_CELL_RANGE through detection without breakage (smoke)', () => {
        // Smoke test that exercises the SINGLE_CELL_RANGE constant so
        // it isn't unused-imported. Mostly here to keep the test file
        // self-contained — selectCell + fillDragStart already produces
        // an equivalent single-cell source range, but pinning the
        // expected shape gives reviewers a quick reference for what a
        // "minimal" fill source looks like.
        const stub = makeStubDeps()
        const store = createGridStore(stub.deps)
        store.getState().selectCell({ row: 2, col: 3 })
        store.getState().fillDragStart()
        expect(store.getState().fillDrag?.sourceRange).toEqual(SINGLE_CELL_RANGE)
    })
})
