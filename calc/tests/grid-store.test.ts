import { describe, expect, it, vi } from 'vitest'
import {
    createGridStore,
    type GridStoreDeps,
    type StructuralOp,
} from '../tinycld/calc/hooks/grid-store'
import { primaryAnchor, primaryRange } from '../tinycld/calc/lib/selection-range'

// The Grid's per-instance store carries selection, edit-session,
// ref-drag, suggestion popover, and menu state. These tests pin the
// state-transition contract — the new selection model (one ordered
// list of SubRanges) collapses to single-rectangle behavior when
// ranges.length === 1.

interface StubDeps {
    deps: GridStoreDeps
    writeCalls: Array<{ row: number; col: number; value: string }>
    structuralOps: StructuralOp[]
    frozenRowCalls: number[]
    frozenColCalls: number[]
    focusCalls: number
}

function makeStubDeps(opts: { readOnly?: boolean } = {}): StubDeps {
    const writeCalls: StubDeps['writeCalls'] = []
    const structuralOps: StructuralOp[] = []
    const frozenRowCalls: number[] = []
    const frozenColCalls: number[] = []
    let focusCalls = 0
    return {
        deps: {
            readOnly: opts.readOnly ?? false,
            writeCell: (row, col, value) => writeCalls.push({ row, col, value }),
            focusActiveInput: () => {
                focusCalls += 1
            },
            applyStructuralMutation: op => structuralOps.push(op),
            applyFill: () => {},
            resolveMergeAnchor: (row, col) => ({ row, col }),
            expandRangeOverMerges: r => r,
            findMergesInRange: () => [],
            mergeRange: () => {},
            unmergeAt: () => {},
            setFrozenRows: n => frozenRowCalls.push(n),
            setFrozenCols: n => frozenColCalls.push(n),
        },
        writeCalls,
        structuralOps,
        frozenRowCalls,
        frozenColCalls,
        get focusCalls() {
            return focusCalls
        },
    }
}

