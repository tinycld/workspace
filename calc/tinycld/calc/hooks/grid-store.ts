// Per-Grid Zustand store. One instance per <Grid> mount, owned by a
// GridStoreProvider; never a module-level singleton — two Grids on the
// same screen each get their own state.
//
// Why Zustand here (not useReducer, not useState×N):
//   1. Cells subscribe to *primitive* selectors (booleans for
//      isSelected/isEditing, the draft string only for the editing
//      cell). Non-subscribers — the 99% of cells whose isSelected stays
//      false — short-circuit on reference equality and skip render.
//      That's the only way a single-keystroke edit re-renders 1 cell
//      instead of N visible cells.
//   2. Imperative reads via getState() eliminate the editSession ref
//      mirror that previously paired useState + useEffect (the exact
//      anti-pattern CLAUDE.md flags).
//   3. Awareness publishing becomes a single store.subscribe at the
//      Grid root rather than ~10 publishLocal calls scattered through
//      every action.
//
// All side effects (Y.Doc writes, input.focus(), awareness publish)
// flow through GridStoreDeps so the store stays pure and testable in
// isolation — yjs is never imported here.
//
// Selection model: one ordered list of sub-ranges
// (`selection: Selection`). A single-cell or single-rectangle
// selection has `ranges.length === 1`; disjoint multi-selection has
// `ranges.length > 1`. The LAST entry is the "primary" — its anchor
// drives the formula bar, keyboard nav, and awareness; Shift-click
// extends it. Ctrl-click appends a new entry (Sheets parity). See
// `lib/selection-range.ts` for the helper layer call sites use.
import { createStore as createVanillaStore, type StoreApi } from 'zustand/vanilla'
import {
    applyFunctionInsertion,
    type DraftSelection,
    parseFunctionToken,
} from '../lib/formula/autocomplete'
import {
    applyCellRefInsertion,
    extendCellRefInsertion,
    formatRef,
    isRefAcceptable,
} from '../lib/formula/cell-ref-insertion'
import {
    clampSubRangesForDelete,
    isDisjoint as isDisjointSelection,
    primaryAnchor as readPrimaryAnchor,
    primaryRange as readPrimaryRange,
    rangeContainsCell,
    type Selection,
    shiftIndexForInsert,
    shiftSubRangesForInsert,
    singleCellSelection,
    singleRectSelection,
    type SubRange,
    subRangeAtCell,
} from '../lib/selection-range'

export interface SelectedCell {
    row: number
    col: number
}

// CellRange is always normalized: startRow ≤ endRow, startCol ≤ endCol.
export interface CellRange {
    startRow: number
    startCol: number
    endRow: number
    endCol: number
}

export interface EditSession {
    row: number
    col: number
    draft: string
}

// Which input most recently held focus. Drives suggestion-popover
// anchoring (formula bar coords vs. editing-cell coords).
export type ActiveSurface = 'bar' | 'cell'

// SelectionScope discriminates how a single SubRange should be
// interpreted by mutation paths. 'cells' is the default body selection
// (a rectangle of cells). 'row' / 'column' / 'sheet' indicate the user
// clicked a row/column header or the corner cell — toolbar setters
// route writes to per-row/per-col/per-sheet style metadata instead of
// iterating cells. Stored per SubRange (not top-level), so a disjoint
// selection can mix scopes (row 2 + column C).
export type SelectionScope = 'cells' | 'row' | 'column' | 'sheet'

// A ref drag in progress while a formula is being edited.
export interface RefDrag {
    anchor: { row: number; col: number }
    end: { row: number; col: number }
    lastSlice: { start: number; end: number }
}

// Fill-handle drag in progress.
export interface FillDrag {
    sourceRange: CellRange
    destRange: CellRange
    direction: 'down' | 'right'
    directionLocked: boolean
}

export interface FormulaBarRect {
    left: number
    top: number
    width: number
    height: number
}

export interface ContextTarget {
    cell: SelectedCell
    cursor: { x: number; y: number }
}

export interface CommentTarget {
    cell: SelectedCell
    cursor: { x: number; y: number }
}

export interface HandleMenuTarget {
    axis: 'col' | 'row'
    index: number
    cursor: { x: number; y: number }
}

// Right-click menu on a column-label or row-label cell. Distinct from
// HandleMenuTarget (resize handle between headers) so the two menus
// can render independently and carry their own action sets.
export interface HeaderMenuTarget {
    axis: 'col' | 'row'
    index: number
    cursor: { x: number; y: number }
}

// Transient banner state — single union so future selection-level
// status messages (e.g. "Can't sort disjoint selection") slot in
// without growing the state surface. Today's only kind is the
// clipboard refusal raised by useClipboard when copy/cut is invoked on
// a disjoint selection.
export type SelectionStatus = { kind: 'copy-disjoint-refused' } | null

// GridState carries everything the Grid's UI subtree subscribes to.
// Y.Doc data (cell raw/formula/style) is intentionally NOT here.
export interface GridState {
    // The ordered selection. null = nothing selected. Non-null has
    // at least one SubRange. The last entry is the "primary" (its
    // anchor drives formula bar / keyboard nav / awareness; Shift-
    // click extends its range). Ctrl-click appends.
    selection: Selection
    editSession: EditSession | null
    pendingSelection: DraftSelection | null
    activeSurface: ActiveSurface
    refDrag: RefDrag | null
    suggestionIndex: number
    dismissedDraft: string | null
    formulaBarRect: FormulaBarRect | null
    // y offset (in Grid-root pixels) of the body row container — the
    // <View> that holds the row header and the cells viewport. Lets
    // popovers anchored to a cell or to the formula bar position
    // themselves relative to the actual rendered layout instead of a
    // sum of brittle layout constants (the menubar, status banners,
    // and toolbar drift in height independently of the Grid).
    bodyTop: number | null
    contextTarget: ContextTarget | null
    commentTarget: CommentTarget | null
    handleMenu: HandleMenuTarget | null
    headerMenu: HeaderMenuTarget | null
    clipboardMarker: string | null
    copySourceRange: CellRange | null
    cutPending: boolean
    fillDrag: FillDrag | null
    sortDialogOpen: boolean
    filterDialogCol: number | null
    sortStatus: { mergesBroken: number } | null
    // Transient banner for selection-level status messages (e.g.
    // refused copy on a disjoint selection). Consumers clear it via
    // dismissSelectionStatus or the next selection-mutating action.
    selectionStatus: SelectionStatus
}

