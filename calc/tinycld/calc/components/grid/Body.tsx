// Quadrant layout for freeze panes.
//
// When `frozenRows === 0 && frozenCols === 0` Body renders the original
// single-quadrant layout: a horizontal ScrollView containing a vertical
// ScrollView, with cells absolute-positioned by their prefix-sum
// offsets and a column of overlay views on top.
//
// When either freeze count is non-zero the viewport splits into 4
// quadrants laid out as:
//
//     +----------------+--------------------+
//     |  TL: top-left  |  TR: top-right     |
//     |  no scroll     |  horizontal-only   |
//     |  frozen rows   |  frozen rows       |
//     |  frozen cols   |  free cols         |
//     +----------------+--------------------+
//     |  BL: bot-left  |  BR: bottom-right  |
//     |  vertical-only |  horizontal +      |
//     |  free rows     |  vertical          |
//     |  frozen cols   |  free rows + cols  |
//     +----------------+--------------------+
//
// The body's *own* horizontalRef / verticalRef refs always point at the
// bottom-right ScrollViews; horizontal scroll mirrors to the
// top-right's frozenRowHorizontalRef and the column header, vertical
// scroll mirrors to the bottom-left's frozenColVerticalRef and the row
// header. Wiring lives in use-grid-viewport.ts.
//
// Within each quadrant cells use the same Cell component but receive
// quadrant-relative `left` / `top` props (absolute prefix-sum minus
// the frozen-extent offset) so they paint in the right place. Cells
// outside the quadrant's row/col range are skipped at iteration time.
//
// Overlays (selection ring, marching-ants, ref-drag, range tint, drag
// handle) render in the bottom-right quadrant only for v1. A range that
// crosses the freeze divider visually clips at the bottom-right's
// edge — accepted compromise documented in the task plan; clipping per
// quadrant is a follow-up.

import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useMemo } from 'react'
import {
    type LayoutChangeEvent,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    ScrollView,
    type TextInput,
    View,
} from 'react-native'
import type { DragState } from '../../hooks/use-column-resize'
import type { RemotePresence } from '../../hooks/use-presence'
import type { RowDragState } from '../../hooks/use-row-resize'
import type { SheetWithId } from '../../hooks/use-y-sheets'
import type { FormulaSpecialKey } from '../FormulaBar'
import { Cell } from './Cell'
import { CutMarchingAntsOverlay } from './CutMarchingAntsOverlay'
import { FindMatchOverlay } from './FindMatchOverlay'
import {
    FillPreviewOverlay,
    LocalSelectionOverlay,
    RefDragOverlay,
    RemoteOverlays,
    ResizePreviewLine,
    RowResizePreviewLine,
    SelectionHandleOverlay,
} from './overlays'
import { SelectionEdgeHandles } from './SelectionEdgeHandles'

interface BodyProps {
    horizontalRef: React.RefObject<ScrollView | null>
    verticalRef: React.RefObject<ScrollView | null>
    contentWidth: number
    contentHeight: number
    colOffsets: Float64Array
    rowOffsets: Float64Array
    colDragState: DragState | null
    rowDragState: RowDragState | null
    visible: { firstRow: number; lastRow: number; firstCol: number; lastCol: number }
    sheet: SheetWithId | null
    cellEditorInputRef: React.RefObject<TextInput | null>
    presenceOnSheet: RemotePresence[]
    readOnly: boolean
    frozenRows: number
    frozenCols: number
    frozenRowHorizontalRef: React.RefObject<ScrollView | null>
    frozenColVerticalRef: React.RefObject<ScrollView | null>
    onSpecialKey: (key: FormulaSpecialKey) => boolean
    onLayout: (e: LayoutChangeEvent) => void
    onHorizontalScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
    onVerticalScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
}

export function Body(props: BodyProps) {
    const { frozenRows, frozenCols } = props
    if (frozenRows <= 0 && frozenCols <= 0) {
        return <SingleQuadrantBody {...props} />
    }
    return <SplitBody {...props} />
}

