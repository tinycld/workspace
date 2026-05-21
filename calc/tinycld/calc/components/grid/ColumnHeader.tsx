import { useRef } from 'react'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { FilterX } from 'lucide-react-native'
import {
    type GestureResponderEvent,
    Platform,
    Pressable,
    ScrollView,
    Text,
    View,
} from 'react-native'
import {
    type DragState,
    HANDLE_VISUAL_WIDTH,
    NATIVE_HANDLE_HIT_SLOP,
} from '../../hooks/use-column-resize'
import type { GridStoreApi } from '../../hooks/grid-store'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import { primaryAnchor } from '../../lib/selection-range'
import { columnLabel } from '../../lib/workbook-types'
import { ACTIVE_HEADER_INSET_STYLE, HEADER_HEIGHT } from './constants'

interface ColumnHeaderProps {
    scrollRef: React.RefObject<ScrollView | null>
    contentWidth: number
    colOffsets: Float64Array
    firstCol: number
    lastCol: number
    // Number of rows in the sheet — used by selectColumn to size the
    // selection range to span the whole column. Passed in (rather than
    // read here) because the header is dimensions-agnostic; Grid
    // already has the canonical value. Mirror of RowHeader's colCount.
    rowCount: number
    // When > 0, the first `frozenCols` column headers render in a
    // non-scrolling section before the scrollable section. Each
    // section has its own offset baseline (frozen cols use absolute
    // colOffsets; scrollable cols subtract the frozen extent so they
    // line up with the body's bottom-right quadrant).
    frozenCols: number
    makeHandleProps: (col: number) => Record<string, unknown>
    dragState: DragState | null
    // Range covered by the active filter view (null when no filter is
    // set). Retained for semantics even though the per-column affordance
    // is now driven by `filterMode` + `activeFilterCols`.
    filterRange: { startCol: number; endCol: number } | null
    // Set of column indexes that have an active criterion. Header-mode
    // filters render a clear ✕ icon on columns in this set.
    activeFilterCols: ReadonlySet<number>
    // Active filter mode (null when no filter is active). Drives the
    // per-column affordance: `range` shows nothing, `header` shows a
    // clear ✕ on columns with an active criterion.
    filterMode: 'range' | 'header' | null
    // Callback to remove the criterion for a single column (header-mode
    // only). Wired to the ✕ press.
    onRemoveColumnCriterion: (col: number) => void
}

export function ColumnHeader({
    scrollRef,
    contentWidth,
    colOffsets,
    firstCol,
    lastCol,
    rowCount,
    frozenCols,
    makeHandleProps,
    dragState,
    filterRange,
    activeFilterCols,
    filterMode,
    onRemoveColumnCriterion,
}: ColumnHeaderProps) {
    const borderColor = useThemeColor('border')
    const activeCol = useGridStore(s => primaryAnchor(s.selection)?.col ?? null)
    // Mirror of RowHeader: bolden the column label when the user
    // selected the WHOLE column (any sub-range with scope='column'
    // anchored at this col). Disjoint column selections light up
    // every selected column header, matching Sheets.
    const colScopeActive = useGridStore(s => {
        if (s.selection == null) return false
        if (activeCol == null) return false
        for (const sr of s.selection.ranges) {
            if (sr.scope === 'column' && sr.anchor.col === activeCol) return true
        }
        return false
    })
    const store = useGridStoreApi()
    const accent = useThemeColor('accent')
    // Skip the synthetic onPress after a modifier mousedown.
    // preventDefault on mousedown blocks the focus shift but NOT the
    // synthetic click on web, so without this gate a Ctrl-click would
    // land on the Pressable.onPress that calls selectColumn and
    // collapse the disjoint selection.
    const skipNextPressRef = useRef(false)

    const cols = colOffsets.length - 1
    const fCols = Math.min(Math.max(0, frozenCols), cols)
    const frozenW = fCols > 0 ? colOffsets[fCols] : 0
    const scrollableContentWidth = Math.max(0, contentWidth - frozenW)
    const scrollableFirstCol = Math.max(firstCol, fCols + 1)

    const filterCtx: HeaderFilterCtx = {
        filterRange,
        activeFilterCols,
        filterMode,
        onRemoveColumnCriterion,
        store,
        accent,
        skipNextPressRef,
    }

    const frozenCells: React.ReactNode[] = []
    if (fCols > 0) {
        appendHeaderCells(
            frozenCells,
            colOffsets,
            1,
            fCols,
            0,
            activeCol,
            colScopeActive,
            rowCount,
            makeHandleProps,
            dragState,
            filterCtx
        )
    }
    const scrollableCells: React.ReactNode[] = []
    appendHeaderCells(
        scrollableCells,
        colOffsets,
        scrollableFirstCol,
        lastCol,
        frozenW,
        activeCol,
        colScopeActive,
        rowCount,
        makeHandleProps,
        dragState,
        filterCtx
    )

    // No-freeze layout: keep the original single-ScrollView shape so a
    // sheet without freeze is byte-identical to the pre-freeze version.
    if (fCols <= 0) {
        return (
            <View style={{ flex: 1, height: HEADER_HEIGHT, overflow: 'hidden' }}>
                <ScrollView
                    ref={scrollRef}
                    horizontal
                    scrollEnabled={false}
                    showsHorizontalScrollIndicator={false}
                    style={{ height: HEADER_HEIGHT }}
                    contentContainerStyle={{
                        width: scrollableContentWidth,
                        height: HEADER_HEIGHT,
                    }}
                >
                    {scrollableCells}
                </ScrollView>
            </View>
        )
    }

    return (
        <View
            style={{ flex: 1, flexDirection: 'row', height: HEADER_HEIGHT, overflow: 'hidden' }}
        >
            <View
                style={{
                    width: frozenW,
                    height: HEADER_HEIGHT,
                    overflow: 'hidden',
                    borderRightWidth: 2,
                    borderRightColor: borderColor,
                }}
            >
                {frozenCells}
            </View>
            <View style={{ flex: 1, height: HEADER_HEIGHT, overflow: 'hidden' }}>
                <ScrollView
                    ref={scrollRef}
                    horizontal
                    scrollEnabled={false}
                    showsHorizontalScrollIndicator={false}
                    style={{ height: HEADER_HEIGHT }}
                    contentContainerStyle={{
                        width: scrollableContentWidth,
                        height: HEADER_HEIGHT,
                    }}
                >
                    {scrollableCells}
                </ScrollView>
            </View>
        </View>
    )
}