describe('createGridStore', () => {
    describe('selectCell', () => {
        it('sets the primary anchor and clears edit/pendingSelection', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 })
            store.getState().setEditDraft(1, 1, 'foo')
            store.getState().selectCell({ row: 2, col: 3 })
            const s = store.getState()
            expect(primaryAnchor(s.selection)).toEqual({ row: 2, col: 3 })
            expect(s.editSession).toBeNull()
            expect(s.pendingSelection).toBeNull()
        })

        it('commits an in-flight edit on a different cell before moving', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 })
            store.getState().setEditDraft(1, 1, 'value')
            store.getState().selectCell({ row: 2, col: 2 })
            expect(stub.writeCalls).toEqual([{ row: 1, col: 1, value: 'value' }])
        })

        it('does not commit when readOnly even with an in-flight edit', () => {
            const stub = makeStubDeps({ readOnly: true })
            const store = createGridStore(stub.deps)
            // editCell is a no-op when readOnly, so seed the session
            // directly via setState to simulate an edit that was open
            // before readOnly toggled.
            store.setState({ editSession: { row: 1, col: 1, draft: 'value' } })
            store.getState().selectCell({ row: 2, col: 2 })
            expect(stub.writeCalls).toHaveLength(0)
        })

        it('does not commit when selecting the same cell that is being edited', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 5, col: 5 })
            store.getState().setEditDraft(5, 5, 'mid')
            store.getState().selectCell({ row: 5, col: 5 })
            expect(stub.writeCalls).toHaveLength(0)
            // editSession is cleared because selectCell semantically
            // ends the session, even on the same cell.
            expect(store.getState().editSession).toBeNull()
        })
    })

    describe('extendActiveRangeTo', () => {
        // Multi-cell selection: the active (last) sub-range's range
        // grows to bound (anchor, target). Normalization (start ≤
        // end) is pinned here.
        it('builds a normalized range from the anchor to the target', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 2, col: 3 })
            store.getState().extendActiveRangeTo({ row: 5, col: 7 })
            const s = store.getState()
            expect(primaryAnchor(s.selection)).toEqual({ row: 2, col: 3 })
            expect(primaryRange(s.selection)).toEqual({
                startRow: 2,
                endRow: 5,
                startCol: 3,
                endCol: 7,
            })
        })

        it('normalizes when the target is above/left of the anchor', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 5, col: 7 })
            store.getState().extendActiveRangeTo({ row: 2, col: 3 })
            expect(primaryRange(store.getState().selection)).toEqual({
                startRow: 2,
                endRow: 5,
                startCol: 3,
                endCol: 7,
            })
        })

        it('collapses to a single-cell range when target equals anchor', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 4, col: 4 })
            store.getState().extendActiveRangeTo({ row: 4, col: 4 })
            expect(primaryRange(store.getState().selection)).toEqual({
                startRow: 4,
                endRow: 4,
                startCol: 4,
                endCol: 4,
            })
        })

        it('falls through to selectCell when there is no anchor yet', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().extendActiveRangeTo({ row: 3, col: 3 })
            const s = store.getState()
            expect(primaryAnchor(s.selection)).toEqual({ row: 3, col: 3 })
            expect(primaryRange(s.selection)).toEqual({
                startRow: 3,
                endRow: 3,
                startCol: 3,
                endCol: 3,
            })
        })

        it('commits an in-flight edit on a different cell before extending', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().editCell({ row: 1, col: 1 }, 'abc')
            store.getState().setEditDraft(1, 1, 'value')
            store.getState().extendActiveRangeTo({ row: 3, col: 3 })
            expect(stub.writeCalls).toEqual([{ row: 1, col: 1, value: 'value' }])
            expect(store.getState().editSession).toBeNull()
        })

        it('does not commit when extending to the same cell that is being edited', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 4, col: 4 })
            store.getState().editCell({ row: 4, col: 4 }, 'live')
            store.getState().extendActiveRangeTo({ row: 4, col: 4 })
            expect(stub.writeCalls).toHaveLength(0)
            expect(store.getState().editSession).toBeNull()
        })

        it('does not commit when readOnly even with an in-flight edit', () => {
            const stub = makeStubDeps({ readOnly: true })
            const store = createGridStore(stub.deps)
            store.setState({
                selection: {
                    ranges: [
                        {
                            anchor: { row: 1, col: 1 },
                            range: { startRow: 1, endRow: 1, startCol: 1, endCol: 1 },
                            scope: 'cells',
                        },
                    ],
                },
                editSession: { row: 1, col: 1, draft: 'value' },
            })
            store.getState().extendActiveRangeTo({ row: 3, col: 3 })
            expect(stub.writeCalls).toHaveLength(0)
        })
    })

    describe('drag-select gesture sequence', () => {
        it('anchor stays fixed across many extendActiveRangeTo calls', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 2, col: 2 })
            store.getState().extendActiveRangeTo({ row: 3, col: 3 })
            store.getState().extendActiveRangeTo({ row: 5, col: 5 })
            store.getState().extendActiveRangeTo({ row: 4, col: 6 })
            const s = store.getState()
            expect(primaryAnchor(s.selection)).toEqual({ row: 2, col: 2 })
            expect(primaryRange(s.selection)).toEqual({
                startRow: 2,
                endRow: 4,
                startCol: 2,
                endCol: 6,
            })
        })

        it('shrinks the range back when the pointer returns toward the anchor', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().extendActiveRangeTo({ row: 5, col: 5 })
            store.getState().extendActiveRangeTo({ row: 3, col: 3 })
            expect(primaryRange(store.getState().selection)).toEqual({
                startRow: 1,
                endRow: 3,
                startCol: 1,
                endCol: 3,
            })
        })

        it('collapses to a single-cell range when the drag ends back on the anchor', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 4, col: 4 })
            store.getState().extendActiveRangeTo({ row: 6, col: 6 })
            store.getState().extendActiveRangeTo({ row: 4, col: 4 })
            const s = store.getState()
            expect(primaryRange(s.selection)).toEqual({
                startRow: 4,
                endRow: 4,
                startCol: 4,
                endCol: 4,
            })
            expect(primaryAnchor(s.selection)).toEqual({ row: 4, col: 4 })
        })
    })

    describe('selection collapse on single-cell actions', () => {
        // Any action that anchors a single cell — selectCell, editCell,
        // commitEdit — must collapse the selection to a single sub-
        // range so subsequent actions don't accidentally apply across
        // a stale rectangle.
        it('selectCell collapses an existing multi-cell range', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().extendActiveRangeTo({ row: 3, col: 3 })
            store.getState().selectCell({ row: 5, col: 5 })
            const r = primaryRange(store.getState().selection)
            expect(r).toEqual({ startRow: 5, endRow: 5, startCol: 5, endCol: 5 })
        })

        it('editCell collapses an existing multi-cell range', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().extendActiveRangeTo({ row: 3, col: 3 })
            store.getState().editCell({ row: 1, col: 1 }, '')
            const r = primaryRange(store.getState().selection)
            expect(r).toEqual({ startRow: 1, endRow: 1, startCol: 1, endCol: 1 })
        })

        it('commitEdit collapses an existing multi-cell range', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().extendActiveRangeTo({ row: 3, col: 3 })
            store.setState({ editSession: { row: 1, col: 1, draft: 'x' } })
            store.getState().commitEdit(1, 1, 'x')
            const r = primaryRange(store.getState().selection)
            expect(r).toEqual({ startRow: 1, endRow: 1, startCol: 1, endCol: 1 })
        })
    })

    describe('openCellContextMenu range preservation', () => {
        it('preserves the range when the click lands inside it', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 2, col: 2 })
            store.getState().extendActiveRangeTo({ row: 4, col: 4 })
            store.getState().openCellContextMenu(3, 3, 0, 0)
            const s = store.getState()
            expect(primaryAnchor(s.selection)).toEqual({ row: 2, col: 2 })
            expect(primaryRange(s.selection)).toEqual({
                startRow: 2,
                endRow: 4,
                startCol: 2,
                endCol: 4,
            })
        })

        it('collapses the selection when the click lands outside the range', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 2, col: 2 })
            store.getState().extendActiveRangeTo({ row: 4, col: 4 })
            store.getState().openCellContextMenu(9, 9, 0, 0)
            const s = store.getState()
            expect(primaryAnchor(s.selection)).toEqual({ row: 9, col: 9 })
            expect(primaryRange(s.selection)).toEqual({
                startRow: 9,
                endRow: 9,
                startCol: 9,
                endCol: 9,
            })
        })
    })

    describe('openHeaderMenu', () => {
        it('opens the menu and pre-selects the column when click is outside the selection', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 2, col: 2 })
            store.getState().openHeaderMenu('col', 5, 100, 10, 20)
            const s = store.getState()
            expect(s.headerMenu).toEqual({
                axis: 'col',
                index: 5,
                cursor: { x: 10, y: 20 },
            })
            // Pre-selected the whole column 5 (axisSpan rows tall).
            expect(primaryRange(s.selection)).toEqual({
                startRow: 1,
                endRow: 100,
                startCol: 5,
                endCol: 5,
            })
            expect(primaryAnchor(s.selection)).toEqual({ row: 1, col: 5 })
        })

        it('preserves a multi-column selection when click lands inside it', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            // Select columns 3..7 by selecting column 3 then extending.
            store.getState().selectColumn(3, 10)
            store.getState().extendActiveColumnTo(7, 10)
            store.getState().openHeaderMenu('col', 5, 10, 0, 0)
            const s = store.getState()
            expect(primaryRange(s.selection)).toEqual({
                startRow: 1,
                endRow: 10,
                startCol: 3,
                endCol: 7,
            })
        })

        it('opens the menu and pre-selects the row when click is outside the selection', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 2, col: 2 })
            store.getState().openHeaderMenu('row', 8, 12, 5, 6)
            const s = store.getState()
            expect(s.headerMenu).toEqual({
                axis: 'row',
                index: 8,
                cursor: { x: 5, y: 6 },
            })
            expect(primaryRange(s.selection)).toEqual({
                startRow: 8,
                endRow: 8,
                startCol: 1,
                endCol: 12,
            })
            expect(primaryAnchor(s.selection)).toEqual({ row: 8, col: 1 })
        })

        it('closeHeaderMenu clears the target', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().openHeaderMenu('col', 1, 10, 0, 0)
            expect(store.getState().headerMenu).not.toBeNull()
            store.getState().closeHeaderMenu()
            expect(store.getState().headerMenu).toBeNull()
        })
    })

    describe('editCell', () => {
        it('opens an edit session with the given draft and snaps cursor to end', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 3, col: 4 }, 'hello')
            const s = store.getState()
            expect(s.editSession).toEqual({ row: 3, col: 4, draft: 'hello' })
            expect(s.pendingSelection).toEqual({ start: 5, end: 5 })
            expect(s.activeSurface).toBe('cell')
            expect(store.refs.editCursor.current).toEqual({ start: 5, end: 5 })
        })

        it('is a no-op when readOnly', () => {
            const stub = makeStubDeps({ readOnly: true })
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, 'hi')
            expect(store.getState().editSession).toBeNull()
        })
    })

    describe('setEditDraft', () => {
        it('updates the draft', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 })
            store.getState().setEditDraft(1, 1, 'abc')
            expect(store.getState().editSession).toEqual({ row: 1, col: 1, draft: 'abc' })
        })

        it('snaps cursor to end when the session is fresh (different cell)', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, 'foo')
            store.setState({ editSession: { row: 2, col: 2, draft: '' } })
            store.refs.editCursor.current = { start: 999, end: 999 }
            store.getState().setEditDraft(2, 2, 'hello')
            expect(store.refs.editCursor.current).toEqual({ start: 5, end: 5 })
        })

        it('snaps cursor back into bounds when the new draft is shorter than the cursor position', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, 'abcdef')
            store.getState().setEditSelection(1, 1, 6, 6)
            store.getState().setEditDraft(1, 1, 'abc')
            expect(store.refs.editCursor.current).toEqual({ start: 3, end: 3 })
        })

        it('leaves cursor alone on in-session edits where cursor is still in bounds', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, 'abc')
            store.getState().setEditSelection(1, 1, 2, 2)
            store.getState().setEditDraft(1, 1, 'abcdef')
            expect(store.refs.editCursor.current).toEqual({ start: 2, end: 2 })
        })
    })

    describe('commitEdit', () => {
        it('writes the value and clears the edit session', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 7, col: 8 })
            store.getState().setEditDraft(7, 8, 'final')
            store.getState().commitEdit(7, 8, 'final')
            expect(stub.writeCalls).toEqual([{ row: 7, col: 8, value: 'final' }])
            expect(store.getState().editSession).toBeNull()
            expect(primaryAnchor(store.getState().selection)).toEqual({ row: 7, col: 8 })
        })

        it('does not write when readOnly', () => {
            const stub = makeStubDeps({ readOnly: true })
            const store = createGridStore(stub.deps)
            store.getState().commitEdit(1, 1, 'x')
            expect(stub.writeCalls).toHaveLength(0)
        })
    })

    describe('cellRefTap', () => {
        it('returns false when there is no active edit session', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            expect(store.getState().cellRefTap(1, 1)).toBe(false)
        })

        it('inserts a ref into the draft when the cursor is in an acceptable position', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, '=')
            const handled = store.getState().cellRefTap(5, 2) // B5
            expect(handled).toBe(true)
            expect(store.getState().editSession?.draft).toBe('=B5')
            expect(stub.focusCalls).toBe(1)
        })

        it('returns false when the cursor is not in a ref-acceptable position', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, 'foo')
            expect(store.getState().cellRefTap(5, 2)).toBe(false)
        })
    })

    describe('refDrag lifecycle', () => {
        it('start sets refDrag and inserts the anchor', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, '=')
            store.getState().cellRefDragStart(5, 2)
            const drag = store.getState().refDrag
            expect(drag).not.toBeNull()
            expect(drag?.anchor).toEqual({ row: 5, col: 2 })
            expect(drag?.end).toEqual({ row: 5, col: 2 })
        })

        it('move updates refDrag.end without changing draft', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, '=')
            store.getState().cellRefDragStart(5, 2)
            const draftBefore = store.getState().editSession?.draft
            store.getState().cellRefDragMove(7, 4)
            expect(store.getState().refDrag?.end).toEqual({ row: 7, col: 4 })
            expect(store.getState().editSession?.draft).toBe(draftBefore)
        })

        it('end clears refDrag and refocuses', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, '=')
            store.getState().cellRefDragStart(5, 2)
            store.getState().cellRefDragEnd()
            expect(store.getState().refDrag).toBeNull()
            expect(stub.focusCalls).toBe(1)
        })

        it('start returns false when the cursor is not ref-acceptable', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, 'abc')
            expect(store.getState().cellRefDragStart(5, 2)).toBe(false)
            expect(store.getState().refDrag).toBeNull()
        })

        // End-to-end: typing =SUM( and dragging A1 → A3 should leave
        // the draft as =SUM(A1:A3). useRefDragExtender is the React
        // glue that watches refDrag identity and rewrites the draft;
        // here we drive its body inline so the contract is pinned at
        // the store level.
        it('drag from A1 to A3 inside =SUM( yields =SUM(A1:A3)', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 4, col: 4 }, '=SUM(')
            expect(store.getState().cellRefDragStart(1, 1)).toBe(true)
            expect(store.getState().editSession?.draft).toBe('=SUM(A1')
            // Simulate useRefDragExtender for each move: recompute the
            // range and call extendRefDragDraft, matching what the hook
            // does on every refDrag identity change.
            const applyExtender = () => {
                const drag = store.getState().refDrag
                const session = store.getState().editSession
                if (drag == null || session == null) return
                const minRow = Math.min(drag.anchor.row, drag.end.row)
                const maxRow = Math.max(drag.anchor.row, drag.end.row)
                const minCol = Math.min(drag.anchor.col, drag.end.col)
                const maxCol = Math.max(drag.anchor.col, drag.end.col)
                const range =
                    minRow === maxRow && minCol === maxCol
                        ? `${String.fromCharCode(64 + minCol)}${minRow}`
                        : `${String.fromCharCode(64 + minCol)}${minRow}:${String.fromCharCode(64 + maxCol)}${maxRow}`
                const before = session.draft.slice(0, drag.lastSlice.start)
                const after = session.draft.slice(drag.lastSlice.end)
                const nextDraft = `${before}${range}${after}`
                const nextSlice = {
                    start: before.length,
                    end: before.length + range.length,
                }
                store.getState().extendRefDragDraft(nextDraft, nextSlice)
            }
            store.getState().cellRefDragMove(3, 1)
            applyExtender()
            expect(store.getState().editSession?.draft).toBe('=SUM(A1:A3')
            store.getState().cellRefDragEnd()
            expect(store.getState().refDrag).toBeNull()
        })
    })

    describe('suggestion popover', () => {
        it('moveSuggestion wraps modulo total', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().moveSuggestion(1, 3)
            expect(store.getState().suggestionIndex).toBe(1)
            store.getState().moveSuggestion(2, 3)
            expect(store.getState().suggestionIndex).toBe(0)
            store.getState().moveSuggestion(-1, 3)
            expect(store.getState().suggestionIndex).toBe(2)
        })

        it('insertFunction replaces the in-progress token with name(', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, '=LE')
            store.getState().insertFunction('LEFT')
            expect(store.getState().editSession?.draft).toBe('=LEFT(')
        })

        it('dismissSuggestions records the current draft as dismissed', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, '=LE')
            store.getState().dismissSuggestions()
            expect(store.getState().dismissedDraft).toBe('=LE')
        })

        it('typing past the dismissed draft re-arms the popover', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, '=LE')
            store.getState().dismissSuggestions()
            store.getState().setEditDraft(1, 1, '=LEN')
            expect(store.getState().dismissedDraft).toBeNull()
        })

        it('ending an edit session resets suggestionIndex and dismissedDraft', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, '=LE')
            store.getState().moveSuggestion(2, 5)
            store.getState().dismissSuggestions()
            store.getState().cancelEdit()
            expect(store.getState().suggestionIndex).toBe(0)
            expect(store.getState().dismissedDraft).toBeNull()
        })
    })

    describe('subscribe identity contract', () => {
        // Per-cell selectors return primitives so cells can short-
        // circuit on equality. These tests pin the identity behavior
        // of the underlying state slots.
        it('selecting the same cell coordinates produces a NEW selection object', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            const before = store.getState().selection
            store.getState().selectCell({ row: 1, col: 1 })
            const after = store.getState().selection
            expect(before).not.toBe(after)
            expect(primaryAnchor(after)).toEqual({ row: 1, col: 1 })
        })

        it('action identities are stable across getState() calls', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            const a1 = store.getState().selectCell
            const a2 = store.getState().selectCell
            expect(a1).toBe(a2)
        })

        it('subscriber fires only when watched fields change', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            const fired = vi.fn()
            store.subscribe((state, prev) => {
                if (state.selection !== prev.selection || state.editSession !== prev.editSession) {
                    fired()
                }
            })
            store.getState().setSuggestionIndex(3)
            expect(fired).toHaveBeenCalledTimes(0)
            store.getState().selectCell({ row: 1, col: 1 })
            expect(fired).toHaveBeenCalledTimes(1)
        })
    })

    describe('clearSelection', () => {
        it('clears just the anchor when no range is set', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 3, col: 4 })
            store.getState().clearSelection()
            expect(stub.writeCalls).toEqual([{ row: 3, col: 4, value: '' }])
        })

        it('walks every cell in a range', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 2, col: 2 })
            store.getState().extendActiveRangeTo({ row: 3, col: 4 })
            store.getState().clearSelection()
            expect(stub.writeCalls).toEqual([
                { row: 2, col: 2, value: '' },
                { row: 2, col: 3, value: '' },
                { row: 2, col: 4, value: '' },
                { row: 3, col: 2, value: '' },
                { row: 3, col: 3, value: '' },
                { row: 3, col: 4, value: '' },
            ])
        })

        it('is a no-op when nothing is selected', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().clearSelection()
            expect(stub.writeCalls).toEqual([])
        })

        it('is a no-op when readOnly', () => {
            const stub = makeStubDeps({ readOnly: true })
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().extendActiveRangeTo({ row: 2, col: 2 })
            store.getState().clearSelection()
            expect(stub.writeCalls).toEqual([])
        })
    })
})