function SingleQuadrantBody({
    horizontalRef,
    verticalRef,
    contentWidth,
    contentHeight,
    colOffsets,
    rowOffsets,
    colDragState,
    rowDragState,
    visible,
    sheet,
    cellEditorInputRef,
    presenceOnSheet,
    readOnly,
    onSpecialKey,
    onLayout,
    onHorizontalScroll,
    onVerticalScroll,
}: BodyProps) {
    const sheetId = sheet?.id ?? ''
    const remoteEditingByCell = useRemoteEditingMap(presenceOnSheet)
    const cells = renderQuadrantCells({
        sheet,
        sheetId,
        firstRow: Math.max(visible.firstRow, 1),
        lastRow: visible.lastRow,
        firstCol: Math.max(visible.firstCol, 1),
        lastCol: visible.lastCol,
        rowOffset: 0,
        colOffset: 0,
        colOffsets,
        rowOffsets,
        readOnly,
        cellEditorInputRef,
        remoteEditingByCell,
        onSpecialKey,
    })
    return (
        <View style={{ flex: 1, overflow: 'hidden' }} onLayout={onLayout}>
            <ScrollView
                ref={horizontalRef}
                horizontal
                onScroll={onHorizontalScroll}
                scrollEventThrottle={16}
                showsHorizontalScrollIndicator
                contentContainerStyle={{ width: contentWidth }}
            >
                <ScrollView
                    ref={verticalRef}
                    onScroll={onVerticalScroll}
                    scrollEventThrottle={16}
                    showsVerticalScrollIndicator
                    style={{ width: contentWidth }}
                    contentContainerStyle={{ width: contentWidth, height: contentHeight }}
                >
                    {cells}
                    <RemoteOverlays
                        presenceOnSheet={presenceOnSheet}
                        colOffsets={colOffsets}
                        rowOffsets={rowOffsets}
                    />
                    <FindMatchOverlay
                        sheetId={sheetId}
                        colOffsets={colOffsets}
                        rowOffsets={rowOffsets}
                    />
                    <LocalSelectionOverlay
                        sheetId={sheetId}
                        colOffsets={colOffsets}
                        rowOffsets={rowOffsets}
                    />
                    <CutMarchingAntsOverlay colOffsets={colOffsets} rowOffsets={rowOffsets} />
                    <FillPreviewOverlay colOffsets={colOffsets} rowOffsets={rowOffsets} />
                    <SelectionHandleOverlay
                        sheetId={sheetId}
                        colOffsets={colOffsets}
                        rowOffsets={rowOffsets}
                        readOnly={readOnly}
                    />
                    <SelectionEdgeHandles
                        colOffsets={colOffsets}
                        rowOffsets={rowOffsets}
                        readOnly={readOnly}
                    />
                    <RefDragOverlay colOffsets={colOffsets} rowOffsets={rowOffsets} />
                    <ResizePreviewLine
                        dragState={colDragState}
                        colOffsets={colOffsets}
                        contentHeight={contentHeight}
                    />
                    <RowResizePreviewLine
                        dragState={rowDragState}
                        rowOffsets={rowOffsets}
                        contentWidth={contentWidth}
                    />
                </ScrollView>
            </ScrollView>
        </View>
    )
}

