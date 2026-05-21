import { useRef } from 'react'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import {
    type GestureResponderEvent,
    Platform,
    Pressable,
    ScrollView,
    Text,
    View,
} from 'react-native'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import {
    NATIVE_ROW_HANDLE_HIT_SLOP,
    ROW_HANDLE_VISUAL_HEIGHT,
    type RowDragState,
} from '../../hooks/use-row-resize'
import { primaryAnchor } from '../../lib/selection-range'
import { ACTIVE_HEADER_INSET_STYLE, ROW_HEADER_WIDTH } from './constants'

interface RowHeaderProps {
    scrollRef: React.RefObject<ScrollView | null>
    contentHeight: number
    rowOffsets: Float64Array
    firstRow: number
    lastRow: number
    // Number of columns in the sheet — used by selectRow to size the
    // selection range to span the whole row. Passed in (rather than
    // read here) because the header is dimensions-agnostic; Grid
    // already has the canonical value.
    colCount: number
    // When > 0, the first `frozenRows` row labels render in a
    // non-scrolling section above the scrollable section. Mirror of
    // ColumnHeader's frozen-cols handling.
    frozenRows: number
    makeHandleProps: (row: number) => Record<string, unknown>
    dragState: RowDragState | null
}

export function RowHeader({
    scrollRef,
    contentHeight,
    rowOffsets,
    firstRow,
    lastRow,
    colCount,
    frozenRows,
    makeHandleProps,
    dragState,
}: RowHeaderProps) {
    const borderColor = useThemeColor('border')
    const activeRow = useGridStore(s => primaryAnchor(s.selection)?.row ?? null)
    // Highlight the row label more strongly when the user has selected
    // the WHOLE row (any sub-range with scope='row' anchored at this
    // row). Disjoint row selections light up every selected row
    // header, matching Sheets.
    const rowScopeActive = useGridStore(s => {
        if (s.selection == null) return false
        if (activeRow == null) return false
        for (const sr of s.selection.ranges) {
            if (sr.scope === 'row' && sr.anchor.row === activeRow) return true
        }
        return false
    })
    const store = useGridStoreApi()
    // Skip the synthetic onPress after a modifier mousedown — see the
    // matching ref in ColumnHeader.tsx for the rationale.
    const skipNextPressRef = useRef(false)

    const rows = rowOffsets.length - 1
    const fRows = Math.min(Math.max(0, frozenRows), rows)
    const frozenH = fRows > 0 ? rowOffsets[fRows] : 0
    const scrollableContentHeight = Math.max(0, contentHeight - frozenH)
    const scrollableFirstRow = Math.max(firstRow, fRows + 1)

    const frozenCells: React.ReactNode[] = []
    if (fRows > 0) {
        appendRowHeaderCells(
            frozenCells,
            rowOffsets,
            1,
            fRows,
            0,
            activeRow,
            rowScopeActive,
            store,
            colCount,
            makeHandleProps,
            dragState,
            skipNextPressRef
        )
    }
    const scrollableCells: React.ReactNode[] = []
    appendRowHeaderCells(
        scrollableCells,
        rowOffsets,
        scrollableFirstRow,
        lastRow,
        frozenH,
        activeRow,
        rowScopeActive,
        store,
        colCount,
        makeHandleProps,
        dragState,
        skipNextPressRef
    )

    if (fRows <= 0) {
        return (
            <View style={{ width: ROW_HEADER_WIDTH, overflow: 'hidden' }}>
                <ScrollView
                    ref={scrollRef}
                    scrollEnabled={false}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{
                        width: ROW_HEADER_WIDTH,
                        height: scrollableContentHeight,
                    }}
                >
                    {scrollableCells}
                </ScrollView>
            </View>
        )
    }

    return (
        <View style={{ width: ROW_HEADER_WIDTH, overflow: 'hidden' }}>
            <View
                style={{
                    width: ROW_HEADER_WIDTH,
                    height: frozenH,
                    overflow: 'hidden',
                    borderBottomWidth: 2,
                    borderBottomColor: borderColor,
                }}
            >
                {frozenCells}
            </View>
            <View style={{ flex: 1, overflow: 'hidden' }}>
                <ScrollView
                    ref={scrollRef}
                    scrollEnabled={false}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{
                        width: ROW_HEADER_WIDTH,
                        height: scrollableContentHeight,
                    }}
                >
                    {scrollableCells}
                </ScrollView>
            </View>
        </View>
    )
}