// Live cursor position inside the editing input. Stored as a
// ref-style mutable container, never as state.
export interface GridRefs {
    editCursor: { current: DraftSelection }
    lastRefSlice: { current: { start: number; end: number } | null }
}

export type StructuralOp =
    | {
          kind: 'insertRows'
          atRow: number
          count: number
          position: 'above' | 'below'
          displayedRowCount: number
      }
    | {
          kind: 'insertColumns'
          atCol: number
          count: number
          position: 'left' | 'right'
          displayedColCount: number
      }
    | { kind: 'deleteRows'; fromRow: number; count: number }
    | { kind: 'deleteColumns'; fromCol: number; count: number }

export interface GridStoreDeps {
    readOnly: boolean
    writeCell: (row: number, col: number, value: string) => void
    focusActiveInput: () => void
    applyStructuralMutation: (op: StructuralOp) => void
    applyFill: (opts: {
        sourceRange: CellRange
        destRange: CellRange
        direction: 'down' | 'right'
    }) => void
    resolveMergeAnchor: (row: number, col: number) => { row: number; col: number }
    expandRangeOverMerges: (range: CellRange) => CellRange
    findMergesInRange: (range: CellRange) => MergeAnchor[]
    mergeRange: (range: CellRange) => void
    unmergeAt: (anchorRow: number, anchorCol: number) => void
    setFrozenRows: (n: number) => void
    setFrozenCols: (n: number) => void
}

export interface MergeAnchor {
    anchorRow: number
    anchorCol: number
    rowSpan: number
    colSpan: number
}

export interface GridActions {
    selectCell: (cell: SelectedCell) => void
    // Extend the active (last) sub-range from its anchor to `cell`.
    // If there is no anchor, this is equivalent to selectCell.
    extendActiveRangeTo: (cell: SelectedCell) => void
    selectRow: (row: number, colCount: number) => void
    selectColumn: (col: number, rowCount: number) => void
    // Ctrl-click append: starts a new sub-range at `cell` (body
    // scope). The new sub-range becomes the primary. No-op when
    // `cell` is inside an existing sub-range but isn't an anchor;
    // when it IS an existing anchor, removes that sub-range (case
    // (a) in the plan §6). See addSubRange comments below.
    addSubRange: (cell: SelectedCell) => void
    // Ctrl-click on column header: appends a column-scope sub-range
    // (full-height column rectangle). Same hole-punch and pop-anchor
    // semantics as addSubRange.
    addColumnSubRange: (col: number, rowCount: number) => void
    addRowSubRange: (row: number, colCount: number) => void
    // Shift-click on column header: if active sub-range is column-
    // scope, extend it by columns; otherwise treat as plain
    // selectColumn (replace selection).
    extendActiveColumnTo: (col: number, rowCount: number) => void
    extendActiveRowTo: (row: number, colCount: number) => void
    // Arrow-key collapse: replace a disjoint selection with a single-
    // cell selection at the primary anchor. Called by Cell.tsx's
    // onCellKeyDown when an arrow key is pressed on a disjoint
    // selection; focus traversal continues afterward.
    collapseToPrimary: () => void
    editCell: (cell: SelectedCell, initialDraft?: string) => void
    setEditDraft: (row: number, col: number, draft: string) => void
    setEditSelection: (row: number, col: number, start: number, end: number) => void
    commitEdit: (row: number, col: number, value: string) => void
    cancelEdit: () => void
    clearCellAt: (row: number, col: number) => void
    clearSelection: () => void
    setActiveSurface: (surface: ActiveSurface) => void
    setFormulaBarRect: (rect: FormulaBarRect) => void
    setBodyTop: (y: number) => void
    cellRefTap: (row: number, col: number) => boolean
    cellRefDragStart: (row: number, col: number) => boolean
    cellRefDragMove: (row: number, col: number) => void
    cellRefDragEnd: () => void
    extendRefDragDraft: (nextDraft: string, nextSlice: { start: number; end: number }) => void
    moveSuggestion: (delta: number, total: number) => void
    setSuggestionIndex: (index: number) => void
    dismissSuggestions: () => void
    insertFunction: (name: string) => void
    openCellContextMenu: (row: number, col: number, x: number, y: number) => void
    closeCellContextMenu: () => void
    openCommentPopover: (row: number, col: number, x: number, y: number) => void
    closeCommentPopover: () => void
    openHandleMenu: (axis: 'col' | 'row', index: number, x: number, y: number) => void
    closeHandleMenu: () => void
    // openHeaderMenu pre-selects the clicked row/col when it isn't
    // already part of the active selection, then opens the menu.
    // Mirrors Sheets/Excel: right-clicking a header that's outside
    // the current selection replaces it; right-clicking inside it
    // keeps the existing (possibly multi-row/col) selection so
    // range-targeted actions cover everything highlighted.
    //
    // `axisSpan` is the perpendicular dimension passed through to the
    // selectColumn(rowCount) / selectRow(colCount) call when the
    // pre-selection fires — i.e. rowCount for axis='col', colCount
    // for axis='row'.
    openHeaderMenu: (
        axis: 'col' | 'row',
        index: number,
        axisSpan: number,
        x: number,
        y: number
    ) => void
    closeHeaderMenu: () => void
    insertRowsAtSelection: (position: 'above' | 'below', displayedRowCount: number) => void
    insertColumnsAtSelection: (position: 'left' | 'right', displayedColCount: number) => void
    deleteSelectedRows: (currentRowCount: number) => void
    deleteSelectedColumns: (currentColCount: number) => void
    insertRowAtHandle: (
        index: number,
        position: 'above' | 'below',
        displayedRowCount: number
    ) => void
    insertColumnAtHandle: (
        index: number,
        position: 'left' | 'right',
        displayedColCount: number
    ) => void
    deleteRowAtHandle: (index: number, currentRowCount: number) => void
    deleteColumnAtHandle: (index: number, currentColCount: number) => void
    setFrozenRows: (n: number) => void
    setFrozenCols: (n: number) => void
    unfreeze: () => void
    setClipboardMarker: (markerId: string, sourceRange: CellRange, isCut: boolean) => void
    clearClipboardMarker: () => void
    fillDragStart: () => boolean
    fillDragMove: (target: { row: number; col: number }) => void
    fillDragEnd: () => void
    openSortDialog: () => void
    closeSortDialog: () => void
    openFilterDialog: (col: number) => void
    closeFilterDialog: () => void
    setSortStatus: (status: { mergesBroken: number } | null) => void
    setSelectionStatus: (status: SelectionStatus) => void
    dismissSelectionStatus: () => void
    mergeSelection: () => void
    mergeSelectionHorizontal: () => void
    mergeSelectionVertical: () => void
    unmergeSelection: () => void
}

