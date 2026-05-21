// Column-resize gesture handling for the calc grid.
//
// Two platforms, two pointer paradigms:
//   - Web uses DOM pointer events with setPointerCapture so the drag
//     keeps tracking even when the cursor leaves the 6px handle.
//   - Native uses PanResponder for the same reason — it's a
//     zero-additional-dep way to capture a touch and stream
//     translationX. react-native-gesture-handler would be marginally
//     smoother but isn't required for a draft-then-commit gesture.
//
// The hook owns no Y.Doc state; it reports drag state up to the Grid
// (which renders the preview line) and writes through `onCommit` only
// once at gesture end. That's the tombstone-avoidance contract — see
// y-doc-bootstrap.ts.
import { useCallback, useMemo, useRef, useState } from 'react'
import { type GestureResponderEvent, PanResponder, Platform } from 'react-native'
import type * as Y from 'yjs'
import {
    AUTOSIZE_PADDING,
    autosizeColumnWidth,
    type ColWidths,
    clampColWidth,
    DEFAULT_COL_WIDTH,
    readColWidth,
} from '../lib/dimensions'

// DragState describes the in-progress resize. `currentWidth` is the
// width to render for the dragged column (and to draw the preview line
// at). It's local-only; never written to the Y.Doc until release.
export interface DragState {
    col: number
    startWidth: number
    currentWidth: number
}

// HANDLE_HIT_SLOP enlarges the touch target around the visible 6px
// handle so a finger has a reasonable chance of grabbing it on native.
// On web the cursor:col-resize affordance carries the discoverability,
// so we keep the visible handle narrow and rely on the pointer for
// precision.
export const HANDLE_VISUAL_WIDTH = 6
export const NATIVE_HANDLE_HIT_SLOP = 8

// Time within which two clicks on the same handle count as a
// double-click, in ms. Standard browser default is 500; 300 feels
// snappier and matches what users expect from spreadsheet apps.
const DOUBLE_CLICK_MS = 300

export interface ColumnResizeOptions {
    colWidths: ColWidths | undefined
    readOnly: boolean
    // Called once per gesture, on release, with the final clamped width.
    // The Grid wires this through to setYColWidth — keeping the hook
    // unaware of doc shape lets us reuse it for row resize later by
    // changing the consumer, not the hook.
    onCommit: (col: number, width: number) => void
    onAutosize: (col: number) => void
    // Web-only: right-click on a handle opens a small menu. Grid
    // renders the menu using these coordinates and the column index.
    onRequestMenu?: (col: number, x: number, y: number) => void
}

interface WebPointerEvent {
    pointerId: number
    clientX: number
    preventDefault: () => void
    stopPropagation: () => void
    currentTarget: {
        setPointerCapture: (id: number) => void
        releasePointerCapture: (id: number) => void
    }
}

export interface ColumnResizeHandlers {
    dragState: DragState | null
    // Spread onto the per-column handle View. Web returns DOM-style
    // pointer-event props (typed loosely because RN-Web forwards them
    // but doesn't include them in its type surface). Native returns
    // PanResponder.panHandlers for the same View.
    makeHandleProps: (col: number) => Record<string, unknown>
}

