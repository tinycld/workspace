import { Stack } from 'expo-router'
import type { ReactNode } from 'react'

/**
 * Drop-in replacement for `<Slot/>` that keeps previously-visited screens
 * mounted-but-frozen via react-native-screens, with no transition animation.
 * Use it for tab-switcher style navigators (e.g. the org-level package
 * switcher) where each route is a peer and animation would feel like a
 * detail-page slide.
 *
 * On native this preserves screen state; on web `react-native-screens` falls
 * back to plain rendering, so behavior matches `<Slot/>` there.
 */
export function FrozenStack() {
    return (
        <Stack
            screenOptions={{
                headerShown: false,
                freezeOnBlur: true,
                animation: 'none',
            }}
        />
    )
}

/**
 * Like `FrozenStack` but uses the platform-default push animation (iOS
 * slide-from-right, Android fade-from-bottom). Use it for drill-down
 * navigators inside a package — list → detail → back — where the slide
 * cues "you're going deeper" / "you're coming back."
 *
 * Accepts optional children so individual screens can override their own
 * animation via `<Stack.Screen name="..." options={{ animation: ... }}/>`.
 */
export function FrozenSlideStack({ children }: { children?: ReactNode }) {
    return (
        <Stack
            screenOptions={{
                headerShown: false,
                freezeOnBlur: true,
                animation: 'default',
            }}
        >
            {children}
        </Stack>
    )
}