export interface GridStore extends GridState, GridActions {}

export type GridStoreApi = StoreApi<GridStore> & { refs: GridRefs }

// Bounds-equality on a CellRange, used by fillDragMove to short-
// circuit redundant set() calls.
function rangesEqual(a: CellRange, b: CellRange): boolean {
    return (
        a.startRow === b.startRow &&
        a.endRow === b.endRow &&
        a.startCol === b.startCol &&
        a.endCol === b.endCol
    )
}

const initialState: GridState = {
    selection: null,
    editSession: null,
    pendingSelection: null,
    activeSurface: 'cell',
    refDrag: null,
    suggestionIndex: 0,
    dismissedDraft: null,
    formulaBarRect: null,
    bodyTop: null,
    contextTarget: null,
    commentTarget: null,
    handleMenu: null,
    headerMenu: null,
    clipboardMarker: null,
    copySourceRange: null,
    cutPending: false,
    fillDrag: null,
    sortDialogOpen: false,
    filterDialogCol: null,
    sortStatus: null,
    selectionStatus: null,
}

const CLIPBOARD_MARKER_TTL_MS = 30_000

export function createGridStore(deps: GridStoreDeps): GridStoreApi {
    const refs: GridRefs = {
        editCursor: { current: { start: 0, end: 0 } },
        lastRefSlice: { current: null },
    }

    let clipboardTimeout: ReturnType<typeof setTimeout> | null = null

    const store = createVanillaStore<GridStore>()((set, get) => {
        // commitInflight: when something else needs to take focus
        // (selectCell on a different cell, openCellContextMenu),
        // commit any pending edit on the prior cell.
        const commitInflight = (target: SelectedCell | null) => {
            const current = get().editSession
            if (current == null) return
            if (target != null && current.row === target.row && current.col === target.col) return
            if (deps.readOnly) return
            deps.writeCell(current.row, current.col, current.draft)
        }

        // currentPrimaryRange returns the active selection rectangle
        // (primary sub-range's range) or null when nothing is
        // selected. Shared by mergeSelection variants and
        // unmergeSelection.
        const currentPrimaryRange = (): CellRange | null => readPrimaryRange(get().selection)

        const runMerge = (mode: 'all' | 'horizontal' | 'vertical') => {
            if (deps.readOnly) return
            // Disjoint selections are unsupported for merge — Sheets
            // disables the action entirely. The CellContextMenu's
            // isDisabled flag is the primary affordance; this is
            // defense in depth.
            if (isDisjointSelection(get().selection)) return
            const baseRange = currentPrimaryRange()
            if (baseRange == null) return
            const expanded = deps.expandRangeOverMerges(baseRange)
            if (mode === 'all') {
                if (
                    expanded.startRow === expanded.endRow &&
                    expanded.startCol === expanded.endCol
                ) {
                    return
                }
                deps.mergeRange(expanded)
            } else if (mode === 'horizontal') {
                if (expanded.startCol === expanded.endCol) return
                for (let r = expanded.startRow; r <= expanded.endRow; r++) {
                    deps.mergeRange({
                        startRow: r,
                        endRow: r,
                        startCol: expanded.startCol,
                        endCol: expanded.endCol,
                    })
                }
            } else {
                if (expanded.startRow === expanded.endRow) return
                for (let c = expanded.startCol; c <= expanded.endCol; c++) {
                    deps.mergeRange({
                        startRow: expanded.startRow,
                        endRow: expanded.endRow,
                        startCol: c,
                        endCol: c,
                    })
                }
            }
            // Post-merge selection collapses to the merged cell.
            set({
                selection: singleCellSelection({
                    row: expanded.startRow,
                    col: expanded.startCol,
                }),
                contextTarget: null,
            })
        }

        return {
            ...initialState,

            selectCell: cell => {
                // Snap to the merge anchor when the click landed on a
                // covered cell.
                const snapped = deps.resolveMergeAnchor(cell.row, cell.col)
                const target: SelectedCell = { row: snapped.row, col: snapped.col }
                commitInflight(target)
                refs.lastRefSlice.current = null
                const prevCommentTarget = get().commentTarget
                const closeComment =
                    prevCommentTarget != null &&
                    (prevCommentTarget.cell.row !== target.row ||
                        prevCommentTarget.cell.col !== target.col)
                set({
                    selection: singleCellSelection(target),
                    editSession: null,
                    pendingSelection: null,
                    commentTarget: closeComment ? null : prevCommentTarget,
                })
            },

            selectRow: (row, colCount) => {
                refs.lastRefSlice.current = null
                const anchor = { row, col: 1 }
                commitInflight(anchor)
                set({
                    selection: singleRectSelection(
                        anchor,
                        {
                            startRow: row,
                            endRow: row,
                            startCol: 1,
                            endCol: Math.max(1, colCount),
                        },
                        'row'
                    ),
                    editSession: null,
                    pendingSelection: null,
                })
            },

            selectColumn: (col, rowCount) => {
                refs.lastRefSlice.current = null
                const anchor = { row: 1, col }
                commitInflight(anchor)
                set({
                    selection: singleRectSelection(
                        anchor,
                        {
                            startRow: 1,
                            endRow: Math.max(1, rowCount),
                            startCol: col,
                            endCol: col,
                        },
                        'column'
                    ),
                    editSession: null,
                    pendingSelection: null,
                })
            },

            addSubRange: cell => {
                // Ctrl-click on a body cell. Three cases:
                //   1. Nothing selected → equivalent to selectCell.
                //   2. Cell IS the anchor of some existing sub-range
                //      AND ranges.length > 1 → drop that sub-range
                //      (Sheets-style deselect, plan §6.a).
                //   3. Cell is inside any sub-range but isn't an
                //      anchor → no-op (plan §6.b — we don't
                //      implement hole-punching; Sheets does but the
                //      UX is widely disliked).
                //   4. Otherwise → append a new single-cell sub-range
                //      and snap it to merge bounds. Primary anchor
                //      moves to the just-clicked cell.
                refs.lastRefSlice.current = null
                const snapped = deps.resolveMergeAnchor(cell.row, cell.col)
                const target: SelectedCell = { row: snapped.row, col: snapped.col }
                commitInflight(target)
                const state = get()
                if (state.selection == null) {
                    set({
                        selection: singleCellSelection(target),
                        editSession: null,
                        pendingSelection: null,
                    })
                    return
                }
                // Case 2: clicked the anchor of an existing sub-range
                // and we have more than one — remove that sub-range.
                const ranges = state.selection.ranges
                const anchorIdx = ranges.findIndex(
                    sr => sr.anchor.row === target.row && sr.anchor.col === target.col
                )
                if (anchorIdx >= 0 && ranges.length > 1) {
                    const next: SubRange[] = ranges.slice(0, anchorIdx).concat(ranges.slice(anchorIdx + 1))
                    set({
                        selection: { ranges: next },
                        editSession: null,
                        pendingSelection: null,
                    })
                    return
                }
                // Case 3: inside any sub-range but not an anchor — no-op.
                if (subRangeAtCell(state.selection, target.row, target.col) != null) {
                    return
                }
                // Case 4: append a new sub-range. Expand over merges
                // so a Ctrl-click on a covered cell gets the full
                // merge footprint (see plan Risk 4).
                const singleRange: CellRange = {
                    startRow: target.row,
                    endRow: target.row,
                    startCol: target.col,
                    endCol: target.col,
                }
                const expanded = deps.expandRangeOverMerges(singleRange)
                const newSubRange: SubRange = {
                    anchor: target,
                    range: expanded,
                    scope: 'cells',
                }
                set({
                    selection: { ranges: [...ranges, newSubRange] },
                    editSession: null,
                    pendingSelection: null,
                })
            },

            addColumnSubRange: (col, rowCount) => {
                refs.lastRefSlice.current = null
                const anchor: SelectedCell = { row: 1, col }
                commitInflight(anchor)
                const state = get()
                const range: CellRange = {
                    startRow: 1,
                    endRow: Math.max(1, rowCount),
                    startCol: col,
                    endCol: col,
                }
                if (state.selection == null) {
                    set({
                        selection: singleRectSelection(anchor, range, 'column'),
                        editSession: null,
                        pendingSelection: null,
                    })
                    return
                }
                const ranges = state.selection.ranges
                const anchorIdx = ranges.findIndex(
                    sr => sr.anchor.row === 1 && sr.anchor.col === col && sr.scope === 'column'
                )
                if (anchorIdx >= 0 && ranges.length > 1) {
                    const next = ranges.slice(0, anchorIdx).concat(ranges.slice(anchorIdx + 1))
                    set({
                        selection: { ranges: next },
                        editSession: null,
                        pendingSelection: null,
                    })
                    return
                }
                // Re-Ctrl-clicking the same column header on a
                // single-rectangle selection is a no-op (same as
                // body Ctrl-click on the sole anchor).
                if (anchorIdx >= 0) return
                const newSubRange: SubRange = { anchor, range, scope: 'column' }
                set({
                    selection: { ranges: [...ranges, newSubRange] },
                    editSession: null,
                    pendingSelection: null,
                })
            },

            addRowSubRange: (row, colCount) => {
                refs.lastRefSlice.current = null
                const anchor: SelectedCell = { row, col: 1 }
                commitInflight(anchor)
                const state = get()
                const range: CellRange = {
                    startRow: row,
                    endRow: row,
                    startCol: 1,
                    endCol: Math.max(1, colCount),
                }
                if (state.selection == null) {
                    set({
                        selection: singleRectSelection(anchor, range, 'row'),
                        editSession: null,
                        pendingSelection: null,
                    })
                    return
                }
                const ranges = state.selection.ranges
                const anchorIdx = ranges.findIndex(
                    sr => sr.anchor.row === row && sr.anchor.col === 1 && sr.scope === 'row'
                )
                if (anchorIdx >= 0 && ranges.length > 1) {
                    const next = ranges.slice(0, anchorIdx).concat(ranges.slice(anchorIdx + 1))
                    set({
                        selection: { ranges: next },
                        editSession: null,
                        pendingSelection: null,
                    })
                    return
                }
                if (anchorIdx >= 0) return
                const newSubRange: SubRange = { anchor, range, scope: 'row' }
                set({
                    selection: { ranges: [...ranges, newSubRange] },
                    editSession: null,
                    pendingSelection: null,
                })
            },

            extendActiveColumnTo: (col, rowCount) => {
                refs.lastRefSlice.current = null
                const state = get()
                commitInflight({ row: 1, col })
                if (state.selection == null || state.selection.ranges.length === 0) {
                    // No anchor — treat as plain selectColumn.
                    set({
                        selection: singleRectSelection(
                            { row: 1, col },
                            {
                                startRow: 1,
                                endRow: Math.max(1, rowCount),
                                startCol: col,
                                endCol: col,
                            },
                            'column'
                        ),
                        editSession: null,
                        pendingSelection: null,
                    })
                    return
                }
                const ranges = state.selection.ranges
                const last = ranges[ranges.length - 1]
                if (last.scope !== 'column') {
                    // Cross-scope Shift-extend isn't supported in
                    // Sheets either — fall back to a fresh column
                    // selection that replaces the whole selection.
                    set({
                        selection: singleRectSelection(
                            { row: 1, col },
                            {
                                startRow: 1,
                                endRow: Math.max(1, rowCount),
                                startCol: col,
                                endCol: col,
                            },
                            'column'
                        ),
                        editSession: null,
                        pendingSelection: null,
                    })
                    return
                }
                const anchorCol = last.anchor.col
                const startCol = Math.min(anchorCol, col)
                const endCol = Math.max(anchorCol, col)
                const newRange: CellRange = {
                    startRow: 1,
                    endRow: Math.max(1, rowCount),
                    startCol,
                    endCol,
                }
                const next = ranges.slice(0, -1)
                next.push({ anchor: last.anchor, range: newRange, scope: 'column' })
                set({
                    selection: { ranges: next },
                    editSession: null,
                    pendingSelection: null,
                })
            },

            extendActiveRowTo: (row, colCount) => {
                refs.lastRefSlice.current = null
                const state = get()
                commitInflight({ row, col: 1 })
                if (state.selection == null || state.selection.ranges.length === 0) {
                    set({
                        selection: singleRectSelection(
                            { row, col: 1 },
                            {
                                startRow: row,
                                endRow: row,
                                startCol: 1,
                                endCol: Math.max(1, colCount),
                            },
                            'row'
                        ),
                        editSession: null,
                        pendingSelection: null,
                    })
                    return
                }
                const ranges = state.selection.ranges
                const last = ranges[ranges.length - 1]
                if (last.scope !== 'row') {
                    set({
                        selection: singleRectSelection(
                            { row, col: 1 },
                            {
                                startRow: row,
                                endRow: row,
                                startCol: 1,
                                endCol: Math.max(1, colCount),
                            },
                            'row'
                        ),
                        editSession: null,
                        pendingSelection: null,
                    })
                    return
                }
                const anchorRow = last.anchor.row
                const startRow = Math.min(anchorRow, row)
                const endRow = Math.max(anchorRow, row)
                const newRange: CellRange = {
                    startRow,
                    endRow,
                    startCol: 1,
                    endCol: Math.max(1, colCount),
                }
                const next = ranges.slice(0, -1)
                next.push({ anchor: last.anchor, range: newRange, scope: 'row' })
                set({
                    selection: { ranges: next },
                    editSession: null,
                    pendingSelection: null,
                })
            },

            extendActiveRangeTo: cell => {
                commitInflight(cell)
                refs.lastRefSlice.current = null
                const state = get()
                if (state.selection == null || state.selection.ranges.length === 0) {
                    // No anchor — fall through to a plain single-cell
                    // select so the gesture isn't lost.
                    set({
                        selection: singleCellSelection(cell),
                        editSession: null,
                        pendingSelection: null,
                    })
                    return
                }
                const ranges = state.selection.ranges
                const last = ranges[ranges.length - 1]
                const anchor = last.anchor
                const naive: CellRange = {
                    startRow: Math.min(anchor.row, cell.row),
                    endRow: Math.max(anchor.row, cell.row),
                    startCol: Math.min(anchor.col, cell.col),
                    endCol: Math.max(anchor.col, cell.col),
                }
                const range = deps.expandRangeOverMerges(naive)
                const next = ranges.slice(0, -1)
                next.push({ anchor, range, scope: last.scope })
                set({
                    selection: { ranges: next },
                    editSession: null,
                    pendingSelection: null,
                })
            },

            collapseToPrimary: () => {
                const state = get()
                const anchor = readPrimaryAnchor(state.selection)
                if (anchor == null) return
                if (state.selection != null && state.selection.ranges.length === 1) {
                    // Already collapsed — verify it's a single-cell
                    // range. If not, leave alone; this action is only
                    // meaningful for "collapse disjoint to single
                    // cell" per plan §6.c.
                    const r = state.selection.ranges[0].range
                    if (r.startRow === r.endRow && r.startCol === r.endCol) return
                }
                set({
                    selection: singleCellSelection(anchor),
                })
            },

            editCell: (cell, initialDraft = '') => {
                if (deps.readOnly) return
                const cursor = initialDraft.length
                refs.editCursor.current = { start: cursor, end: cursor }
                refs.lastRefSlice.current = null
                set({
                    selection: singleCellSelection(cell),
                    editSession: { row: cell.row, col: cell.col, draft: initialDraft },
                    pendingSelection: { start: cursor, end: cursor },
                    activeSurface: 'cell',
                })
            },

            setEditDraft: (row, col, draft) => {
                refs.lastRefSlice.current = null
                const prev = get().editSession
                const isFreshSession = prev == null || prev.row !== row || prev.col !== col
                if (isFreshSession || refs.editCursor.current.end > draft.length) {
                    refs.editCursor.current = { start: draft.length, end: draft.length }
                }
                if (prev != null && prev.row === row && prev.col === col && prev.draft === draft)
                    return
                set({ editSession: { row, col, draft } })
            },

            setEditSelection: (row, col, start, end) => {
                const cur = get().editSession
                if (cur == null || cur.row !== row || cur.col !== col) return
                refs.editCursor.current = { start, end }
                if (get().pendingSelection != null) set({ pendingSelection: null })
            },

            commitEdit: (row, col, value) => {
                if (!deps.readOnly) deps.writeCell(row, col, value)
                refs.lastRefSlice.current = null
                set({
                    selection: singleCellSelection({ row, col }),
                    editSession: null,
                    pendingSelection: null,
                })
            },

            cancelEdit: () => {
                refs.lastRefSlice.current = null
                set({ editSession: null, pendingSelection: null })
            },

            clearCellAt: (row, col) => {
                if (deps.readOnly) return
                deps.writeCell(row, col, '')
            },

            clearSelection: () => {
                if (deps.readOnly) return
                const selection = get().selection
                if (selection == null) return
                for (const sr of selection.ranges) {
                    for (let r = sr.range.startRow; r <= sr.range.endRow; r++) {
                        for (let c = sr.range.startCol; c <= sr.range.endCol; c++) {
                            deps.writeCell(r, c, '')
                        }
                    }
                }
            },

            setActiveSurface: surface => set({ activeSurface: surface }),
            setFormulaBarRect: rect => set({ formulaBarRect: rect }),
            setBodyTop: y => {
                if (get().bodyTop === y) return
                set({ bodyTop: y })
            },

            cellRefTap: (row, col) => {
                const session = get().editSession
                if (session == null) return false
                if (!isRefAcceptable(session.draft, refs.editCursor.current.end)) return false
                const ref = formatRef(row, col)
                const prevSlice = refs.lastRefSlice.current
                const result =
                    prevSlice != null
                        ? extendCellRefInsertion(session.draft, prevSlice, ref)
                        : applyCellRefInsertion(session.draft, refs.editCursor.current.end, ref)
                refs.lastRefSlice.current = result.insertedSlice
                refs.editCursor.current = result.selection
                set({
                    editSession: { row: session.row, col: session.col, draft: result.draft },
                    pendingSelection: result.selection,
                })
                deps.focusActiveInput()
                return true
            },

            cellRefDragStart: (row, col) => {
                const session = get().editSession
                if (session == null) return false
                if (!isRefAcceptable(session.draft, refs.editCursor.current.end)) return false
                const ref = formatRef(row, col)
                const prevSlice = refs.lastRefSlice.current
                const result =
                    prevSlice != null
                        ? extendCellRefInsertion(session.draft, prevSlice, ref)
                        : applyCellRefInsertion(session.draft, refs.editCursor.current.end, ref)
                refs.lastRefSlice.current = result.insertedSlice
                refs.editCursor.current = result.selection
                set({
                    editSession: { row: session.row, col: session.col, draft: result.draft },
                    pendingSelection: result.selection,
                    refDrag: {
                        anchor: { row, col },
                        end: { row, col },
                        lastSlice: result.insertedSlice,
                    },
                })
                return true
            },

            cellRefDragMove: (row, col) => {
                const drag = get().refDrag
                if (drag == null) return
                if (drag.end.row === row && drag.end.col === col) return
                set({ refDrag: { ...drag, end: { row, col } } })
            },

            cellRefDragEnd: () => {
                set({ refDrag: null })
                deps.focusActiveInput()
            },

            extendRefDragDraft: (nextDraft, nextSlice) => {
                const session = get().editSession
                const drag = get().refDrag
                if (session == null || drag == null) return
                refs.lastRefSlice.current = nextSlice
                refs.editCursor.current = { start: nextDraft.length, end: nextDraft.length }
                set({
                    editSession: { row: session.row, col: session.col, draft: nextDraft },
                    pendingSelection: { start: nextDraft.length, end: nextDraft.length },
                    refDrag: { ...drag, lastSlice: nextSlice },
                })
            },

            moveSuggestion: (delta, total) => {
                if (total <= 0) return
                const cur = get().suggestionIndex
                const next = (((cur + delta) % total) + total) % total
                set({ suggestionIndex: next })
            },

            setSuggestionIndex: index => set({ suggestionIndex: index }),

            dismissSuggestions: () => {
                const session = get().editSession
                if (session == null) return
                set({ dismissedDraft: session.draft })
            },

            insertFunction: name => {
                const session = get().editSession
                if (session == null) return
                const t = parseFunctionToken(session.draft, refs.editCursor.current.end)
                if (t == null) return
                const result = applyFunctionInsertion(session.draft, t, name)
                refs.editCursor.current = result.selection
                refs.lastRefSlice.current = null
                set({
                    editSession: { row: session.row, col: session.col, draft: result.draft },
                    pendingSelection: result.selection,
                })
            },

            openCellContextMenu: (row, col, x, y) => {
                // Right-clicking inside an existing sub-range keeps
                // the whole selection alive (including disjoint sub-
                // ranges) so range-targeted menu items still apply.
                // Right-clicking outside any sub-range collapses to
                // a single-cell selection on the clicked cell.
                const state = get()
                const insideAny =
                    state.selection != null &&
                    subRangeAtCell(state.selection, row, col) != null
                commitInflight({ row, col })
                set({
                    selection: insideAny
                        ? state.selection
                        : singleCellSelection({ row, col }),
                    editSession: null,
                    contextTarget: { cell: { row, col }, cursor: { x, y } },
                })
            },

            closeCellContextMenu: () => set({ contextTarget: null }),

            openCommentPopover: (row, col, x, y) => {
                commitInflight({ row, col })
                set({
                    selection: singleCellSelection({ row, col }),
                    editSession: null,
                    contextTarget: null,
                    commentTarget: { cell: { row, col }, cursor: { x, y } },
                })
            },

            closeCommentPopover: () => set({ commentTarget: null }),

            openHandleMenu: (axis, index, x, y) => {
                if (deps.readOnly) return
                set({ handleMenu: { axis, index, cursor: { x, y } } })
            },
            closeHandleMenu: () => set({ handleMenu: null }),

            openHeaderMenu: (axis, index, axisSpan, x, y) => {
                // Right-clicking a header that's already inside the
                // selection keeps the selection (so multi-row/col Insert
                // and Delete cover everything highlighted). Outside the
                // selection replaces with the whole clicked row/col.
                const state = get()
                let alreadySelected = false
                if (state.selection != null) {
                    for (const sr of state.selection.ranges) {
                        const r = sr.range
                        if (axis === 'col') {
                            if (index >= r.startCol && index <= r.endCol) {
                                alreadySelected = true
                                break
                            }
                        } else {
                            if (index >= r.startRow && index <= r.endRow) {
                                alreadySelected = true
                                break
                            }
                        }
                    }
                }
                if (!alreadySelected) {
                    if (axis === 'col') {
                        get().selectColumn(index, axisSpan)
                    } else {
                        get().selectRow(index, axisSpan)
                    }
                }
                set({ headerMenu: { axis, index, cursor: { x, y } } })
            },
            closeHeaderMenu: () => set({ headerMenu: null }),

            // Structural mutations route by the primary (last) sub-
            // range. Other sub-ranges follow the same shift via
            // shiftSubRangesForInsert / clampSubRangesForDelete so a
            // disjoint selection remains coherent post-mutation.
            insertRowsAtSelection: (position, displayedRowCount) => {
                if (deps.readOnly) return
                const state = get()
                const primary = readPrimaryRange(state.selection)
                if (primary == null) return
                const startRow = primary.startRow
                const endRow = primary.endRow
                const atRow = position === 'above' ? startRow : endRow
                const count = endRow - startRow + 1
                const insertAt = position === 'above' ? atRow : atRow + 1
                deps.applyStructuralMutation({
                    kind: 'insertRows',
                    atRow,
                    count,
                    position,
                    displayedRowCount,
                })
                set({
                    selection: shiftSubRangesForInsert(state.selection, 'row', insertAt, count),
                    contextTarget: null,
                })
            },

            insertColumnsAtSelection: (position, displayedColCount) => {
                if (deps.readOnly) return
                const state = get()
                const primary = readPrimaryRange(state.selection)
                if (primary == null) return
                const startCol = primary.startCol
                const endCol = primary.endCol
                const atCol = position === 'left' ? startCol : endCol
                const count = endCol - startCol + 1
                const insertAt = position === 'left' ? atCol : atCol + 1
                deps.applyStructuralMutation({
                    kind: 'insertColumns',
                    atCol,
                    count,
                    position,
                    displayedColCount,
                })
                set({
                    selection: shiftSubRangesForInsert(state.selection, 'col', insertAt, count),
                    contextTarget: null,
                })
            },

            deleteSelectedRows: currentRowCount => {
                if (deps.readOnly) return
                const state = get()
                const primary = readPrimaryRange(state.selection)
                if (primary == null) return
                const fromRow = primary.startRow
                const requestedCount = primary.endRow - primary.startRow + 1
                const maxDeletable = Math.max(0, currentRowCount - 1)
                const count = Math.min(requestedCount, maxDeletable, currentRowCount - fromRow + 1)
                if (count <= 0) {
                    set({ contextTarget: null })
                    return
                }
                deps.applyStructuralMutation({ kind: 'deleteRows', fromRow, count })
                const newRowCount = Math.max(1, currentRowCount - count)
                // Collapse to the clamped anchor of the primary sub-
                // range — matches old single-rectangle behavior.
                const primaryAnchor = readPrimaryAnchor(state.selection)
                const nextRow = primaryAnchor == null
                    ? 1
                    : primaryAnchor.row < fromRow
                        ? primaryAnchor.row
                        : primaryAnchor.row >= fromRow + count
                            ? primaryAnchor.row - count
                            : Math.min(fromRow, newRowCount)
                const nextCol = primaryAnchor?.col ?? 1
                set({
                    selection: singleCellSelection({ row: nextRow, col: nextCol }),
                    contextTarget: null,
                })
            },

            deleteSelectedColumns: currentColCount => {
                if (deps.readOnly) return
                const state = get()
                const primary = readPrimaryRange(state.selection)
                if (primary == null) return
                const fromCol = primary.startCol
                const requestedCount = primary.endCol - primary.startCol + 1
                const maxDeletable = Math.max(0, currentColCount - 1)
                const count = Math.min(requestedCount, maxDeletable, currentColCount - fromCol + 1)
                if (count <= 0) {
                    set({ contextTarget: null })
                    return
                }
                deps.applyStructuralMutation({ kind: 'deleteColumns', fromCol, count })
                const newColCount = Math.max(1, currentColCount - count)
                const primaryAnchor = readPrimaryAnchor(state.selection)
                const nextCol = primaryAnchor == null
                    ? 1
                    : primaryAnchor.col < fromCol
                        ? primaryAnchor.col
                        : primaryAnchor.col >= fromCol + count
                            ? primaryAnchor.col - count
                            : Math.min(fromCol, newColCount)
                const nextRow = primaryAnchor?.row ?? 1
                set({
                    selection: singleCellSelection({ row: nextRow, col: nextCol }),
                    contextTarget: null,
                })
            },

            insertRowAtHandle: (index, position, displayedRowCount) => {
                if (deps.readOnly) return
                deps.applyStructuralMutation({
                    kind: 'insertRows',
                    atRow: index,
                    count: 1,
                    position,
                    displayedRowCount,
                })
                const insertAt = position === 'above' ? index : index + 1
                const state = get()
                set({
                    selection: shiftSubRangesForInsert(state.selection, 'row', insertAt, 1),
                    handleMenu: null,
                    headerMenu: null,
                })
            },

            insertColumnAtHandle: (index, position, displayedColCount) => {
                if (deps.readOnly) return
                deps.applyStructuralMutation({
                    kind: 'insertColumns',
                    atCol: index,
                    count: 1,
                    position,
                    displayedColCount,
                })
                const insertAt = position === 'left' ? index : index + 1
                const state = get()
                set({
                    selection: shiftSubRangesForInsert(state.selection, 'col', insertAt, 1),
                    handleMenu: null,
                    headerMenu: null,
                })
            },

            deleteRowAtHandle: (index, currentRowCount) => {
                if (deps.readOnly) return
                if (currentRowCount <= 1) {
                    set({ handleMenu: null, headerMenu: null })
                    return
                }
                deps.applyStructuralMutation({ kind: 'deleteRows', fromRow: index, count: 1 })
                const newRowCount = currentRowCount - 1
                const state = get()
                // Header-handle deletes don't operate from the
                // selection — they target a specific row index — but
                // the *current* selection should still follow the
                // shift so the highlight stays meaningful.
                set({
                    selection: clampSubRangesForDelete(
                        state.selection,
                        'row',
                        index,
                        1,
                        newRowCount
                    ),
                    handleMenu: null,
                    headerMenu: null,
                })
            },

            deleteColumnAtHandle: (index, currentColCount) => {
                if (deps.readOnly) return
                if (currentColCount <= 1) {
                    set({ handleMenu: null, headerMenu: null })
                    return
                }
                deps.applyStructuralMutation({ kind: 'deleteColumns', fromCol: index, count: 1 })
                const newColCount = currentColCount - 1
                const state = get()
                set({
                    selection: clampSubRangesForDelete(
                        state.selection,
                        'col',
                        index,
                        1,
                        newColCount
                    ),
                    handleMenu: null,
                    headerMenu: null,
                })
            },

            setFrozenRows: n => {
                if (deps.readOnly) return
                deps.setFrozenRows(Math.max(0, Math.floor(n)))
            },

            setFrozenCols: n => {
                if (deps.readOnly) return
                deps.setFrozenCols(Math.max(0, Math.floor(n)))
            },

            unfreeze: () => {
                if (deps.readOnly) return
                deps.setFrozenRows(0)
                deps.setFrozenCols(0)
            },

            setClipboardMarker: (markerId, sourceRange, isCut) => {
                if (clipboardTimeout != null) clearTimeout(clipboardTimeout)
                clipboardTimeout = setTimeout(() => {
                    set({
                        clipboardMarker: null,
                        copySourceRange: null,
                        cutPending: false,
                    })
                    clipboardTimeout = null
                }, CLIPBOARD_MARKER_TTL_MS)
                set({
                    clipboardMarker: markerId,
                    copySourceRange: sourceRange,
                    cutPending: isCut,
                })
            },

            clearClipboardMarker: () => {
                if (clipboardTimeout != null) {
                    clearTimeout(clipboardTimeout)
                    clipboardTimeout = null
                }
                set({
                    clipboardMarker: null,
                    copySourceRange: null,
                    cutPending: false,
                })
            },

            openSortDialog: () => set({ sortDialogOpen: true, contextTarget: null }),
            closeSortDialog: () => set({ sortDialogOpen: false }),
            openFilterDialog: col => set({ filterDialogCol: col, contextTarget: null }),
            closeFilterDialog: () => set({ filterDialogCol: null }),
            setSortStatus: status => set({ sortStatus: status }),
            setSelectionStatus: status => set({ selectionStatus: status }),
            dismissSelectionStatus: () => set({ selectionStatus: null }),

            fillDragStart: () => {
                if (deps.readOnly) return false
                const state = get()
                // Fill on disjoint selection is unsupported — Sheets
                // hides the handle and so do we. The overlay's own
                // hide guard is primary; this is defense in depth.
                if (isDisjointSelection(state.selection)) return false
                const sourceRange = readPrimaryRange(state.selection)
                if (sourceRange == null) return false
                set({
                    fillDrag: {
                        sourceRange,
                        destRange: sourceRange,
                        direction: 'down',
                        directionLocked: false,
                    },
                })
                return true
            },

            fillDragMove: target => {
                const drag = get().fillDrag
                if (drag == null) return
                const { sourceRange, direction, directionLocked } = drag
                const dRow = target.row - sourceRange.endRow
                const dCol = target.col - sourceRange.endCol

                if (dRow <= 0 && dCol <= 0) {
                    if (rangesEqual(drag.destRange, sourceRange)) return
                    set({ fillDrag: { ...drag, destRange: { ...sourceRange } } })
                    return
                }

                let nextDirection = direction
                let nextLocked = directionLocked
                if (!directionLocked) {
                    nextDirection = dRow >= dCol ? 'down' : 'right'
                    nextLocked = true
                }

                let destRange: CellRange
                if (nextDirection === 'down') {
                    if (dRow <= 0) {
                        if (
                            rangesEqual(drag.destRange, sourceRange) &&
                            directionLocked === nextLocked &&
                            direction === nextDirection
                        ) {
                            return
                        }
                        set({
                            fillDrag: {
                                sourceRange,
                                destRange: { ...sourceRange },
                                direction: nextDirection,
                                directionLocked: nextLocked,
                            },
                        })
                        return
                    }
                    destRange = {
                        startRow: sourceRange.startRow,
                        endRow: target.row,
                        startCol: sourceRange.startCol,
                        endCol: sourceRange.endCol,
                    }
                } else {
                    if (dCol <= 0) {
                        if (
                            rangesEqual(drag.destRange, sourceRange) &&
                            directionLocked === nextLocked &&
                            direction === nextDirection
                        ) {
                            return
                        }
                        set({
                            fillDrag: {
                                sourceRange,
                                destRange: { ...sourceRange },
                                direction: nextDirection,
                                directionLocked: nextLocked,
                            },
                        })
                        return
                    }
                    destRange = {
                        startRow: sourceRange.startRow,
                        endRow: sourceRange.endRow,
                        startCol: sourceRange.startCol,
                        endCol: target.col,
                    }
                }

                if (
                    rangesEqual(destRange, drag.destRange) &&
                    direction === nextDirection &&
                    directionLocked === nextLocked
                ) {
                    return
                }
                set({
                    fillDrag: {
                        sourceRange,
                        destRange,
                        direction: nextDirection,
                        directionLocked: nextLocked,
                    },
                })
            },

            fillDragEnd: () => {
                const drag = get().fillDrag
                if (drag == null) return
                const { sourceRange, destRange, direction } = drag
                if (rangesEqual(destRange, sourceRange)) {
                    set({ fillDrag: null })
                    return
                }
                deps.applyFill({ sourceRange, destRange, direction })
                // Post-fill selection covers the entire dest rectangle.
                const next: Selection = {
                    ranges: [
                        {
                            anchor: { row: destRange.startRow, col: destRange.startCol },
                            range: { ...destRange },
                            scope: 'cells',
                        },
                    ],
                }
                set({
                    selection: next,
                    fillDrag: null,
                })
            },

            mergeSelection: () => {
                runMerge('all')
            },

            mergeSelectionHorizontal: () => {
                runMerge('horizontal')
            },

            mergeSelectionVertical: () => {
                runMerge('vertical')
            },

            unmergeSelection: () => {
                if (deps.readOnly) return
                if (isDisjointSelection(get().selection)) return
                const baseRange = currentPrimaryRange()
                if (baseRange == null) return
                for (const m of deps.findMergesInRange(baseRange)) {
                    deps.unmergeAt(m.anchorRow, m.anchorCol)
                }
                set({ contextTarget: null })
            },
        }
    })

    // Reset suggestionIndex and dismissedDraft when the edit session
    // ends.
    store.subscribe((state, prev) => {
        if (state.editSession == null && prev.editSession != null) {
            const patch: Partial<GridState> = {}
            if (state.suggestionIndex !== 0) patch.suggestionIndex = 0
            if (state.dismissedDraft != null) patch.dismissedDraft = null
            if (Object.keys(patch).length > 0) store.setState(patch)
        } else if (
            state.editSession != null &&
            prev.editSession != null &&
            state.editSession.draft !== prev.editSession.draft &&
            state.dismissedDraft != null &&
            state.dismissedDraft !== state.editSession.draft
        ) {
            store.setState({ dismissedDraft: null })
        }
    })

    return Object.assign(store, { refs })
}

// Re-export helpers for callers that historically imported them from
// the store module. The helpers live in lib/selection-range.ts; this
// keeps the public surface where consumers already look.
export { rangeContainsCell }
