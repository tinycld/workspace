import { useDragGesture } from '@tinycld/core/lib/gestures'
import { useRef } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import { useSheetMerges } from '../../hooks/use-cell-merge'
import type { DragState } from '../../hooks/use-column-resize'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import type { RemotePresence } from '../../hooks/use-presence'
import type { RowDragState } from '../../hooks/use-row-resize'
import { useWorkbook } from '../../hooks/use-workbook-context'
import { expandRangeOverMergeList, type MergeRange } from '../../lib/merge'
import {
    isDisjoint,
    primaryAnchor,
    primaryRange,
} from '../../lib/selection-range'
import { locateCellAtGridCoord } from './style-helpers'

interface RemoteOverlaysProps {
    presenceOnSheet: RemotePresence[]
    colOffsets: Float64Array
    rowOffsets: Float64Array
}

// Renders one overlay per remote peer's cursor or editing cell. Lives
// in a fragment so the parent ScrollView can place it inline with the
// cell layer.
export function RemoteOverlays({ presenceOnSheet, colOffsets, rowOffsets }: RemoteOverlaysProps) {
    const overlays: React.ReactNode[] = []
    for (const p of presenceOnSheet) {
        if (p.selection != null && p.editing == null) {
            overlays.push(
                <RemoteSelectionOverlay
                    key={`sel-${p.clientID}`}
                    row={p.selection.row}
                    col={p.selection.col}
                    colOffsets={colOffsets}
                    rowOffsets={rowOffsets}
                    color={p.user.color}
                    name={p.user.name}
                />
            )
        }
        if (p.editing != null) {
            overlays.push(
                <RemoteSelectionOverlay
                    key={`edit-${p.clientID}`}
                    row={p.editing.row}
                    col={p.editing.col}
                    colOffsets={colOffsets}
                    rowOffsets={rowOffsets}
                    color={p.user.color}
                    name={p.user.name}
                />
            )
        }
    }
    return <>{overlays}</>
}

interface LocalSelectionOverlayProps {
    sheetId: string
    colOffsets: Float64Array
    rowOffsets: Float64Array
}

