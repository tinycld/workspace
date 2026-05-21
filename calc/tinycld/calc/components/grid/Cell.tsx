import { memo, useCallback, useRef } from 'react'
import {
    type GestureResponderEvent,
    type NativeSyntheticEvent,
    Platform,
    Pressable,
    Text,
    TextInput,
    type TextInputSelectionChangeEventData,
    type View,
} from 'react-native'
import { useDragGesture } from '@tinycld/core/lib/gestures'
import { FORMULA_BAR_ACCESSORY_ID } from '../formula-accessory-id'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import type { RemotePresence } from '../../hooks/use-presence'
import { useCellMerge } from '../../hooks/use-cell-merge'
import { useConditionalStyleForCell } from '../../hooks/use-conditional-style'
import { useWorkbook } from '../../hooks/use-workbook-context'
import { useYCell } from '../../hooks/use-y-cell'
import { type CellKeyEvent, classifyCellKey } from '../../lib/cell-key-action'
import { cellStyleToRenderProps, mergeCellStyles } from '../../lib/cell-style-render'
import {
    computeShiftArrowTarget,
    containsAny,
    primaryAnchor,
} from '../../lib/selection-range'
import { columnLabel, formatCell } from '../../lib/workbook-types'
import type { FormulaSpecialKey } from '../FormulaBar'
import { CommentIndicator } from './CommentIndicator'
import { locateCellAtGridCoord } from './style-helpers'

interface CellProps {
    sheetId: string
    row: number
    col: number
    // Pre-computed by the parent so a width/height change in column N
    // or row M doesn't invalidate every memoized cell — only that
    // column's or row's cells get new left/top/width/height props.
    left: number
    top: number
    width: number
    height: number
    readOnly: boolean
    cellEditorInputRef: React.RefObject<TextInput | null>
    remoteEditor: RemotePresence | null
    colOffsets: Float64Array
    rowOffsets: Float64Array
    onSpecialKey: (key: FormulaSpecialKey) => boolean
}

