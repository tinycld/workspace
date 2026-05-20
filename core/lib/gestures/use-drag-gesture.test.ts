// @vitest-environment happy-dom

// Vitest renders hooks via @testing-library/react. We test the web
// path directly here (the native PanResponder path is harder to drive
// from vitest; we rely on manual iPad verification for that). Both
// implementations share the same state-machine shape, so testing one
// gives confidence in the other.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDragGesture } from './use-drag-gesture.web'

function makePointerDown(
    overrides: Partial<{
        clientX: number
        clientY: number
        shiftKey: boolean
        ctrlKey: boolean
    }> = {}
) {
    const target = {
        setPointerCapture: vi.fn(),
        releasePointerCapture: vi.fn(),
        getBoundingClientRect: () =>
            ({
                left: 0,
                top: 0,
                width: 100,
                height: 20,
                right: 100,
                bottom: 20,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect,
    }
    return {
        pointerId: 1,
        button: 0,
        clientX: overrides.clientX ?? 10,
        clientY: overrides.clientY ?? 10,
        shiftKey: overrides.shiftKey ?? false,
        ctrlKey: overrides.ctrlKey ?? false,
        metaKey: false,
        altKey: false,
        preventDefault: vi.fn(),
        currentTarget: target,
    }
}

describe('useDragGesture (web)', () => {
    it('does not fire onDragStart for a small movement below the threshold', () => {
        const onDragStart = vi.fn()
        const { result } = renderHook(() => useDragGesture({ onDragStart, threshold: 3 }))
        act(() => {
            ;(result.current.handlers.onPointerDown as (e: unknown) => void)(makePointerDown())
        })
        act(() => {
            window.dispatchEvent(
                new PointerEvent('pointermove', { clientX: 12, clientY: 10, pointerId: 1 })
            )
        })
        expect(onDragStart).not.toHaveBeenCalled()
    })

    it('fires onDragStart once the movement crosses the threshold', () => {
        const onDragStart = vi.fn()
        const onDragMove = vi.fn()
        const { result } = renderHook(() =>
            useDragGesture({ onDragStart, onDragMove, threshold: 3 })
        )
        act(() => {
            ;(result.current.handlers.onPointerDown as (e: unknown) => void)(makePointerDown())
        })
        act(() => {
            window.dispatchEvent(
                new PointerEvent('pointermove', { clientX: 20, clientY: 10, pointerId: 1 })
            )
        })
        expect(onDragStart).toHaveBeenCalledTimes(1)
        act(() => {
            window.dispatchEvent(
                new PointerEvent('pointermove', { clientX: 30, clientY: 10, pointerId: 1 })
            )
        })
        expect(onDragStart).toHaveBeenCalledTimes(1)
        expect(onDragMove).toHaveBeenCalledTimes(1)
    })

    it('skips onDragMove and onDragEnd when onDragStart returns false', () => {
        const onDragStart = vi.fn(() => false)
        const onDragMove = vi.fn()
        const onDragEnd = vi.fn()
        const { result } = renderHook(() =>
            useDragGesture({ onDragStart, onDragMove, onDragEnd, threshold: 3 })
        )
        act(() => {
            ;(result.current.handlers.onPointerDown as (e: unknown) => void)(makePointerDown())
        })
        act(() => {
            window.dispatchEvent(
                new PointerEvent('pointermove', { clientX: 20, clientY: 10, pointerId: 1 })
            )
        })
        act(() => {
            window.dispatchEvent(
                new PointerEvent('pointerup', { clientX: 20, clientY: 10, pointerId: 1 })
            )
        })
        expect(onDragStart).toHaveBeenCalledTimes(1)
        expect(onDragMove).not.toHaveBeenCalled()
        expect(onDragEnd).not.toHaveBeenCalled()
    })

    it('reports shiftKey from the down-event in DragContext.pointer', () => {
        const onDragStart = vi.fn(() => true)
        const { result } = renderHook(() => useDragGesture({ onDragStart, threshold: 3 }))
        act(() => {
            ;(result.current.handlers.onPointerDown as (e: unknown) => void)(
                makePointerDown({ shiftKey: true })
            )
        })
        act(() => {
            window.dispatchEvent(
                new PointerEvent('pointermove', { clientX: 20, clientY: 10, pointerId: 1 })
            )
        })
        expect(onDragStart).toHaveBeenCalledWith(
            expect.objectContaining({
                pointer: expect.objectContaining({ shiftKey: true }),
            })
        )
    })
})