// Renders the green selection rectangles. One outer outline per
// sub-range; the primary (last) sub-range additionally gets a thinner
// inner anchor outline so the user can tell which cell drives the
// formula bar / toolbar indicators. On a single-rectangle selection
// (the N=1 case) the visual collapses to the original single-cell
// ring and rectangle.
//
// Sub-ranges are painted in insertion order so the primary (last)
// outline z-orders on top of any earlier overlapping outlines — see
// plan Risk 6.
//
// Sub-range rectangles are expanded over any intersecting merges so
// the green outline traces the full merged footprint (the active-edit
// blue border already does this via the anchor cell's renderWidth /
// renderHeight; this is the parity fix for non-edit selection). The
// primary-anchor inner outline grows to the same merge when the
// anchor cell is itself a merge anchor.
//
// Hidden during an edit session: the CellEditor's own border is the
// active-edit affordance.
export function LocalSelectionOverlay({
    sheetId,
    colOffsets,
    rowOffsets,
}: LocalSelectionOverlayProps) {
    const { doc } = useWorkbook()
    const merges = useSheetMerges(doc, sheetId)
    const selection = useGridStore(s => (s.editSession == null ? s.selection : null))
    if (selection == null || selection.ranges.length === 0) return null

    const primaryIdx = selection.ranges.length - 1
    const overlays: React.ReactNode[] = []
    for (let i = 0; i < selection.ranges.length; i++) {
        const sr = selection.ranges[i]
        const expanded = expandRangeOverMergeList(sr.range, merges)
        const left = colOffsets[expanded.startCol - 1] ?? 0
        const right = colOffsets[expanded.endCol] ?? left
        const width = right - left
        if (width <= 0) continue
        const top = rowOffsets[expanded.startRow - 1] ?? 0
        const bottom = rowOffsets[expanded.endRow] ?? top
        const height = bottom - top
        if (height <= 0) continue
        overlays.push(
            <View
                key={`sel-${i}`}
                pointerEvents="none"
                style={{
                    position: 'absolute',
                    left,
                    top,
                    width,
                    height,
                    borderWidth: 2,
                    borderColor: '#22a06b',
                }}
            />
        )
    }

    // Inner outline on the primary anchor — only meaningful when the
    // primary sub-range covers more than the anchor cell itself (so the
    // user can tell anchor-vs-range apart). Tested against the
    // *unexpanded* range: a single-cell click on a merge anchor is
    // logically still a 1-cell selection — the outer outline already
    // wraps the merged footprint, and we don't want to double up.
    const primary = selection.ranges[primaryIdx]
    const primaryAnchorCell = primary.anchor
    const primaryCovers1Cell =
        primary.range.startRow === primary.range.endRow &&
        primary.range.startCol === primary.range.endCol
    if (!primaryCovers1Cell) {
        const anchorMerge = findMergeAnchoredAt(
            primaryAnchorCell.row,
            primaryAnchorCell.col,
            merges
        )
        const anchorStartCol = primaryAnchorCell.col
        const anchorEndCol =
            anchorMerge != null
                ? anchorMerge.anchorCol + anchorMerge.colSpan - 1
                : primaryAnchorCell.col
        const anchorStartRow = primaryAnchorCell.row
        const anchorEndRow =
            anchorMerge != null
                ? anchorMerge.anchorRow + anchorMerge.rowSpan - 1
                : primaryAnchorCell.row
        const anchorLeft = colOffsets[anchorStartCol - 1] ?? 0
        const anchorRight = colOffsets[anchorEndCol] ?? anchorLeft
        const anchorWidth = anchorRight - anchorLeft
        const anchorTop = rowOffsets[anchorStartRow - 1] ?? 0
        const anchorBottom = rowOffsets[anchorEndRow] ?? anchorTop
        const anchorHeight = anchorBottom - anchorTop
        if (anchorWidth > 0 && anchorHeight > 0) {
            overlays.push(
                <View
                    key="sel-anchor"
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        left: anchorLeft,
                        top: anchorTop,
                        width: anchorWidth,
                        height: anchorHeight,
                        borderWidth: 2,
                        borderColor: '#1a8757',
                        backgroundColor: 'rgba(255, 255, 255, 0.0)',
                    }}
                />
            )
        }
    }
    return <>{overlays}</>
}

function findMergeAnchoredAt(
    row: number,
    col: number,
    merges: MergeRange[]
): MergeRange | null {
    for (const m of merges) {
        if (m.anchorRow === row && m.anchorCol === col) return m
    }
    return null
}

interface RefDragOverlayProps {
    colOffsets: Float64Array
    rowOffsets: Float64Array
}

// While a ref-drag is in progress, paint a translucent rectangle over
// the chosen range so the user sees the selection they're about to
// commit. Pointer-events disabled so it doesn't block the pan
// gesture.
export function RefDragOverlay({ colOffsets, rowOffsets }: RefDragOverlayProps) {
    const refDrag = useGridStore(s => s.refDrag)
    if (refDrag == null) return null
    const minRow = Math.min(refDrag.anchor.row, refDrag.end.row)
    const maxRow = Math.max(refDrag.anchor.row, refDrag.end.row)
    const minCol = Math.min(refDrag.anchor.col, refDrag.end.col)
    const maxCol = Math.max(refDrag.anchor.col, refDrag.end.col)
    const left = colOffsets[minCol - 1] ?? 0
    const right = colOffsets[maxCol] ?? left
    const width = right - left
    if (width <= 0) return null
    const top = rowOffsets[minRow - 1] ?? 0
    const bottom = rowOffsets[maxRow] ?? top
    const height = bottom - top
    if (height <= 0) return null
    return (
        <View
            pointerEvents="none"
            style={{
                position: 'absolute',
                left,
                top,
                width,
                height,
                borderWidth: 2,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.10)',
            }}
        />
    )
}

interface FillPreviewOverlayProps {
    colOffsets: Float64Array
    rowOffsets: Float64Array
}

