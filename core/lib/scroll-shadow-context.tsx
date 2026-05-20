import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

interface ScrollShadowContextValue {
    isScrolled: boolean
    setIsScrolled: (scrolled: boolean) => void
}

const ScrollShadowContext = createContext<ScrollShadowContextValue>({
    isScrolled: false,
    setIsScrolled: () => {},
})

export function ScrollShadowProvider({ children }: { children: ReactNode }) {
    const [isScrolled, setIsScrolled] = useState(false)

    return (
        <ScrollShadowContext.Provider value={{ isScrolled, setIsScrolled }}>
            {children}
        </ScrollShadowContext.Provider>
    )
}

export function useScrollShadowContext() {
    return useContext(ScrollShadowContext)
}

export function useReportScroll() {
    const { setIsScrolled } = useContext(ScrollShadowContext)
    const wasScrolled = useRef(false)

    const onScroll = useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            const scrolled = e.nativeEvent.contentOffset.y > 0
            if (scrolled !== wasScrolled.current) {
                wasScrolled.current = scrolled
                setIsScrolled(scrolled)
            }
        },
        [setIsScrolled]
    )

    return { onScroll }
}