export const Cell = memo(function Cell({
    sheetId,
    row,
    col,
    left,
    top,
    width,
    height,
    readOnly,
    cellEditorInputRef,
    remoteEditor,
    colOffsets,
    rowOffsets,
    onSpecialKey,
}: CellProps) {
    const { doc } = useWorkbook()
    const store = useGridStoreApi()
    const cellValue = useYCell(doc, sheetId, row, col)
    // Conditional formatting: rules attached to this sheet produce an
    // overlay CellStyle when they match this cell. The overlay wins
    // per attribute over the cell's explicit style — see
    // mergeCellStyles. Must run unconditionally before any early
    // return so the hook order stays stable across the editing /
    // merged-covered transitions below.
    const conditionalStyle = useConditionalStyleForCell(doc, sheetId, cellValue, row, col)
    // Merge handling is delegated here so Body's loop stays a simple
    // (row, col) walk: covered cells return null, anchor cells extend
    // their rendered footprint over the merge's span. useCellMerge
    // subscribes to the sheet's merges Y.Map so the anchor cell re-
    // renders when a merge is created — Cell is memoized and the
    // selection-derived flags don't always flip for the anchor.
    const merge = useCellMerge(doc, sheetId, row, col)
    const isMergedCovered =
        merge != null && (merge.anchorRow !== row || merge.anchorCol !== col)
    let renderWidth = width
    let renderHeight = height
    if (merge != null && !isMergedCovered) {
        const lastCol = merge.anchorCol + merge.colSpan - 1
        const lastRow = merge.anchorRow + merge.rowSpan - 1
        // Compute the merge footprint in absolute prefix-sum space, NOT
        // by subtracting from `left` / `top`. `left` and `top` are
        // quadrant-local (the renderer subtracts the frozen extent
        // before passing them in); `colOffsets`/`rowOffsets` are
        // absolute. Mixing them inflates the merged anchor's height by
        // the frozen-rows extent (and width by frozen-cols) for any
        // anchor that lives in a non-top-left quadrant, which is what
        // the user sees as text vertically offset by the frozen header
        // height.
        if (lastCol < colOffsets.length) {
            renderWidth = colOffsets[lastCol] - colOffsets[col - 1]
        }
        if (lastRow < rowOffsets.length) {
            renderHeight = rowOffsets[lastRow] - rowOffsets[row - 1]
        }
    }

    // Primitive selectors — non-editing/non-selected cells get back
    // false on every store update and short-circuit reference-equality
    // checks, so they don't re-render. This is the keystroke-perf
    // contract: 1 cell renders per keystroke, not N visible cells.
    //
    // isSelected reads the PRIMARY anchor (last sub-range). On a
    // single-rectangle selection this is the only anchor; on a
    // disjoint selection it's the most-recently-Ctrl-clicked cell.
    const isSelected = useGridStore(s => {
        const a = primaryAnchor(s.selection)
        return a?.row === row && a?.col === col
    })
    // True when this cell sits inside ANY sub-range of the selection
    // (single or disjoint). Returns a boolean primitive so cells
    // outside the selection short-circuit on equality.
    const isInRange = useGridStore(s => containsAny(s.selection, row, col))
    const isEditing = useGridStore(s => s.editSession?.row === row && s.editSession?.col === col)
    const isAnyEditing = useGridStore(s => s.editSession != null)

    // formatCell is the single source of truth for the visible string;
    // `display` on disk is still maintained as a cache for old peers
    // and the server-side serializer, but the live render computes from
    // (kind, raw) so future formatting (Phase 3 numFmt) lights up here
    // automatically.
    const display =
        cellValue == null
            ? ''
            : formatCell(cellValue.kind, cellValue.raw, cellValue.formula, cellValue.style?.numFmt)
    // Editing a formula cell should preload the formula expression
    // (e.g. "=SUM(A1:A2)"), not its computed result. This matches how
    // the formula bar surfaces formula text and lets users round-trip
    // a formula edit without losing the expression.
    const editDraft =
        cellValue?.kind === 'formula' && cellValue.formula ? cellValue.formula : display

    const remoteDraft = remoteEditor?.editing?.draft

    // Set when we already handled the gesture at down-time (shift-
    // extend, ctrl/cmd sub-range, ref-tap during formula edit) or at
    // drag engagement; consumed by onPress to skip the single-cell
    // selectCell that would otherwise collapse the range. preventDefault
    // on mousedown does NOT suppress the browser's subsequent click
    // event, so this gate is required.
    const skipNextPressRef = useRef(false)

    type DragMode = 'select' | 'ctrl-select' | 'ref' | null
    // Drag mode chosen at down-time (web modifier paths) or at drag-
    // engagement (plain drag). The move handler dispatches on this
    // ref. Reset on every gesture end.
    const dragModeRef = useRef<DragMode>(null)

    // Ref forwarded to the Pressable's underlying View. Used to
    // measureInWindow on native drag-start since RN doesn't surface
    // the target's screen rect in the gesture event.
    const pressableRef = useRef<View | null>(null)
    // Screen-space top-left of this cell, captured at drag-start.
    // onDragMove subtracts this from ctx.pointer (pageX/Y on native,
    // clientX/Y on web) to convert to a cell-local offset, then adds
    // the cell's absolute grid origin (colOffsets/rowOffsets) to get
    // grid coordinates of the pointer.
    const cellOriginRef = useRef<{ x: number; y: number } | null>(null)

    const drag = useDragGesture({
        disabled: readOnly,
        onDragStart: ctx => {
            // Capture this cell's screen-space top-left so onDragMove
            // can convert ctx.pointer (clientX/Y on web, pageX/Y on
            // native) to a cell-local offset. Web supplies the rect via
            // getBoundingClientRect; native has to measureInWindow.
            if (ctx.startRect != null) {
                cellOriginRef.current = { x: ctx.startRect.left, y: ctx.startRect.top }
            } else if (pressableRef.current != null) {
                pressableRef.current.measureInWindow((x, y) => {
                    cellOriginRef.current = { x, y }
                })
            } else {
                cellOriginRef.current = { x: 0, y: 0 }
            }
            // On web, the down-time onMouseDown handler may have already
            // chosen a mode (shift / ctrl / formula-edit ref). In that
            // case just engage; onDragMove dispatches off dragModeRef.
            if (dragModeRef.current != null) return true
            const state = store.getState()
            if (state.editSession != null) {
                // Native (no down-time modifier path): try ref-drag.
                if (!state.cellRefDragStart(row, col)) return false
                dragModeRef.current = 'ref'
                skipNextPressRef.current = true
                return true
            }
            const isCtrl = ctx.pointer.ctrlKey || ctx.pointer.metaKey
            if (isCtrl) {
                state.addSubRange({ row, col })
                dragModeRef.current = 'ctrl-select'
                skipNextPressRef.current = true
                return true
            }
            if (ctx.pointer.shiftKey) {
                state.extendActiveRangeTo({ row, col })
                dragModeRef.current = 'select'
                skipNextPressRef.current = true
                return true
            }
            state.selectCell({ row, col })
            dragModeRef.current = 'select'
            skipNextPressRef.current = true
            return true
        },
        onDragMove: ctx => {
            const mode = dragModeRef.current
            if (mode == null) return
            const absLeft = colOffsets[col - 1] ?? 0
            const absTop = rowOffsets[row - 1] ?? 0
            // cellOriginRef holds this cell's screen-space top-left
            // (from getBoundingClientRect on web, measureInWindow on
            // native). Subtracting it from ctx.pointer gives the
            // pointer offset inside the cell; adding the cell's
            // absolute grid origin yields the pointer's grid coords.
            const origin = cellOriginRef.current ?? { x: 0, y: 0 }
            const gridX = absLeft + (ctx.pointer.x - origin.x)
            const gridY = absTop + (ctx.pointer.y - origin.y)
            const target = locateCellAtGridCoord(gridX, gridY, colOffsets, rowOffsets)
            if (target == null) return
            if (mode === 'ref') {
                store.getState().cellRefDragMove(target.row, target.col)
            } else {
                store.getState().extendActiveRangeTo(target)
            }
        },
        onDragEnd: () => {
            if (dragModeRef.current === 'ref') {
                store.getState().cellRefDragEnd()
            }
            dragModeRef.current = null
            cellOriginRef.current = null
        },
    })

    if (isMergedCovered) return null

    if (isEditing) {
        return (
            <CellEditor
                inputRef={cellEditorInputRef}
                left={left}
                top={top}
                width={renderWidth}
                height={renderHeight}
                row={row}
                col={col}
                onSpecialKey={onSpecialKey}
            />
        )
    }

    // When the user is editing a formula and taps this cell, intercept
    // the press to insert a ref instead of selecting/editing the cell.
    // cellRefTap returns false (no-op) when the cursor isn't in a
    // ref-acceptable position, falling through to the normal select/
    // edit gesture.
    const onPress = () => {
        // Suppress the click that fires after one of: a drag just
        // ended, a down-time modifier action ran (shift / ctrl /
        // ref-tap), or onPress was explicitly told to skip. The flag
        // is consumed exactly once per click.
        if (skipNextPressRef.current || drag.wasDragged) {
            skipNextPressRef.current = false
            // A down-time mode (set by webMouseDownProp without any
            // subsequent drag engagement) needs cleanup since
            // onDragEnd never fires. The 'ref' branch clears refDrag
            // and refocuses the formula input.
            if (dragModeRef.current === 'ref') {
                store.getState().cellRefDragEnd()
            }
            dragModeRef.current = null
            return
        }
        const state = store.getState()
        if (state.cellRefTap(row, col)) return
        if (isSelected) {
            state.editCell({ row, col }, editDraft)
        } else {
            state.selectCell({ row, col })
        }
    }

    // Native long-press fires before any subsequent onPress is dispatched,
    // so wiring the context menu here doesn't conflict with the
    // select-then-edit gesture above. Web uses onContextMenu (right-click)
    // via a DOM prop the RN-Web Pressable forwards but doesn't type.
    const onLongPress = readOnly
        ? undefined
        : (e: GestureResponderEvent) => {
              const { pageX, pageY } = e.nativeEvent
              store.getState().openCellContextMenu(row, col, pageX, pageY)
          }

    const webContextMenuProp =
        Platform.OS === 'web' && !readOnly
            ? {
                  onContextMenu: (e: {
                      preventDefault: () => void
                      clientX: number
                      clientY: number
                  }) => {
                      e.preventDefault()
                      store.getState().openCellContextMenu(row, col, e.clientX, e.clientY)
                  },
              }
            : null

    // Web onMouseDown handles down-time-only behaviors that
    // useDragGesture's threshold-gated onDragStart can't:
    //
    //   1. Shift-click without a drag should extend the selection
    //      immediately (no movement required).
    //   2. Ctrl/Cmd-click adds a sub-range immediately and pre-selects
    //      'ctrl-select' so a subsequent drag extends THAT sub-range.
    //   3. During a formula edit, preventDefault swallows the focus
    //      shift so the formula input doesn't blur — blur would
    //      commit the half-typed formula and lose the edit. We also
    //      call cellRefDragStart at down-time so a pure click (no
    //      drag) still inserts the ref via the down-time path.
    //
    // Modifier keys don't reach RN's onPress, so all three need a
    // DOM-level mousedown peek. RN-Web's Pressable forwards
    // onMouseDown unchanged. Native taps don't blur the keyboard and
    // don't carry modifiers, so this whole block is web-only.
    const webMouseDownProp =
        Platform.OS === 'web' && !readOnly
            ? {
                  onMouseDown: (e: {
                      preventDefault: () => void
                      shiftKey?: boolean
                      ctrlKey?: boolean
                      metaKey?: boolean
                      button?: number
                  }) => {
                      if (e.button != null && e.button !== 0) return
                      const isCtrl = e.ctrlKey || e.metaKey
                      if (isAnyEditing) {
                          // Two jobs: swallow focus shift (so the
                          // formula input doesn't blur and commit) and
                          // try to start a ref-drag. cellRefDragStart
                          // returns false if the cursor isn't in a
                          // ref-acceptable spot; the click then falls
                          // through to onPress → cellRefTap (same
                          // outcome via a different path).
                          e.preventDefault()
                          if (store.getState().cellRefDragStart(row, col)) {
                              dragModeRef.current = 'ref'
                              skipNextPressRef.current = true
                          }
                          return
                      }
                      if (isCtrl) {
                          e.preventDefault()
                          skipNextPressRef.current = true
                          store.getState().addSubRange({ row, col })
                          dragModeRef.current = 'ctrl-select'
                          return
                      }
                      if (e.shiftKey) {
                          e.preventDefault()
                          skipNextPressRef.current = true
                          store.getState().extendActiveRangeTo({ row, col })
                          dragModeRef.current = 'select'
                          return
                      }
                  },
              }
            : null

    // Keyboard handling on a focused (selected, not-editing) cell.
    // Delete / Backspace clear the active selection (whole range, not
    // just the anchor); a printable single-character key opens the
    // editor with that character as the seed (Sheets / Excel
    // typing-to-replace). Modifier combos belong to the global
    // shortcut registry, not here. See classifyCellKey for the rules.
    const onCellKeyDown = (e: CellKeyEvent & { preventDefault?: () => void }) => {
        if (readOnly) return
        const action = classifyCellKey(e)
        if (action.kind === 'ignore') return
        if (action.kind === 'arrow') {
            // Plan §6.c: arrow on a disjoint selection collapses to a
            // single cell at the primary anchor. The focus traversal
            // then continues normally so the neighbor cell takes
            // focus. On a single-rectangle selection collapseToPrimary
            // is a no-op when already single-cell; on a multi-cell
            // rectangle it shrinks to the anchor — matches Sheets.
            store.getState().collapseToPrimary()
            // Don't preventDefault — the browser still needs to move
            // focus to the neighbor cell.
            return
        }
        if (action.kind === 'extend') {
            // Sheets/Excel parity: Shift+arrow grows or shrinks the
            // active sub-range by one cell along the chosen axis. The
            // anchor stays put; the corner opposite the anchor moves.
            // preventDefault so the browser doesn't also walk focus
            // off the anchor cell.
            e.preventDefault?.()
            const state = store.getState()
            const next = computeShiftArrowTarget(
                state.selection,
                action.direction,
                row,
                col,
                rowOffsets.length - 1,
                colOffsets.length - 1
            )
            store.getState().extendActiveRangeTo(next)
            return
        }
        e.preventDefault?.()
        if (action.kind === 'clear') {
            store.getState().clearSelection()
            return
        }
        store.getState().editCell({ row, col }, action.seed)
    }

    const showRemoteDraft = remoteDraft != null
    const renderStyle = cellStyleToRenderProps(
        mergeCellStyles(cellValue?.style, conditionalStyle)
    )
    // Remote-draft display layers a peer's color + italic on top of
    // the cell's own style. Spread the style-derived textStyle first
    // so the remote-draft color and italic override (matching the
    // pre-format behavior).
    const textStyle = showRemoteDraft
        ? {
              ...renderStyle.textStyle,
              color: remoteEditor?.user.color,
              fontStyle: 'italic' as const,
          }
        : renderStyle.textStyle

    // Cells inside a multi-cell range get a translucent tint so the
    // user can see the full extent of the selection. The anchor cell
    // is excluded — its outlined border (drawn by LocalSelectionOverlay
    // and the PrimaryAnchorOverlay) is the visual cue for "this is
    // where typing/formula bar is rooted". Drawn before the cell's own
    // viewStyle so any user-set fill paints over the tint.
    const rangeTintStyle =
        isInRange && !isSelected ? { backgroundColor: 'rgba(34, 160, 107, 0.10)' } : null

    return (
        <Pressable
            ref={pressableRef}
            onPress={onPress}
            onLongPress={onLongPress}
            onKeyDown={onCellKeyDown}
            accessibilityLabel={`Cell ${columnLabel(col)}${row}`}
            style={{
                position: 'absolute',
                left,
                top,
                width: renderWidth,
                height: renderHeight,
                ...rangeTintStyle,
                ...renderStyle.viewStyle,
            }}
            className="border-r border-b border-border bg-background justify-center px-1"
            // biome-ignore lint/suspicious/noExplicitAny: web-only DOM event prop on RN Pressable
            {...((webContextMenuProp ?? {}) as any)}
            // biome-ignore lint/suspicious/noExplicitAny: web-only DOM event prop on RN Pressable
            {...((webMouseDownProp ?? {}) as any)}
            {...drag.handlers}
        >
            <Text className="text-xs" numberOfLines={renderStyle.numberOfLines} style={textStyle}>
                {showRemoteDraft ? remoteDraft : display}
            </Text>
            <CommentIndicator sheetId={sheetId} row={row} col={col} />
        </Pressable>
    )
})

