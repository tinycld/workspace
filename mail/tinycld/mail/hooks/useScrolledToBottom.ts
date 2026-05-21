import { useCallback, useEffect, useRef, useState } from 'react'
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

const BOTTOM_THRESHOLD_PX = 24

export function isScrolledToBottom(metrics: { contentOffsetY: number; contentHeight: number; layoutHeight: number }) {
    const distanceFromBottom = metrics.contentHeight - (metrics.contentOffsetY + metrics.layoutHeight)
    return distanceFromBottom <= BOTTOM_THRESHOLD_PX
}

/**
 * Tracks whether the bottom edge of the *content* is visible. Accepts an
 * optional `bottomInset` to discount space that should not count as content
 * (e.g. a docked compose form whose height is included in contentSize via
 * `contentContainerStyle.paddingBottom`).
 */
export function useScrolledToBottom(bottomInset = 0) {
    const [isAtBottom, setIsAtBottom] = useState(false)
    const wasAtBottom = useRef(false)
    const offsetY = useRef(0)
    const contentHeight = useRef(0)
    const layoutHeight = useRef(0)
    const insetRef = useRef(bottomInset)

    const recompute = useCallback(() => {
        if (contentHeight.current <= 0 || layoutHeight.current <= 0) return
        const atBottom = isScrolledToBottom({
            contentOffsetY: offsetY.current,
            contentHeight: Math.max(0, contentHeight.current - insetRef.current),
            layoutHeight: layoutHeight.current,
        })
        if (atBottom !== wasAtBottom.current) {
            wasAtBottom.current = atBottom
            setIsAtBottom(atBottom)
        }
    }, [])

    useEffect(() => {
        insetRef.current = bottomInset
        recompute()
    }, [bottomInset, recompute])

    const onScroll = useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
            offsetY.current = contentOffset.y
            contentHeight.current = contentSize.height
            layoutHeight.current = layoutMeasurement.height
            recompute()
        },
        [recompute]
    )

    const onContentSizeChange = useCallback(
        (_w: number, h: number) => {
            contentHeight.current = h
            recompute()
        },
        [recompute]
    )

    const onLayout = useCallback(
        (e: LayoutChangeEvent) => {
            layoutHeight.current = e.nativeEvent.layout.height
            recompute()
        },
        [recompute]
    )

    return { isAtBottom, onScroll, onContentSizeChange, onLayout }
}