interface HeaderFilterCtx {
    filterRange: { startCol: number; endCol: number } | null
    activeFilterCols: ReadonlySet<number>
    filterMode: 'range' | 'header' | null
    onRemoveColumnCriterion: (col: number) => void
    store: GridStoreApi
    accent: string
    skipNextPressRef: React.MutableRefObject<boolean>
}

// appendHeaderCells emits one column-header label cell + one resize
// handle per visible column in [first..last], with each cell's `left`
// shifted by `xShift` (0 for the frozen section, frozenW for the
// scrollable section so its content origin lines up with the body's
// bottom-right quadrant ScrollView).
function appendHeaderCells(
    out: React.ReactNode[],
    colOffsets: Float64Array,
    first: number,
    last: number,
    xShift: number,
    activeCol: number | null,
    colScopeActive: boolean,
    rowCount: number,
    makeHandleProps: (col: number) => Record<string, unknown>,
    dragState: DragState | null,
    filter: HeaderFilterCtx
): void {
    for (let col = first; col <= last; col++) {
        const isActive = col === activeCol
        const isColScope = colScopeActive && isActive
        const absLeft = colOffsets[col - 1]
        const width = colOffsets[col] - absLeft
        const left = absLeft - xShift
        // Hidden columns (width 0 from a drag-to-zero) still need to
        // occupy zero pixels of layout space — render nothing rather
        // than a 0×H view to keep the DOM lean.
        if (width > 0) {
            const hasActiveCriterion = filter.activeFilterCols.has(col)
            const showClearIcon = filter.filterMode === 'header' && hasActiveCriterion
            // Web modifier-aware mousedown: Ctrl/Cmd-click appends a
            // column-scope sub-range (Sheets-parity disjoint
            // selection); Shift-click extends the active column-
            // scope sub-range; plain click replaces the selection.
            //
            // We wire on mousedown — not Pressable.onPress — because
            // RN's GestureResponderEvent doesn't expose modifier
            // keys. preventDefault on mousedown blocks the focus
            // shift; the synthetic click that still fires after
            // mouseup re-runs onPress, so we use a skipNext gate via
            // an action that the followup onPress just no-ops on
            // by virtue of being idempotent (selectColumn with the
            // same modifier-less semantics).
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
                                  filter.skipNextPressRef.current = true
                                  filter.store
                                      .getState()
                                      .addColumnSubRange(col, rowCount)
                                  return
                              }
                              if (e.shiftKey && !isCtrl) {
                                  e.preventDefault()
                                  filter.skipNextPressRef.current = true
                                  filter.store
                                      .getState()
                                      .extendActiveColumnTo(col, rowCount)
                                  return
                              }
                              if (isCtrl && e.shiftKey) {
                                  // Ctrl+Shift-click adds a new range
                                  // (most-recent additive gesture
                                  // wins; documented in plan §5).
                                  e.preventDefault()
                                  filter.skipNextPressRef.current = true
                                  filter.store
                                      .getState()
                                      .addColumnSubRange(col, rowCount)
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
                              filter.store
                                  .getState()
                                  .openHeaderMenu('col', col, rowCount, e.clientX, e.clientY)
                          },
                      }
                    : null
            const onPlainPress = () => {
                if (filter.skipNextPressRef.current) {
                    filter.skipNextPressRef.current = false
                    return
                }
                filter.store.getState().selectColumn(col, rowCount)
            }
            const onLongPress = (e: GestureResponderEvent) => {
                const { pageX, pageY } = e.nativeEvent
                filter.store.getState().openHeaderMenu('col', col, rowCount, pageX, pageY)
            }
            out.push(
                <Pressable
                    key={`h-${col}`}
                    onPress={onPlainPress}
                    onLongPress={onLongPress}
                    accessibilityLabel={`Select column ${columnLabel(col)}`}
                    className={`border-r border-b border-border flex-row items-center justify-center ${
                        isActive ? 'bg-accent' : 'bg-surface-secondary'
                    }`}
                    style={{
                        position: 'absolute',
                        left,
                        top: 0,
                        width,
                        height: HEADER_HEIGHT,
                        ...(isActive ? ACTIVE_HEADER_INSET_STYLE : null),
                    }}
                    // biome-ignore lint/suspicious/noExplicitAny: web-only DOM event prop on RN Pressable
                    {...((webMouseDownProp ?? {}) as any)}
                >
                    <Text
                        className={`text-xs ${isActive ? 'text-accent-foreground' : 'text-muted-foreground'}`}
                        style={isActive || isColScope ? { fontWeight: 'bold' } : undefined}
                    >
                        {columnLabel(col)}
                    </Text>
                    {showClearIcon ? (
                        <Pressable
                            // The clear icon sits inside the column-select
                            // Pressable; stop the press so clearing the
                            // criterion doesn't also collapse selection
                            // onto the whole column.
                            onPress={e => {
                                e.stopPropagation()
                                filter.onRemoveColumnCriterion(col)
                            }}
                            accessibilityLabel={`Clear filter on column ${columnLabel(col)}`}
                            accessibilityRole="button"
                            style={{
                                marginLeft: 4,
                                paddingHorizontal: 2,
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <FilterX size={12} color={filter.accent} />
                        </Pressable>
                    ) : null}
                </Pressable>
            )
        }
        // Resize handle straddles the right boundary of column `col`.
        // Position it at left+width-half so it visually sits ON the
        // boundary line. On native we also enlarge the touchable
        // area beyond the visible 6px stripe via hitSlop equivalent
        // (a wider transparent View extending into both columns).
        const handleX = left + width - HANDLE_VISUAL_WIDTH / 2
        const isDraggingThis = dragState?.col === col
        out.push(
            <View
                key={`g-${col}`}
                {...makeHandleProps(col)}
                style={
                    {
                        position: 'absolute',
                        left: handleX - (Platform.OS === 'web' ? 0 : NATIVE_HANDLE_HIT_SLOP),
                        top: 0,
                        width:
                            HANDLE_VISUAL_WIDTH +
                            (Platform.OS === 'web' ? 0 : NATIVE_HANDLE_HIT_SLOP * 2),
                        height: HEADER_HEIGHT,
                        zIndex: 2,
                        // Web-only cursor affordance. RN-Web compiles
                        // unrecognized style keys to inline CSS, so this
                        // forwards through. Native doesn't have a cursor
                        // concept; the wider hit slop is the affordance.
                        cursor: 'col-resize',
                        // Subtle visible bar centered on the handle so the
                        // grab target is discoverable on hover; flat (no
                        // border) when not dragged so it doesn't compete
                        // with the column-divider line that's already
                        // there.
                        backgroundColor: isDraggingThis ? '#22a06b' : 'transparent',
                        // biome-ignore lint/suspicious/noExplicitAny: web-only cursor key on RN ViewStyle
                    } as any
                }
            />
        )
    }
}