export function useColumnResize({
    colWidths,
    readOnly,
    onCommit,
    onAutosize,
    onRequestMenu,
}: ColumnResizeOptions): ColumnResizeHandlers {
    const [dragState, setDragState] = useState<DragState | null>(null)

    // Refs mirror the dragState so the platform handlers can read the
    // current value without re-binding on every render. PanResponder in
    // particular caches its callback closures on first creation; using
    // a ref lets us read live drag state without re-creating the
    // responder on each width update.
    const dragRef = useRef<DragState | null>(null)
    dragRef.current = dragState

    const colWidthsRef = useRef(colWidths)
    colWidthsRef.current = colWidths

    // Per-handle last-click timestamp for web double-click detection.
    // Map keyed by column so independent handles don't trigger each
    // other.
    const lastClickRef = useRef<Map<number, number>>(new Map())

    const beginDrag = useCallback(
        (col: number) => {
            if (readOnly) return
            const startWidth = readColWidth(colWidthsRef.current, col)
            const next: DragState = { col, startWidth, currentWidth: startWidth }
            dragRef.current = next
            setDragState(next)
        },
        [readOnly]
    )

    const updateDrag = useCallback((deltaX: number) => {
        const cur = dragRef.current
        if (cur == null) return
        const proposed = clampColWidth(cur.startWidth + deltaX)
        if (proposed === cur.currentWidth) return
        const next: DragState = { ...cur, currentWidth: proposed }
        dragRef.current = next
        setDragState(next)
    }, [])

    const endDrag = useCallback(() => {
        const cur = dragRef.current
        dragRef.current = null
        setDragState(null)
        if (cur == null) return
        if (cur.currentWidth === cur.startWidth) return
        onCommit(cur.col, cur.currentWidth)
    }, [onCommit])

    const cancelDrag = useCallback(() => {
        dragRef.current = null
        setDragState(null)
    }, [])

    // Web: pointer events with capture. We track startX on the ref so a
    // single mousemove handler can compute (clientX - startX) directly.
    const webStartXRef = useRef<number>(0)

    const makeWebProps = useCallback(
        (col: number): Record<string, unknown> => {
            if (readOnly) return {}
            return {
                onPointerDown: (e: WebPointerEvent) => {
                    e.preventDefault()
                    e.stopPropagation()
                    e.currentTarget.setPointerCapture(e.pointerId)
                    webStartXRef.current = e.clientX
                    beginDrag(col)
                },
                onPointerMove: (e: WebPointerEvent) => {
                    if (dragRef.current == null) return
                    updateDrag(e.clientX - webStartXRef.current)
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
                    // Browser-supplied detail===2 is a double-click. Some
                    // RN-Web versions don't surface detail, so we fall
                    // back to a manual timestamp check for safety.
                    e.preventDefault?.()
                    const now = Date.now()
                    const prev = lastClickRef.current.get(col) ?? 0
                    lastClickRef.current.set(col, now)
                    if ((e.detail ?? 0) >= 2 || now - prev < DOUBLE_CLICK_MS) {
                        lastClickRef.current.delete(col)
                        onAutosize(col)
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
                    onRequestMenu(col, e.clientX, e.clientY)
                },
            }
        },
        [readOnly, beginDrag, updateDrag, endDrag, cancelDrag, onAutosize, onRequestMenu]
    )

    // Native: PanResponder. We grab the responder on touch start so the
    // ScrollView underneath doesn't steal the gesture. PanResponder is
    // memoized per column via useMemo so the closure captures the
    // column without re-allocating on every render.
    const panResponderCacheRef = useRef<Map<number, ReturnType<typeof PanResponder.create>>>(
        new Map()
    )

    const makeNativeProps = useCallback(
        (col: number): Record<string, unknown> => {
            if (readOnly) return {}
            const cache = panResponderCacheRef.current
            let responder = cache.get(col)
            if (responder == null) {
                responder = PanResponder.create({
                    onStartShouldSetPanResponder: () => true,
                    onStartShouldSetPanResponderCapture: () => true,
                    onMoveShouldSetPanResponder: () => true,
                    onMoveShouldSetPanResponderCapture: () => true,
                    onPanResponderGrant: (_e: GestureResponderEvent) => {
                        beginDrag(col)
                    },
                    onPanResponderMove: (_e: GestureResponderEvent, g: { dx: number }) => {
                        updateDrag(g.dx)
                    },
                    onPanResponderRelease: () => {
                        endDrag()
                    },
                    onPanResponderTerminate: () => {
                        cancelDrag()
                    },
                })
                cache.set(col, responder)
            }
            return responder.panHandlers as unknown as Record<string, unknown>
        },
        [readOnly, beginDrag, updateDrag, endDrag, cancelDrag]
    )

    const makeHandleProps = useCallback(
        (col: number): Record<string, unknown> => {
            if (Platform.OS === 'web') return makeWebProps(col)
            return makeNativeProps(col)
        },
        [makeWebProps, makeNativeProps]
    )

    return useMemo(() => ({ dragState, makeHandleProps }), [dragState, makeHandleProps])
}

// Browser-side text measurement for autosize. Cached canvas context so
// repeated autosize calls don't re-allocate. Returns 0 in
// non-browser environments — callers fall back to char-count
// estimation in that case.
let cachedCtx: CanvasRenderingContext2D | null | undefined
function getCanvasCtx(): CanvasRenderingContext2D | null {
    if (cachedCtx !== undefined) return cachedCtx
    if (Platform.OS !== 'web') {
        cachedCtx = null
        return null
    }
    const canvas = document.createElement('canvas')
    cachedCtx = canvas.getContext('2d')
    return cachedCtx
}

// CELL_FONT mirrors the inline styling on the Cell <Text> (text-xs ≈
// 12px, default system stack). Setting the same font on the canvas
// context is what makes ctx.measureText return the on-screen width
// rather than a default-font approximation.
const CELL_FONT =
    '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Helvetica Neue", sans-serif'

export function measureWebText(text: string): number {
    const ctx = getCanvasCtx()
    if (ctx == null) return text.length * 7
    ctx.font = CELL_FONT
    return ctx.measureText(text).width
}

// Native fallback: 7px per glyph at the default 12px font is a rough
// average across Latin text. Wide for narrow strings, short for wide
// glyphs ('W'), but good enough for a first cut. Future improvement:
// hidden-Text-with-onLayout measurement.
const AVG_NATIVE_CHAR_WIDTH = 7
export function measureNativeText(text: string): number {
    return text.length * AVG_NATIVE_CHAR_WIDTH
}

export function measureColumnText(text: string): number {
    if (Platform.OS === 'web') return measureWebText(text)
    return measureNativeText(text)
}

// runAutosize is the shared entry point used by both the double-click
// path and the menu-item path. Reads cell display strings out of the
// Y.Doc, picks the widest, commits the new width.
export function runAutosize(
    doc: Y.Doc | null,
    sheetId: string,
    col: number,
    setWidth: (col: number, width: number) => void
): void {
    if (doc == null) return
    const width = autosizeColumnWidth(doc, sheetId, col, measureColumnText)
    setWidth(col, width)
}

// Re-exports kept on this module so callers can import handle visuals
// from the same place as the gesture hook.
export { AUTOSIZE_PADDING, DEFAULT_COL_WIDTH }
