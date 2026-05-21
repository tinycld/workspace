import { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type {
    LayoutChangeEvent,
    NativeScrollEvent,
    NativeSyntheticEvent,
    ScrollView,
} from 'react-native'
import { OVERSCAN } from '../../components/grid/constants'
import {
    firstColAtOffset,
    firstRowAtOffset,
    lastColAtOffset,
    lastRowAtOffset,
} from '../../lib/dimensions'

export interface GridViewportHandle {
    scrollToCell: (row: number, col: number) => void
}

export interface GridVisibleWindow {
    firstRow: number
    lastRow: number
    firstCol: number
    lastCol: number
}

export interface GridViewport {
    visible: GridVisibleWindow
    scrollX: number
    scrollY: number
    horizontalRef: React.RefObject<ScrollView | null>
    verticalRef: React.RefObject<ScrollView | null>
    headerScrollRef: React.RefObject<ScrollView | null>
    leftColumnScrollRef: React.RefObject<ScrollView | null>
    // Freeze-pane mirror refs. `frozenRowHorizontalRef` is the
    // horizontal-only ScrollView that holds the top-right quadrant
    // (frozen rows × free cols); `frozenColVerticalRef` holds the
    // bottom-left quadrant (free rows × frozen cols). Both stay null
    // when no freeze is active; callers tolerate the null target on
    // scrollTo (it's a no-op).
    frozenRowHorizontalRef: React.RefObject<ScrollView | null>
    frozenColVerticalRef: React.RefObject<ScrollView | null>
    onHorizontalScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
    onVerticalScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
    onBodyLayout: (e: LayoutChangeEvent) => void
}

interface ViewportState {
    scrollX: number
    scrollY: number
    width: number
    height: number
}

interface UseGridViewportArgs {
    rows: number
    cols: number
    colOffsets: Float64Array
    rowOffsets: Float64Array
    handleRef: React.ForwardedRef<GridViewportHandle>
    // Number of rows/columns frozen at the top/left. The bottom-right
    // quadrant's visible window starts past the frozen extent; the
    // viewport memo shifts the binary-search lower bound so the user
    // can never scroll an unfrozen cell off-screen *behind* the
    // frozen quadrant.
    frozenRows?: number
    frozenCols?: number
}

// useGridViewport owns the four ScrollView refs, the merged
// scrollX/scrollY/width/height state, the visible-window memo, and
// all three scroll/layout event handlers. It also exposes the
// imperative scrollToCell handle.
//
// Kept as plain useState (not in the Zustand store) because cells
// don't subscribe to viewport state — they receive computed
// `left`/`width`/`top`/`height` as props. Putting viewport state in
// the store would force every cell selector to re-run on every scroll
// tick.
export function useGridViewport({
    rows,
    cols,
    colOffsets,
    rowOffsets,
    handleRef,
    frozenRows = 0,
    frozenCols = 0,
}: UseGridViewportArgs): GridViewport {
    const [viewport, setViewport] = useState<ViewportState>({
        scrollX: 0,
        scrollY: 0,
        width: 0,
        height: 0,
    })

    const horizontalRef = useRef<ScrollView>(null)
    const verticalRef = useRef<ScrollView>(null)
    const headerScrollRef = useRef<ScrollView>(null)
    const leftColumnScrollRef = useRef<ScrollView>(null)
    const frozenRowHorizontalRef = useRef<ScrollView>(null)
    const frozenColVerticalRef = useRef<ScrollView>(null)

    useImperativeHandle(
        handleRef,
        () => ({
            scrollToCell: (row: number, col: number) => {
                const x = colOffsets[Math.max(0, col - 1)] ?? 0
                const y = rowOffsets[Math.max(0, row - 1)] ?? 0
                horizontalRef.current?.scrollTo({ x, animated: true })
                verticalRef.current?.scrollTo({ y, animated: true })
            },
        }),
        [colOffsets, rowOffsets]
    )

    const visible = useMemo<GridVisibleWindow>(() => {
        if (viewport.width === 0 || viewport.height === 0) {
            return { firstRow: 1, lastRow: 0, firstCol: 1, lastCol: 0 }
        }
        // Variable-height rows and variable-width columns: binary
        // search the prefix sums for the first/last visible index on
        // each axis. Overscan is applied as a count, not a pixel
        // padding — the visible window only needs to extend slightly
        // past the viewport so newly scrolled-in cells render before
        // they're seen.
        //
        // Freeze panes: the bottom-right quadrant's scroll offset is
        // measured from the start of its content (i.e. row
        // frozenRows+1, col frozenCols+1 sits at content offset 0 in
        // that quadrant). Translate scrollX/Y back into the absolute
        // prefix-sum coordinate by adding the frozen extent. The
        // visible window then reports absolute row/col indices the
        // body iterates against, with the bottom-right cells filtered
        // by the quadrant renderer.
        const frozenW = frozenCols > 0 ? colOffsets[frozenCols] : 0
        const frozenH = frozenRows > 0 ? rowOffsets[frozenRows] : 0
        const yTop = viewport.scrollY + frozenH
        const yBottom = viewport.scrollY + frozenH + viewport.height
        const xLeft = viewport.scrollX + frozenW
        const xRight = viewport.scrollX + frozenW + viewport.width
        const rawFirstRow = firstRowAtOffset(rowOffsets, yTop)
        const rawLastRow = lastRowAtOffset(rowOffsets, yBottom)
        const firstRow = Math.max(1, rawFirstRow - OVERSCAN)
        const lastRow = Math.min(rows, rawLastRow + OVERSCAN)
        const rawFirstCol = firstColAtOffset(colOffsets, xLeft)
        const rawLastCol = lastColAtOffset(colOffsets, xRight)
        const firstCol = Math.max(1, rawFirstCol - OVERSCAN)
        const lastCol = Math.min(cols, rawLastCol + OVERSCAN)
        return { firstRow, lastRow, firstCol, lastCol }
    }, [viewport, rows, cols, colOffsets, rowOffsets, frozenRows, frozenCols])

    const onHorizontalScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const x = e.nativeEvent.contentOffset.x
        setViewport(v => (v.scrollX === x ? v : { ...v, scrollX: x }))
        // Mirror to the column header so it stays aligned with the body.
        // Using a ref + scrollTo (rather than absolute-positioning the
        // header inside the body's content) keeps the header in its own
        // sticky region so it doesn't get clipped by row windowing.
        headerScrollRef.current?.scrollTo({ x, animated: false })
        // Also mirror to the top-right quadrant when freeze is active so
        // the frozen rows track the body's horizontal scroll.
        frozenRowHorizontalRef.current?.scrollTo({ x, animated: false })
    }, [])

    const onVerticalScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const y = e.nativeEvent.contentOffset.y
        setViewport(v => (v.scrollY === y ? v : { ...v, scrollY: y }))
        leftColumnScrollRef.current?.scrollTo({ y, animated: false })
        // Mirror to the bottom-left quadrant so frozen columns track
        // the body's vertical scroll.
        frozenColVerticalRef.current?.scrollTo({ y, animated: false })
    }, [])

    const onBodyLayout = useCallback((e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout
        setViewport(v => (v.width === width && v.height === height ? v : { ...v, width, height }))
    }, [])

    return {
        visible,
        scrollX: viewport.scrollX,
        scrollY: viewport.scrollY,
        horizontalRef,
        verticalRef,
        headerScrollRef,
        leftColumnScrollRef,
        frozenRowHorizontalRef,
        frozenColVerticalRef,
        onHorizontalScroll,
        onVerticalScroll,
        onBodyLayout,
    }
}
