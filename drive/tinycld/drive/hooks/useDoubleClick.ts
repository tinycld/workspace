import { useCallback, useRef } from 'react'
import type { GestureResponderEvent } from 'react-native'

const DOUBLE_CLICK_MS = 300

// Disambiguates single-tap from double-tap by deferring the single-tap
// handler for 300ms. A second tap inside that window cancels the timer
// and fires the double-tap handler instead. Works the same on web and
// native — iPad/iPhone double-tap-to-preview was previously broken
// because the web-only branch never tested the time-since-last-tap on
// native; every tap just scheduled another onSingleClick.
export function useDoubleClick(onSingleClick: (event: GestureResponderEvent) => void, onDoubleClick: () => void) {
    const lastTapRef = useRef(0)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const pendingEventRef = useRef<GestureResponderEvent | null>(null)

    return useCallback(
        (event: GestureResponderEvent) => {
            const now = Date.now()
            if (now - lastTapRef.current < DOUBLE_CLICK_MS) {
                if (timerRef.current) {
                    clearTimeout(timerRef.current)
                    timerRef.current = null
                }
                pendingEventRef.current = null
                onDoubleClick()
            } else {
                pendingEventRef.current = event
                timerRef.current = setTimeout(() => {
                    if (pendingEventRef.current) {
                        onSingleClick(pendingEventRef.current)
                        pendingEventRef.current = null
                    }
                    timerRef.current = null
                }, DOUBLE_CLICK_MS)
            }
            lastTapRef.current = now
        },
        [onSingleClick, onDoubleClick]
    )
}