function SplitBody({
    horizontalRef,
    verticalRef,
    contentWidth,
    contentHeight,
    colOffsets,
    rowOffsets,
    colDragState,
    rowDragState,
    visible,
    sheet,
    cellEditorInputRef,
    presenceOnSheet,
    readOnly,
    frozenRows,
    frozenCols,
    frozenRowHorizontalRef,
    frozenColVerticalRef,
    onSpecialKey,
    onLayout,
    onHorizontalScroll,
    onVerticalScroll,
}: BodyProps) {
    const sheetId = sheet?.id ?? ''
    const remoteEditingByCell = useRemoteEditingMap(presenceOnSheet)
    const borderColor = useThemeColor('border')

    // Clamp frozen counts so a stale value past the actual sheet extent
    // doesn't blow out the offset math. The freeze quadrants degenerate
    // to "no freeze" if either count exceeds the sheet's row/col total.
    const cols = Math.max(0, colOffsets.length - 1)
    const rows = Math.max(0, rowOffsets.length - 1)
    const fRows = Math.min(Math.max(0, frozenRows), rows)
    const fCols = Math.min(Math.max(0, frozenCols), cols)
    const frozenW = fCols > 0 ? colOffsets[fCols] : 0
    const frozenH = fRows > 0 ? rowOffsets[fRows] : 0

    const freeFirstRow = Math.max(visible.firstRow, fRows + 1)
    const freeFirstCol = Math.max(visible.firstCol, fCols + 1)
    const freeContentWidth = Math.max(0, contentWidth - frozenW)
    const freeContentHeight = Math.max(0, contentHeight - frozenH)

    const tlCells =
        fRows > 0 && fCols > 0
            ? renderQuadrantCells({
                  sheet,
                  sheetId,
                  firstRow: 1,
                  lastRow: fRows,
                  firstCol: 1,
                  lastCol: fCols,
                  rowOffset: 0,
                  colOffset: 0,
                  colOffsets,
                  rowOffsets,
                  readOnly,
                  cellEditorInputRef,
                  remoteEditingByCell,
                  onSpecialKey,
              })
            : null

    const trCells =
        fRows > 0
            ? renderQuadrantCells({
                  sheet,
                  sheetId,
                  firstRow: 1,
                  lastRow: fRows,
                  firstCol: freeFirstCol,
                  lastCol: visible.lastCol,
                  rowOffset: 0,
                  colOffset: frozenW,
                  colOffsets,
                  rowOffsets,
                  readOnly,
                  cellEditorInputRef,
                  remoteEditingByCell,
                  onSpecialKey,
              })
            : null

    const blCells =
        fCols > 0
            ? renderQuadrantCells({
                  sheet,
                  sheetId,
                  firstRow: freeFirstRow,
                  lastRow: visible.lastRow,
                  firstCol: 1,
                  lastCol: fCols,
                  rowOffset: frozenH,
                  colOffset: 0,
                  colOffsets,
                  rowOffsets,
                  readOnly,
                  cellEditorInputRef,
                  remoteEditingByCell,
                  onSpecialKey,
              })
            : null

    const brCells = renderQuadrantCells({
        sheet,
        sheetId,
        firstRow: freeFirstRow,
        lastRow: visible.lastRow,
        firstCol: freeFirstCol,
        lastCol: visible.lastCol,
        rowOffset: frozenH,
        colOffset: frozenW,
        colOffsets,
        rowOffsets,
        readOnly,
        cellEditorInputRef,
        remoteEditingByCell,
        onSpecialKey,
    })

    // Memoize the shifted offset arrays once per render. The overlays
    // each take `colOffsets` / `rowOffsets` props and were previously
    // calling shiftedColOffsets / shiftedRowOffsets inline — that
    // allocated a new Float64Array per overlay per render (≈14
    // arrays per scroll tick).
    const brColOffsets = useMemo(
        () => shiftedColOffsets(colOffsets, fCols),
        [colOffsets, fCols]
    )
    const brRowOffsets = useMemo(
        () => shiftedRowOffsets(rowOffsets, fRows),
        [rowOffsets, fRows]
    )

    return (
        <View style={{ flex: 1, overflow: 'hidden' }} onLayout={onLayout}>
            {fRows > 0 && (
                <View
                    style={{
                        flexDirection: 'row',
                        height: frozenH,
                        // Visual divider line marking the bottom of the
                        // frozen rows. 2px so it reads as deliberate
                        // freeze affordance, not a normal cell border.
                        borderBottomWidth: 2,
                        borderBottomColor: borderColor,
                    }}
                >
                    {fCols > 0 && (
                        <View
                            style={{
                                width: frozenW,
                                height: frozenH,
                                overflow: 'hidden',
                                borderRightWidth: 2,
                                borderRightColor: borderColor,
                            }}
                        >
                            {tlCells}
                        </View>
                    )}
                    <ScrollView
                        ref={frozenRowHorizontalRef}
                        horizontal
                        scrollEnabled={false}
                        showsHorizontalScrollIndicator={false}
                        style={{ flex: 1, height: frozenH }}
                        contentContainerStyle={{ width: freeContentWidth, height: frozenH }}
                    >
                        {trCells}
                    </ScrollView>
                </View>
            )}
            <View style={{ flex: 1, flexDirection: 'row' }}>
                {fCols > 0 && (
                    <View
                        style={{
                            width: frozenW,
                            overflow: 'hidden',
                            borderRightWidth: 2,
                            borderRightColor: borderColor,
                        }}
                    >
                        <ScrollView
                            ref={frozenColVerticalRef}
                            scrollEnabled={false}
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={{ width: frozenW, height: freeContentHeight }}
                        >
                            {blCells}
                        </ScrollView>
                    </View>
                )}
                <View style={{ flex: 1, overflow: 'hidden' }}>
                    <ScrollView
                        ref={horizontalRef}
                        horizontal
                        onScroll={onHorizontalScroll}
                        scrollEventThrottle={16}
                        showsHorizontalScrollIndicator
                        contentContainerStyle={{ width: freeContentWidth }}
                    >
                        <ScrollView
                            ref={verticalRef}
                            onScroll={onVerticalScroll}
                            scrollEventThrottle={16}
                            showsVerticalScrollIndicator
                            style={{ width: freeContentWidth }}
                            contentContainerStyle={{
                                width: freeContentWidth,
                                height: freeContentHeight,
                            }}
                        >
                            {brCells}
                            <RemoteOverlays
                                presenceOnSheet={presenceOnSheet}
                                colOffsets={brColOffsets}
                                rowOffsets={brRowOffsets}
                            />
                            <LocalSelectionOverlay
                                sheetId={sheetId}
                                colOffsets={brColOffsets}
                                rowOffsets={brRowOffsets}
                            />
                            <CutMarchingAntsOverlay
                                colOffsets={brColOffsets}
                                rowOffsets={brRowOffsets}
                            />
                            <FillPreviewOverlay
                                colOffsets={brColOffsets}
                                rowOffsets={brRowOffsets}
                            />
                            <SelectionHandleOverlay
                                sheetId={sheetId}
                                colOffsets={brColOffsets}
                                rowOffsets={brRowOffsets}
                                readOnly={readOnly}
                            />
                            <SelectionEdgeHandles
                                colOffsets={brColOffsets}
                                rowOffsets={brRowOffsets}
                                readOnly={readOnly}
                            />
                            <RefDragOverlay
                                colOffsets={brColOffsets}
                                rowOffsets={brRowOffsets}
                            />
                            <ResizePreviewLine
                                dragState={colDragState}
                                colOffsets={brColOffsets}
                                contentHeight={freeContentHeight}
                            />
                            <RowResizePreviewLine
                                dragState={rowDragState}
                                rowOffsets={brRowOffsets}
                                contentWidth={freeContentWidth}
                            />
                        </ScrollView>
                    </ScrollView>
                </View>
            </View>
        </View>
    )
}