// While a fill-handle drag is in progress, paint a dashed green
// rectangle over the *extension* of the destination range — the
// region strictly outside sourceRange but inside destRange. The
// source itself keeps its own selection ring (LocalSelectionOverlay)
// so drawing the source again here would just double up. Direction
// is one of 'down' | 'right' (never both, by FillDrag's axis-locking
// contract), so the extension is always a single rectangle.
//
// Pointer-events disabled so the dot's drag listener stays in
// control of the gesture for the entire drag.
export function FillPreviewOverlay({ colOffsets, rowOffsets }: FillPreviewOverlayProps) {
    const fillDrag = useGridStore(s => s.fillDrag)
    if (fillDrag == null) return null
    const { sourceRange, destRange, direction } = fillDrag
    if (
        sourceRange.startRow === destRange.startRow &&
        sourceRange.endRow === destRange.endRow &&
        sourceRange.startCol === destRange.startCol &&
        sourceRange.endCol === destRange.endCol
    ) {
        return null
    }

    let startRow: number
    let endRow: number
    let startCol: number
    let endCol: number
    if (direction === 'down') {
        startRow = sourceRange.endRow + 1
        endRow = destRange.endRow
        startCol = sourceRange.startCol
        endCol = sourceRange.endCol
    } else {
        startRow = sourceRange.startRow
        endRow = sourceRange.endRow
        startCol = sourceRange.endCol + 1
        endCol = destRange.endCol
    }
    if (startRow > endRow || startCol > endCol) return null

    const left = colOffsets[startCol - 1] ?? 0
    const right = colOffsets[endCol] ?? left
    const width = right - left
    if (width <= 0) return null
    const top = rowOffsets[startRow - 1] ?? 0
    const bottom = rowOffsets[endRow] ?? top
    const height = bottom - top
    if (height <= 0) return null

    return (
        <View
            pointerEvents="none"
            style={{
                position: 'absolute',
                left,
                top,
                width,
                height,
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: '#22a06b',
                backgroundColor: 'rgba(34, 160, 107, 0.10)',
            }}
        />
    )
}

interface RemoteSelectionOverlayProps {
    row: number
    col: number
    colOffsets: Float64Array
    rowOffsets: Float64Array
    color: string
    name: string
}

function RemoteSelectionOverlay({
    row,
    col,
    colOffsets,
    rowOffsets,
    color,
    name,
}: RemoteSelectionOverlayProps) {
    const left = colOffsets[col - 1] ?? 0
    const width = (colOffsets[col] ?? left) - left
    if (width <= 0) return null
    const top = rowOffsets[row - 1] ?? 0
    const height = (rowOffsets[row] ?? top) - top
    if (height <= 0) return null
    return (
        <View
            pointerEvents="none"
            style={{
                position: 'absolute',
                left,
                top,
                width,
                height,
                borderWidth: 2,
                borderColor: color,
            }}
        >
            <View
                style={{
                    position: 'absolute',
                    bottom: -16,
                    left: 0,
                    paddingHorizontal: 4,
                    paddingVertical: 1,
                    backgroundColor: color,
                }}
            >
                <Text style={{ color: 'white', fontSize: 9 }} numberOfLines={1}>
                    {name}
                </Text>
            </View>
        </View>
    )
}

interface ResizePreviewLineProps {
    dragState: DragState | null
    colOffsets: Float64Array
    contentHeight: number
}

// Vertical green guide line drawn at the proposed new right-edge of
// the column being resized. Anchored to the absolute body so it
// scrolls with the cells but isn't clipped by per-cell windowing.
// Renders nothing when no drag is active — that's the default state
// the React tree can mount cheaply.
export function ResizePreviewLine({
    dragState,
    colOffsets,
    contentHeight,
}: ResizePreviewLineProps) {
    if (dragState == null) return null
    const left = (colOffsets[dragState.col - 1] ?? 0) + dragState.currentWidth
    return (
        <View
            pointerEvents="none"
            style={{
                position: 'absolute',
                left: left - 1,
                top: 0,
                width: 2,
                height: contentHeight,
                backgroundColor: '#22a06b',
                opacity: 0.7,
            }}
        />
    )
}

