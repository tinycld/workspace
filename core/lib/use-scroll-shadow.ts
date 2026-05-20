import { useCallback, useRef, useState } from 'react'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

/**
 * Tracks whether a ScrollView has been scrolled from the top.
 * Returns `isScrolled` and an `onScroll` handler to attach to the ScrollView.
 */
export function useScrollShadow() {
    const [isScrolled, setIsScrolled] = useState(false)
    const wasScrolled = useRef(false)

    const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const scrolled = e.nativeEvent.contentOffset.y > 0
        if (scrolled !== wasScrolled.current) {
            wasScrolled.current = scrolled
            setIsScrolled(scrolled)
        }
    }, [])

    return { isScrolled, onScroll }
}
