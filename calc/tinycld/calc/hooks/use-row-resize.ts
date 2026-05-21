// Row-resize gesture handling for the calc grid.
//
// Mirror of use-column-resize.ts with the axis swapped. Two platforms,
// two pointer paradigms:
//   - Web uses DOM pointer events with setPointerCapture so the drag
//     keeps tracking even when the cursor leaves the 6px handle.
//   - Native uses PanResponder for the same reason — it's a
//     zero-additional-dep way to capture a touch and stream
//     translationY.
//
// The hook owns no Y.Doc state; it reports drag state up to the Grid
// (which renders the preview line) and writes through `onCommit` only
// once at gesture end. That's the tombstone-avoidance contract — see
// y-doc-bootstrap.ts.
import { useCallback, useMemo, useRef, useState } from 'react'
import { type GestureResponderEvent, PanResponder, Platform } from 'react-native'
import {
    clampRowHeight,
    DEFAULT_ROW_HEIGHT,
    type RowHeights,
    readRowHeight,
} from '../lib/dimensions'

// RowDragState describes the in-progress resize. `currentHeight` is the
// height to render for the dragged row (and to draw the preview line
// at). It's local-only; never written to the Y.Doc until release.
export interface RowDragState {
    row: number
    startHeight: number
    currentHeight: number
}

export const ROW_HANDLE_VISUAL_HEIGHT = 6
export const NATIVE_ROW_HANDLE_HIT_SLOP = 8

const DOUBLE_CLICK_MS = 300

export interface RowResizeOptions {
    rowHeights: RowHeights | undefined
    readOnly: boolean
    onCommit: (row: number, height: number) => void
    onResetDefault: (row: number) => void
    onRequestMenu?: (row: number, x: number, y: number) => void
}

interface WebPointerEvent {
    pointerId: number
    clientY: number
    preventDefault: () => void
    stopPropagation: () => void
    currentTarget: {
        setPointerCapture: (id: number) => void
        releasePointerCapture: (id: number) => void
    }
}

export interface RowResizeHandlers {
    dragState: RowDragState | null
    makeHandleProps: (row: number) => Record<string, unknown>
}

export function useRowResize({
    rowHeights,
    readOnly,
    onCommit,
    onResetDefault,
    onRequestMenu,
}: RowResizeOptions): RowResizeHandlers {
    const [dragState, setDragState] = useState<RowDragState | null>(null)

    const dragRef = useRef<RowDragState | null>(null)
    dragRef.current = dragState

    const rowHeightsRef = useRef(rowHeights)
    rowHeightsRef.current = rowHeights

    const lastClickRef = useRef<Map<number, number>>(new Map())

    const beginDrag = useCallback(
        (row: number) => {
            if (readOnly) return
            const startHeight = readRowHeight(rowHeightsRef.current, row)
            const next: RowDragState = { row, startHeight, currentHeight: startHeight }
            dragRef.current = next
            setDragState(next)
        },
        [readOnly]
    )

    const updateDrag = useCallback((deltaY: number) => {
        const cur = dragRef.current
        if (cur == null) return
        const proposed = clampRowHeight(cur.startHeight + deltaY)
        if (proposed === cur.currentHeight) return
        const next: RowDragState = { ...cur, currentHeight: proposed }
        dragRef.current = next
        setDragState(next)
    }, [])

    const endDrag = useCallback(() => {
        const cur = dragRef.current
        dragRef.current = null
        setDragState(null)
        if (cur == null) return
        if (cur.currentHeight === cur.startHeight) return
        onCommit(cur.row, cur.currentHeight)
    }, [onCommit])

    const cancelDrag = useCallback(() => {
        dragRef.current = null
        setDragState(null)
    }, [])

    const webStartYRef = useRef<number>(0)

    const makeWebProps = useCallback(
        (row: number): Record<string, unknown> => {
            if (readOnly) return {}
            return {
                onPointerDown: (e: WebPointerEvent) => {
                    e.preventDefault()
                    e.stopPropagation()
                    e.currentTarget.setPointerCapture(e.pointerId)
                    webStartYRef.current = e.clientY
                    beginDrag(row)
                },
                onPointerMove: (e: WebPointerEvent) => {
                    if (dragRef.current == null) return
                    updateDrag(e.clientY - webStartYRef.current)
                },
                onPointerUp: (e: WebPointerEvent) => {
                    if (dragRef.current == null) return
                    e.currentTarget.releasePointerCapture(e.pointerId)
                    endDrag()
                },
                onPointerCancel: () => {
                    cancelDrag()
                },
                onClick: (e: { detail?: number; preventDefault?: () => void }) => {
                    e.preventDefault?.()
                    const now = Date.now()
                    const prev = lastClickRef.current.get(row) ?? 0
                    lastClickRef.current.set(row, now)
                    if ((e.detail ?? 0) >= 2 || now - prev < DOUBLE_CLICK_MS) {
                        lastClickRef.current.delete(row)
                        onResetDefault(row)
                    }
                },
                onContextMenu: (e: {
                    preventDefault: () => void
                    stopPropagation: () => void
                    clientX: number
                    clientY: number
                }) => {
                    if (onRequestMenu == null) return
                    e.preventDefault()
                    e.stopPropagation()
                    onRequestMenu(row, e.clientX, e.clientY)
                },
            }
        },
        [readOnly, beginDrag, updateDrag, endDrag, cancelDrag, onResetDefault, onRequestMenu]
    )

    const panResponderCacheRef = useRef<Map<number, ReturnType<typeof PanResponder.create>>>(
        new Map()
    )

    const makeNativeProps = useCallback(
        (row: number): Record<string, unknown> => {
            if (readOnly) return {}
            const cache = panResponderCacheRef.current
            let responder = cache.get(row)
            if (responder == null) {
                responder = PanResponder.create({
                    onStartShouldSetPanResponder: () => true,
                    onStartShouldSetPanResponderCapture: () => true,
                    onMoveShouldSetPanResponder: () => true,
                    onMoveShouldSetPanResponderCapture: () => true,
                    onPanResponderGrant: (_e: GestureResponderEvent) => {
                        beginDrag(row)
                    },
                    onPanResponderMove: (_e: GestureResponderEvent, g: { dy: number }) => {
                        updateDrag(g.dy)
                    },
                    onPanResponderRelease: () => {
                        endDrag()
                    },
                    onPanResponderTerminate: () => {
                        cancelDrag()
                    },
                })
                cache.set(row, responder)
            }
            return responder.panHandlers as unknown as Record<string, unknown>
        },
        [readOnly, beginDrag, updateDrag, endDrag, cancelDrag]
    )

    const makeHandleProps = useCallback(
        (row: number): Record<string, unknown> => {
            if (Platform.OS === 'web') return makeWebProps(row)
            return makeNativeProps(row)
        },
        [makeWebProps, makeNativeProps]
    )

    return useMemo(() => ({ dragState, makeHandleProps }), [dragState, makeHandleProps])
}

export { DEFAULT_ROW_HEIGHT }