interface CellEditorProps {
    inputRef: React.RefObject<TextInput | null>
    left: number
    top: number
    width: number
    height: number
    row: number
    col: number
    onSpecialKey: (key: FormulaSpecialKey) => boolean
}

function CellEditor({
    inputRef,
    left,
    top,
    width,
    height,
    row,
    col,
    onSpecialKey,
}: CellEditorProps) {
    const store = useGridStoreApi()
    const draft = useGridStore(s => s.editSession?.draft ?? '')
    const selection = useGridStore(s => s.pendingSelection ?? undefined)
    const autoFocus = useGridStore(s => s.activeSurface === 'cell')

    const onChangeText = useCallback(
        (next: string) => store.getState().setEditDraft(row, col, next),
        [store, row, col]
    )
    const onSelectionChange = useCallback(
        (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
            const sel = e.nativeEvent.selection
            store.getState().setEditSelection(row, col, sel.start, sel.end)
        },
        [store, row, col]
    )
    const onSubmit = useCallback(() => {
        // Read the latest draft from the store at fire time — using
        // the closure-captured value would commit a stale string when
        // the user presses Enter immediately after typing (RN onBlur
        // and onSubmitEditing can fire with the live keystroke not yet
        // flushed through the closure).
        const session = store.getState().editSession
        if (session == null) return
        store.getState().commitEdit(row, col, session.draft)
    }, [store, row, col])
    const onFocus = useCallback(() => store.getState().setActiveSurface('cell'), [store])
    const onKeyPress = useCallback(
        (e: { nativeEvent: { key?: string }; preventDefault?: () => void }) => {
            const key = e.nativeEvent.key
            if (key === 'Escape') {
                if (onSpecialKey('Escape')) {
                    e.preventDefault?.()
                    return
                }
                store.getState().cancelEdit()
                return
            }
            if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'Tab' || key === 'Enter') {
                if (onSpecialKey(key)) {
                    e.preventDefault?.()
                }
            }
        },
        [store, onSpecialKey]
    )

    return (
        <TextInput
            ref={inputRef}
            autoFocus={autoFocus}
            value={draft}
            selection={selection}
            onChangeText={onChangeText}
            onSelectionChange={onSelectionChange}
            onSubmitEditing={onSubmit}
            onBlur={onSubmit}
            onFocus={onFocus}
            onKeyPress={onKeyPress}
            inputAccessoryViewID={
                Platform.OS === 'ios' ? FORMULA_BAR_ACCESSORY_ID : undefined
            }
            style={{
                position: 'absolute',
                left,
                top,
                width,
                height,
                paddingHorizontal: 4,
                fontSize: 12,
                borderWidth: 2,
                borderColor: '#22a06b',
            }}
            className="bg-background text-foreground"
        />
    )
}
