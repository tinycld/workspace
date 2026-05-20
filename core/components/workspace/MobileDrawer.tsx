import { packageSidebars } from '@tinycld/core/lib/packages/derive-components'
import { usePackage } from '@tinycld/core/lib/packages/use-packages'
import { useWorkspaceStore } from '@tinycld/core/lib/stores/workspace-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const PANEL_WIDTH = 280
const EDGE_WIDTH = 20
const VELOCITY_THRESHOLD = 500

const SPRING_CONFIG = {
    damping: 25,
    stiffness: 200,
    mass: 0.8,
}

interface MobileDrawerProps {
    isVisible: boolean
}

export function MobileDrawer({ isVisible }: MobileDrawerProps) {
    const overlayBg = useThemeColor('overlay-backdrop')
    const sidebarBg = useThemeColor('sidebar-background')
    const insets = useSafeAreaInsets()
    const activePkgSlug = useWorkspaceStore(s => s.activePkgSlug)
    const setDrawerOpen = useWorkspaceStore(s => s.setDrawerOpen)
    const pkg = usePackage(activePkgSlug ?? '')
    const translateX = useSharedValue(-PANEL_WIDTH)

    // Defer mounting the active package's sidebar until the drawer has been
    // opened at least once for this package. The sidebar runs live queries
    // (folder counts, calendar lists, etc.) that block the JS thread on mount;
    // pre-mounting it on every tab switch was the dominant cost of bottom-tab
    // navigation. Reset when the package changes so a freshly-tabbed-to package
    // doesn't pre-mount its sidebar before the user actually asks for it.
    const [openedForSlug, setOpenedForSlug] = useState<string | null>(null)
    const hasOpened = openedForSlug === activePkgSlug && activePkgSlug != null

    const openDrawer = useCallback(() => setDrawerOpen(true), [setDrawerOpen])
    const closeDrawer = useCallback(() => setDrawerOpen(false), [setDrawerOpen])

    useEffect(() => {
        translateX.value = withSpring(isVisible ? 0 : -PANEL_WIDTH, SPRING_CONFIG)
        if (isVisible && activePkgSlug && openedForSlug !== activePkgSlug) {
            setOpenedForSlug(activePkgSlug)
        }
    }, [isVisible, translateX, activePkgSlug, openedForSlug])

    const edgeGesture = Gesture.Pan()
        .activeOffsetX(10)
        .onUpdate(e => {
            translateX.value = Math.max(-PANEL_WIDTH, Math.min(0, -PANEL_WIDTH + e.translationX))
        })
        .onEnd(e => {
            const shouldOpen =
                e.velocityX > VELOCITY_THRESHOLD ||
                (e.velocityX > -VELOCITY_THRESHOLD && translateX.value > -PANEL_WIDTH / 2)
            translateX.value = withSpring(shouldOpen ? 0 : -PANEL_WIDTH, SPRING_CONFIG)
            runOnJS(shouldOpen ? openDrawer : closeDrawer)()
        })

    const closeGesture = Gesture.Pan()
        .activeOffsetX(-10)
        .onUpdate(e => {
            translateX.value = Math.max(-PANEL_WIDTH, Math.min(0, e.translationX))
        })
        .onEnd(e => {
            const shouldOpen =
                e.velocityX > VELOCITY_THRESHOLD ||
                (e.velocityX > -VELOCITY_THRESHOLD && translateX.value > -PANEL_WIDTH / 2)
            translateX.value = withSpring(shouldOpen ? 0 : -PANEL_WIDTH, SPRING_CONFIG)
            runOnJS(shouldOpen ? openDrawer : closeDrawer)()
        })

    const panelStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: translateX.value }],
    }))

    const backdropStyle = useAnimatedStyle(() => ({
        opacity: (translateX.value + PANEL_WIDTH) / PANEL_WIDTH,
    }))

    const SidebarComponent = pkg ? packageSidebars[pkg.slug] : null

    if (!pkg?.sidebar) return null

    return (
        <>
            {!isVisible ? (
                <GestureDetector gesture={edgeGesture}>
                    <Animated.View
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            bottom: 0,
                            width: EDGE_WIDTH,
                            zIndex: 200,
                        }}
                    />
                </GestureDetector>
            ) : null}
            <GestureDetector gesture={closeGesture}>
                <View
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: isVisible ? 200 : -1,
                    }}
                    pointerEvents={isVisible ? 'auto' : 'none'}
                >
                    <Animated.View
                        style={[
                            { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
                            backdropStyle,
                        ]}
                    >
                        <Pressable
                            className="flex-1"
                            style={{
                                backgroundColor: overlayBg,
                            }}
                            onPress={() => setDrawerOpen(false)}
                        />
                    </Animated.View>
                    <Animated.View
                        style={[
                            {
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                bottom: 0,
                                width: PANEL_WIDTH,
                                zIndex: 201,
                                backgroundColor: sidebarBg,
                                paddingTop: insets.top,
                                paddingBottom: insets.bottom,
                            },
                            panelStyle,
                        ]}
                    >
                        {hasOpened && SidebarComponent ? (
                            <Suspense fallback={null}>
                                <SidebarComponent isCollapsed={false} />
                            </Suspense>
                        ) : null}
                    </Animated.View>
                </View>
            </GestureDetector>
        </>
    )
}