// appendRowHeaderCells emits one row-header label cell + one resize
// handle per visible row in [first..last], with each cell's `top`
// shifted by `yShift` (0 for the frozen section, frozenH for the
// scrollable section so its content origin lines up with the body's
// bottom-right quadrant ScrollView).
function appendRowHeaderCells(
    out: React.ReactNode[],
    rowOffsets: Float64Array,
    first: number,
    last: number,
    yShift: number,
    activeRow: number | null,
    rowScopeActive: boolean,
    store: ReturnType<typeof useGridStoreApi>,
    colCount: number,
    makeHandleProps: (row: number) => Record<string, unknown>,
    dragState: RowDragState | null,
    skipNextPressRef: React.MutableRefObject<boolean>
): void {
    for (let row = first; row <= last; row++) {
        const isActive = row === activeRow
        const isRowScope = rowScopeActive && isActive
        const absTop = rowOffsets[row - 1]
        const height = rowOffsets[row] - absTop
        const top = absTop - yShift
        // Hidden rows (height 0 from a drag-to-zero) still need to
        // occupy zero pixels of layout space — render nothing rather
        // than a W×0 view to keep the DOM lean.
        if (height > 0) {
            const webMouseDownProp =
                Platform.OS === 'web'
                    ? {
                          onMouseDown: (e: {
                              preventDefault: () => void
                              button?: number
                              shiftKey?: boolean
                              ctrlKey?: boolean
                              metaKey?: boolean
                          }) => {
                              if (e.button != null && e.button !== 0) return
                              const isCtrl = e.ctrlKey || e.metaKey
                              if (isCtrl && !e.shiftKey) {
                                  e.preventDefault()
                                  skipNextPressRef.current = true
                                  store.getState().addRowSubRange(row, colCount)
                                  return
                              }
                              if (e.shiftKey && !isCtrl) {
                                  e.preventDefault()
                                  skipNextPressRef.current = true
                                  store.getState().extendActiveRowTo(row, colCount)
                                  return
                              }
                              if (isCtrl && e.shiftKey) {
                                  e.preventDefault()
                                  skipNextPressRef.current = true
                                  store.getState().addRowSubRange(row, colCount)
                              }
                          },
                          onContextMenu: (e: {
                              preventDefault: () => void
                              stopPropagation: () => void
                              clientX: number
                              clientY: number
                          }) => {
                              e.preventDefault()
                              e.stopPropagation()
                              store
                                  .getState()
                                  .openHeaderMenu('row', row, colCount, e.clientX, e.clientY)
                          },
                      }
                    : null
            const onPlainPress = () => {
                if (skipNextPressRef.current) {
                    skipNextPressRef.current = false
                    return
                }
                store.getState().selectRow(row, colCount)
            }
            const onLongPress = (e: GestureResponderEvent) => {
                const { pageX, pageY } = e.nativeEvent
                store.getState().openHeaderMenu('row', row, colCount, pageX, pageY)
            }
            out.push(
                <Pressable
                    key={`h-${row}`}
                    onPress={onPlainPress}
                    onLongPress={onLongPress}
                    accessibilityLabel={`Select row ${row}`}
                    className={`border-r border-b border-border items-center justify-center ${
                        isActive ? 'bg-accent' : 'bg-surface-secondary'
                    }`}
                    style={{
                        position: 'absolute',
                        left: 0,
                        top,
                        width: ROW_HEADER_WIDTH,
                        height,
                        ...(isActive ? ACTIVE_HEADER_INSET_STYLE : null),
                    }}
                    // biome-ignore lint/suspicious/noExplicitAny: web-only DOM event prop on RN Pressable
                    {...((webMouseDownProp ?? {}) as any)}
                >
                    <Text
                        className={`text-xs ${isActive ? 'text-accent-foreground' : 'text-muted-foreground'}`}
                        style={isActive || isRowScope ? { fontWeight: 'bold' } : undefined}
                    >
                        {row}
                    </Text>
                </Pressable>
            )
        }
        // Resize handle straddles the bottom boundary of row `row`.
        // Mirror of ColumnHeader: the visible 6px stripe sits ON the
        // boundary, with extra hit slop on native.
        const handleY = top + height - ROW_HANDLE_VISUAL_HEIGHT / 2
        const isDraggingThis = dragState?.row === row
        out.push(
            <View
                key={`g-${row}`}
                {...makeHandleProps(row)}
                style={
                    {
                        position: 'absolute',
                        left: 0,
                        top: handleY - (Platform.OS === 'web' ? 0 : NATIVE_ROW_HANDLE_HIT_SLOP),
                        width: ROW_HEADER_WIDTH,
                        height:
                            ROW_HANDLE_VISUAL_HEIGHT +
                            (Platform.OS === 'web' ? 0 : NATIVE_ROW_HANDLE_HIT_SLOP * 2),
                        zIndex: 2,
                        cursor: 'row-resize',
                        backgroundColor: isDraggingThis ? '#22a06b' : 'transparent',
                        // biome-ignore lint/suspicious/noExplicitAny: web-only cursor key on RN ViewStyle
                    } as any
                }
            />
        )
    }
}
