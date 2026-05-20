import { useMemo, useRef, useState } from 'react'
import {
    type GestureResponderEvent,
    PanResponder,
    type PanResponderGestureState,
} from 'react-native'
import type { DragContext, DragGestureHandlers, PointerLike, UseDragGestureOptions } from './types'

export function useDragGesture(opts: UseDragGestureOptions): DragGestureHandlers {
    const optsRef = useRef(opts)
    optsRef.current = opts

    const [isDragging, setIsDragging] = useState(false)
    const wasDraggedRef = useRef(false)
    const [, forceRender] = useState(0)

    const stateRef = useRef<{
        startX: number
        startY: number
        startRect: { left: number; top: number; width: number; height: number } | null
        engaged: boolean
        gestureRefused: boolean
    } | null>(null)

    // PanResponder is memoized per-mount so its closure captures the
    // ref-driven opts (which always read through optsRef.current). This
    // lets the consumer pass fresh closures each render without re-
    // creating the responder.
    const panResponder = useMemo(
        () =>
            PanResponder.create({
                onStartShouldSetPanResponder: () => !optsRef.current.disabled,
                onStartShouldSetPanResponderCapture: () => !optsRef.current.disabled,
                onMoveShouldSetPanResponder: () => !optsRef.current.disabled,
                onMoveShouldSetPanResponderCapture: () => !optsRef.current.disabled,
                onPanResponderGrant: (e: GestureResponderEvent) => {
                    wasDraggedRef.current = false
                    const { pageX, pageY } = e.nativeEvent
                    // startRect is null on native — RN doesn't surface
                    // target dimensions in the gesture event. Consumers
                    // that need the rect should set measureTarget=false
                    // and compute their own geometry from a ref.
                    stateRef.current = {
                        startX: pageX,
                        startY: pageY,
                        startRect: null,
                        engaged: false,
                        gestureRefused: false,
                    }
                },
                onPanResponderMove: (e: GestureResponderEvent, g: PanResponderGestureState) => {
                    const s = stateRef.current
                    if (s == null) return
                    if (s.gestureRefused) return
                    const threshold = optsRef.current.threshold ?? 3
                    if (!s.engaged) {
                        if (Math.abs(g.dx) < threshold && Math.abs(g.dy) < threshold) return
                        s.engaged = true
                        setIsDragging(true)
                        const ctx: DragContext = {
                            pointer: pointerLikeFromGesture(e),
                            deltaX: g.dx,
                            deltaY: g.dy,
                            startRect: s.startRect,
                        }
                        const accepted = optsRef.current.onDragStart?.(ctx) ?? true
                        if (accepted === false) {
                            s.gestureRefused = true
                            return
                        }
                        return
                    }
                    const ctx: DragContext = {
                        pointer: pointerLikeFromGesture(e),
                        deltaX: g.dx,
                        deltaY: g.dy,
                        startRect: s.startRect,
                    }
                    optsRef.current.onDragMove?.(ctx)
                },
                onPanResponderRelease: (e: GestureResponderEvent, g: PanResponderGestureState) => {
                    const s = stateRef.current
                    if (s == null) return
                    if (s.engaged && !s.gestureRefused) {
                        const ctx: DragContext = {
                            pointer: pointerLikeFromGesture(e),
                            deltaX: g.dx,
                            deltaY: g.dy,
                            startRect: s.startRect,
                        }
                        optsRef.current.onDragEnd?.(ctx)
                        wasDraggedRef.current = true
                        forceRender(n => n + 1)
                    }
                    stateRef.current = null
                    setIsDragging(false)
                },
                onPanResponderTerminate: () => {
                    stateRef.current = null
                    setIsDragging(false)
                },
            }),
        []
    )

    return {
        handlers: panResponder.panHandlers as unknown as Record<string, unknown>,
        isDragging,
        wasDragged: wasDraggedRef.current,
    }
}

function pointerLikeFromGesture(e: GestureResponderEvent): PointerLike {
    return {
        x: e.nativeEvent.pageX,
        y: e.nativeEvent.pageY,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
    }
}
