import { useCallback, useRef, useState } from 'react'
import type { DragContext, DragGestureHandlers, PointerLike, UseDragGestureOptions } from './types'

interface WebPointerDown {
    pointerId: number
    clientX: number
    clientY: number
    shiftKey: boolean
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
    button: number
    preventDefault: () => void
    currentTarget: {
        setPointerCapture: (id: number) => void
        releasePointerCapture: (id: number) => void
        getBoundingClientRect: () => DOMRect
    }
}

export function useDragGesture(opts: UseDragGestureOptions): DragGestureHandlers {
    const optsRef = useRef(opts)
    optsRef.current = opts

    const [isDragging, setIsDragging] = useState(false)
    const wasDraggedRef = useRef(false)
    const [, forceRender] = useState(0)

    // Live drag state: down-time captured info + the pointer id we're
    // tracking. Null when no gesture is in flight.
    const stateRef = useRef<{
        pointerId: number
        startX: number
        startY: number
        startRect: { left: number; top: number; width: number; height: number } | null
        engaged: boolean
        gestureRefused: boolean
        modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }
        target: WebPointerDown['currentTarget']
        onMove: (e: PointerEvent) => void
        onUp: (e: PointerEvent) => void
    } | null>(null)

    const cleanup = useCallback(() => {
        const s = stateRef.current
        if (s == null) return
        window.removeEventListener('pointermove', s.onMove)
        window.removeEventListener('pointerup', s.onUp)
        window.removeEventListener('pointercancel', s.onUp)
        try {
            s.target.releasePointerCapture(s.pointerId)
        } catch {
            // Element may have already lost capture (e.g. unmounted)
        }
        stateRef.current = null
        setIsDragging(false)
    }, [])

    const onPointerDown = useCallback(
        (e: WebPointerDown) => {
            if (optsRef.current.disabled) return
            if (e.button !== 0) return
            wasDraggedRef.current = false
            const rect =
                optsRef.current.measureTarget !== false
                    ? e.currentTarget.getBoundingClientRect()
                    : null

            try {
                e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
                // Capture can fail in edge cases; the move listener
                // on window will still receive events.
            }

            const onMove = (ev: PointerEvent) => {
                const s = stateRef.current
                if (s == null) return
                if (s.gestureRefused) return
                const deltaX = ev.clientX - s.startX
                const deltaY = ev.clientY - s.startY
                const threshold = optsRef.current.threshold ?? 3
                if (!s.engaged) {
                    if (Math.abs(deltaX) < threshold && Math.abs(deltaY) < threshold) return
                    s.engaged = true
                    setIsDragging(true)
                    const ctx: DragContext = {
                        pointer: pointerLikeFromMove(ev, s.modifiers),
                        deltaX,
                        deltaY,
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
                    pointer: pointerLikeFromMove(ev, s.modifiers),
                    deltaX,
                    deltaY,
                    startRect: s.startRect,
                }
                optsRef.current.onDragMove?.(ctx)
            }

            const onUp = (ev: PointerEvent) => {
                const s = stateRef.current
                if (s == null) return
                if (s.engaged && !s.gestureRefused) {
                    const ctx: DragContext = {
                        pointer: pointerLikeFromMove(ev, s.modifiers),
                        deltaX: ev.clientX - s.startX,
                        deltaY: ev.clientY - s.startY,
                        startRect: s.startRect,
                    }
                    optsRef.current.onDragEnd?.(ctx)
                    wasDraggedRef.current = true
                    // Force a re-render so consumers reading wasDragged
                    // off the returned handlers see the new value on
                    // their next onPress.
                    forceRender(n => n + 1)
                }
                cleanup()
            }

            stateRef.current = {
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                startRect: rect
                    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
                    : null,
                engaged: false,
                gestureRefused: false,
                modifiers: {
                    shiftKey: e.shiftKey,
                    ctrlKey: e.ctrlKey,
                    metaKey: e.metaKey,
                    altKey: e.altKey,
                },
                target: e.currentTarget,
                onMove,
                onUp,
            }

            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
            window.addEventListener('pointercancel', onUp)
        },
        [cleanup]
    )

    return {
        handlers: { onPointerDown },
        isDragging,
        wasDragged: wasDraggedRef.current,
    }
}

function pointerLikeFromMove(
    e: PointerEvent,
    mods: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }
): PointerLike {
    // We carry the *down-time* modifiers, not the live ones. Calc's
    // shift-extend gesture (the one consumer that cares) only reads
    // modifiers at down-time; live tracking would require a different
    // gesture shape and isn't a calc use case.
    return {
        x: e.clientX,
        y: e.clientY,
        shiftKey: mods.shiftKey,
        ctrlKey: mods.ctrlKey,
        metaKey: mods.metaKey,
        altKey: mods.altKey,
    }
}