interface RowResizePreviewLineProps {
    dragState: RowDragState | null
    rowOffsets: Float64Array
    contentWidth: number
}

// Horizontal green guide line drawn at the proposed new bottom-edge of
// the row being resized. Mirror of ResizePreviewLine on the row axis.
export function RowResizePreviewLine({
    dragState,
    rowOffsets,
    contentWidth,
}: RowResizePreviewLineProps) {
    if (dragState == null) return null
    const top = (rowOffsets[dragState.row - 1] ?? 0) + dragState.currentHeight
    return (
        <View
            pointerEvents="none"
            style={{
                position: 'absolute',
                left: 0,
                top: top - 1,
                width: contentWidth,
                height: 2,
                backgroundColor: '#22a06b',
                opacity: 0.7,
            }}
        />
    )
}

interface SelectionHandleOverlayProps {
    sheetId: string
    colOffsets: Float64Array
    rowOffsets: Float64Array
    readOnly: boolean
}

// HANDLE_SIZE is the visible square the user grabs. HIT_SLOP enlarges
// the touch target without growing the visible affordance — a 16px
// total tap area on every side keeps fat-finger touches reliable on
// mobile while the visible dot stays compact.
const HANDLE_SIZE = 8
const HIT_SLOP = 12

// SelectionHandleOverlay renders the small drag dot at the bottom-
// right of the current selection (anchor or range). Drag — by mouse
// or touch — fills a series across the new cells (the classic
// spreadsheet "fill handle"): pattern detection runs on the source,
// projection writes per-cell, and the post-fill selection covers the
// extended rectangle.
//
// Web escape hatch: holding shift at drag-start routes the gesture
// to extendSelectionTo instead of fillDragMove. This preserves the
// pre-fill drag-to-extend behavior for the rare case where the user
// wants to grow the selection without filling. Modifier state is
// captured at down-time (useDragGesture's contract) — toggling shift
// mid-drag does not flip the mode. Native has no shift key — touch
// users always get fill; "Extend selection to here" lives in the
// long-press cell context menu as the touch-side fallback.
//
// Hidden during edit sessions so the dot doesn't sit on top of the
// CellEditor's caret. Hidden in readOnly mode since there's no
// meaningful gesture there.
//
// Web vs. native: useDragGesture papers over the platform split — web
// uses PointerEvents with setPointerCapture, native uses PanResponder,
// both feed the same callback shape. The delta-based fill math
// (startClientX/Y + d) works on either coord frame as long as we read
// ctx.pointer.x/y consistently in both captureStart and handleMove.
export function SelectionHandleOverlay({
    sheetId,
    colOffsets,
    rowOffsets,
    readOnly,
}: SelectionHandleOverlayProps) {
    // Read the primary sub-range — that's where the fill handle
    // anchors (bottom-right corner). Disjoint selections hide the
    // handle entirely (plan §6.e); the fill operation is
    // fundamentally a single-rectangle extension.
    const { doc } = useWorkbook()
    const merges = useSheetMerges(doc, sheetId)
    const selection = useGridStore(s => (s.editSession == null ? s.selection : null))
    const disjoint = useGridStore(s => isDisjoint(s.selection))
    const store = useGridStoreApi()

    const startGridX = useRef(0)
    const startGridY = useRef(0)
    const startClientX = useRef(0)
    const startClientY = useRef(0)

    const captureStart = (clientX: number, clientY: number) => {
        const s = store.getState()
        // Defense in depth: refuse the gesture if the selection went
        // disjoint between the render and the mousedown.
        if (isDisjoint(s.selection)) return false
        const r = primaryRange(s.selection)
        if (r == null) return false
        // Anchor the drag origin at the merge-expanded bottom-right —
        // matches the rendered handle position. Without this, a click
        // on the handle of a merged-anchor selection would jump because
        // the origin sat at the unmerged anchor cell's corner while the
        // dot rendered at the merged footprint's corner.
        const expanded = expandRangeOverMergeList(r, merges)
        startGridX.current = colOffsets[expanded.endCol] ?? 0
        startGridY.current = rowOffsets[expanded.endRow] ?? 0
        startClientX.current = clientX
        startClientY.current = clientY
        return true
    }

    const handleMove = (clientX: number, clientY: number, shiftKey: boolean) => {
        const dx = clientX - startClientX.current
        const dy = clientY - startClientY.current
        const gridX = startGridX.current + dx
        const gridY = startGridY.current + dy
        const target = locateCellAtGridCoord(gridX, gridY, colOffsets, rowOffsets)
        if (target == null) return
        if (shiftKey) {
            store.getState().extendActiveRangeTo(target)
            return
        }
        store.getState().fillDragMove(target)
    }

    // Always call fillDragEnd on release so a shift-only drag (which
    // bootstrapped fillDrag in captureStart but never moved past the
    // source via fillDragMove) doesn't leave stale fillDrag state in
    // the store. The store's fillDragEnd no-ops cleanly when destRange
    // equals sourceRange.
    const handleEnd = () => {
        store.getState().fillDragEnd()
    }

    // useDragGesture papers over the web/native split. Both branches
    // feed ctx.pointer.x/y in the same frame they captured at start
    // (web: clientX/Y, native: pageX/Y), so the delta math in
    // handleMove works without any per-platform conversion.
    //
    // Shift-modifier capture: useDragGesture reports modifiers at
    // down-time only (ctx.pointer.shiftKey). Toggling shift mid-drag
    // no longer flips the mode — the rest of calc's drag gestures
    // behave the same way, and live modifier tracking isn't a calc
    // use case anywhere else.
    const fillDrag = useDragGesture({
        disabled: readOnly,
        onDragStart: ctx => {
            if (!captureStart(ctx.pointer.x, ctx.pointer.y)) return false
            if (!store.getState().fillDragStart()) return false
            return true
        },
        onDragMove: ctx => {
            handleMove(ctx.pointer.x, ctx.pointer.y, ctx.pointer.shiftKey)
        },
        onDragEnd: () => {
            handleEnd()
        },
    })

    if (selection == null || readOnly) return null
    // Hide handle on disjoint selections — plan §6.e and Risk 5.
    if (disjoint) return null
    const primary = primaryRange(selection)
    if (primary == null) return null
    const primaryAnchorCell = primaryAnchor(selection)
    if (primaryAnchorCell == null) return null
    // Position the handle at the bottom-right of the merge-expanded
    // primary range so a single-cell selection on a merge anchor puts
    // the dot at the merged footprint's corner, not the anchor cell's
    // corner. Mirrors the green outline expansion in
    // LocalSelectionOverlay.
    const primaryExpanded = expandRangeOverMergeList(primary, merges)
    const right = colOffsets[primaryExpanded.endCol] ?? 0
    const bottom = rowOffsets[primaryExpanded.endRow] ?? 0
    if (right <= 0 || bottom <= 0) return null

    // Center the handle on the bottom-right corner of the bottom-
    // right cell. The hitSlop expands the touch target invisibly so
    // touch users get a comfortable grab area.
    const left = right - HANDLE_SIZE / 2
    const top = bottom - HANDLE_SIZE / 2

    return (
        <Pressable
            accessibilityLabel="Selection handle"
            hitSlop={HIT_SLOP}
            style={
                {
                    position: 'absolute',
                    left,
                    top,
                    width: HANDLE_SIZE,
                    height: HANDLE_SIZE,
                    backgroundColor: '#22a06b',
                    borderWidth: 1,
                    borderColor: '#ffffff',
                    // Web-only cursor affordance — RN-Web forwards
                    // unknown style keys to inline CSS. Native has no
                    // cursor concept; the hit slop carries discovery
                    // there.
                    ...(Platform.OS === 'web' ? { cursor: 'crosshair' } : null),
                    // biome-ignore lint/suspicious/noExplicitAny: web-only cursor key on RN ViewStyle
                } as any
            }
            {...fillDrag.handlers}
        />
    )
}