// Map "row:col" → first remote editor occupying that cell. Lifted out
// of <Cell> so cells don't subscribe to presence individually (one
// subscription per visible cell would re-render the whole viewport on
// every keystroke from any peer).
function useRemoteEditingMap(presenceOnSheet: RemotePresence[]) {
    return useMemo(() => {
        const m = new Map<string, RemotePresence>()
        for (const p of presenceOnSheet) {
            if (p.editing == null) continue
            m.set(`${p.editing.row}:${p.editing.col}`, p)
        }
        return m
    }, [presenceOnSheet])
}

interface RenderQuadrantCellsArgs {
    sheet: SheetWithId | null
    sheetId: string
    firstRow: number
    lastRow: number
    firstCol: number
    lastCol: number
    // Subtracted from the absolute prefix-sum offset before assigning
    // each cell its `top` / `left` prop. Lets cells inside non-bottom-
    // right quadrants land at the right pixel inside their own
    // ScrollView (which has its own coordinate origin).
    rowOffset: number
    colOffset: number
    colOffsets: Float64Array
    rowOffsets: Float64Array
    readOnly: boolean
    cellEditorInputRef: React.RefObject<TextInput | null>
    remoteEditingByCell: Map<string, RemotePresence>
    onSpecialKey: (key: FormulaSpecialKey) => boolean
}

function renderQuadrantCells({
    sheet,
    sheetId,
    firstRow,
    lastRow,
    firstCol,
    lastCol,
    rowOffset,
    colOffset,
    colOffsets,
    rowOffsets,
    readOnly,
    cellEditorInputRef,
    remoteEditingByCell,
    onSpecialKey,
}: RenderQuadrantCellsArgs): React.ReactNode[] {
    if (sheet == null) return []
    const cells: React.ReactNode[] = []
    for (let row = firstRow; row <= lastRow; row++) {
        const absTop = rowOffsets[row - 1]
        const height = rowOffsets[row] - absTop
        if (height <= 0) continue
        const top = absTop - rowOffset
        for (let col = firstCol; col <= lastCol; col++) {
            const absLeft = colOffsets[col - 1]
            const width = colOffsets[col] - absLeft
            if (width <= 0) continue
            const left = absLeft - colOffset
            const remoteEditor = remoteEditingByCell.get(`${row}:${col}`) ?? null
            cells.push(
                <Cell
                    key={`${row}:${col}`}
                    sheetId={sheetId}
                    row={row}
                    col={col}
                    left={left}
                    top={top}
                    width={width}
                    height={height}
                    readOnly={readOnly}
                    cellEditorInputRef={cellEditorInputRef}
                    remoteEditor={remoteEditor}
                    onSpecialKey={onSpecialKey}
                    colOffsets={colOffsets}
                    rowOffsets={rowOffsets}
                />
            )
        }
    }
    return cells
}

// Overlays in the bottom-right quadrant use absolute prefix-sum offsets
// minus the frozen extent so their cell-coordinate inputs match the
// quadrant's local coordinate space. Two cached arrays per render are
// cheap; recreating means overlays don't accidentally hold stale
// references when the sheet's widths change.
function shiftedColOffsets(colOffsets: Float64Array, frozenCols: number): Float64Array {
    if (frozenCols <= 0) return colOffsets
    const shift = colOffsets[frozenCols] ?? 0
    const out = new Float64Array(colOffsets.length)
    for (let i = 0; i < colOffsets.length; i++) {
        out[i] = colOffsets[i] - shift
    }
    return out
}

function shiftedRowOffsets(rowOffsets: Float64Array, frozenRows: number): Float64Array {
    if (frozenRows <= 0) return rowOffsets
    const shift = rowOffsets[frozenRows] ?? 0
    const out = new Float64Array(rowOffsets.length)
    for (let i = 0; i < rowOffsets.length; i++) {
        out[i] = rowOffsets[i] - shift
    }
    return out
}
