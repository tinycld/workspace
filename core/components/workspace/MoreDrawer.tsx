import { OrgLogo } from '@tinycld/core/components/OrgLogo'
import { useAuth } from '@tinycld/core/lib/auth'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { navigateToOrg } from '@tinycld/core/lib/org-url'
import { useWorkspaceStore } from '@tinycld/core/lib/stores/workspace-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useOrgSlug } from '@tinycld/core/lib/use-org-slug'
import { useSortedPackages } from '@tinycld/core/lib/use-sorted-packages'
import { useRouter } from 'expo-router'
import { Bell, LogOut, Settings, User, X } from 'lucide-react-native'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated'
import { MAX_VISIBLE_TABS } from './MobileTabBar'
import { getIcon } from './package-icon-map'
import { useUserOrgs } from './useUserOrgs'

const SPRING_CONFIG = {
    damping: 28,
    stiffness: 220,
    mass: 0.8,
}

export function MoreDrawer() {
    const isMoreOpen = useWorkspaceStore(s => s.isMoreOpen)
    const setMoreOpen = useWorkspaceStore(s => s.setMoreOpen)
    const activePkgSlug = useWorkspaceStore(s => s.activePkgSlug)
    const setNotificationsOpen = useWorkspaceStore(s => s.setNotificationsOpen)
    const railBg = useThemeColor('rail-background')
    const railText = useThemeColor('rail-text')
    const railActive = useThemeColor('rail-active-text')
    const borderColor = useThemeColor('border')
    const overlayBg = useThemeColor('overlay-backdrop')
    const router = useRouter()
    const orgHref = useOrgHref()
    const orgSlug = useOrgSlug()
    const { user, logout } = useAuth()
    const orgs = useUserOrgs()
    const sorted = useSortedPackages()
    const textColor = railText
    const activeColor = railActive

    const overflowPkgs = sorted.length > MAX_VISIBLE_TABS ? sorted.slice(MAX_VISIBLE_TABS) : []

    const drawerHeight = useSharedValue(600)
    const translateY = useSharedValue(600)
    const backdropOpacity = useSharedValue(0)
    const [mounted, setMounted] = useState(false)

    const close = useCallback(() => setMoreOpen(false), [setMoreOpen])

    useEffect(() => {
        if (isMoreOpen) {
            setMounted(true)
            translateY.value = withSpring(0, SPRING_CONFIG)
            backdropOpacity.value = withTiming(1, { duration: 200 })
        } else if (mounted) {
            translateY.value = withSpring(drawerHeight.value, SPRING_CONFIG)
            backdropOpacity.value = withTiming(0, { duration: 150 })
            const timeout = setTimeout(() => setMounted(false), 300)
            return () => clearTimeout(timeout)
        }
    }, [isMoreOpen, translateY, backdropOpacity, mounted, drawerHeight])

    const panGesture = Gesture.Pan()
        .activeOffsetY(10)
        .onUpdate(e => {
            translateY.value = Math.max(0, e.translationY)
        })
        .onEnd(e => {
            if (e.translationY > 100 || e.velocityY > 500) {
                translateY.value = withSpring(drawerHeight.value, SPRING_CONFIG)
                backdropOpacity.value = withTiming(0, { duration: 150 })
                runOnJS(close)()
            } else {
                translateY.value = withSpring(0, SPRING_CONFIG)
            }
        })

    const drawerStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY.value }],
    }))

    const backdropStyle = useAnimatedStyle(() => ({
        opacity: backdropOpacity.value,
    }))

    if (!mounted) return null

    const handleNav = (action: () => void) => {
        action()
        close()
    }

    return (
        <View
            className="absolute top-0 left-0 right-0 bottom-0 z-[5]"
            pointerEvents={isMoreOpen ? 'auto' : 'none'}
        >
            <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
                <Pressable
                    style={[StyleSheet.absoluteFill, { backgroundColor: overlayBg }]}
                    onPress={close}
                />
            </Animated.View>

            <GestureDetector gesture={panGesture}>
                <Animated.View
                    onLayout={e => {
                        drawerHeight.value = e.nativeEvent.layout.height
                    }}
                    className="absolute left-0 right-0 bottom-0 rounded-t-2xl"
                    style={[{ backgroundColor: railBg }, drawerStyle]}
                >
                    <View className="items-center py-2.5">
                        <View
                            className="w-9 h-1 rounded-sm"
                            style={{ backgroundColor: borderColor }}
                        />
                    </View>

                    <View className="flex-row items-center justify-between px-5 pb-3">
                        <View className="flex-row items-center gap-3">
                            <View
                                className="w-9 h-9 rounded-full justify-center items-center"
                                style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
                            >
                                <User size={18} color={activeColor} />
                            </View>
                            <Text
                                className="text-[17px] font-semibold"
                                style={{ color: activeColor }}
                            >
                                {user.name}
                            </Text>
                        </View>
                        <Pressable onPress={close} hitSlop={12}>
                            <X size={20} color={textColor} />
                        </Pressable>
                    </View>

                    <View className="px-2 pb-4">
                        <Pressable
                            className="flex-row items-center gap-3.5 px-4 py-3.5 rounded-lg"
                            onPress={() => {
                                close()
                                setNotificationsOpen(true)
                            }}
                        >
                            <Bell size={20} color={textColor} />
                            <Text className="text-base font-medium" style={{ color: textColor }}>
                                Notifications
                            </Text>
                        </Pressable>

                        <Pressable
                            className="flex-row items-center gap-3.5 px-4 py-3.5 rounded-lg"
                            onPress={() =>
                                handleNav(() => router.push(orgHref('settings/personal')))
                            }
                        >
                            <Settings size={20} color={textColor} />
                            <Text className="text-base font-medium" style={{ color: textColor }}>
                                Settings
                            </Text>
                        </Pressable>

                        {orgs.length > 1 ? (
                            <>
                                <View
                                    className="my-2 mx-3"
                                    style={{
                                        height: StyleSheet.hairlineWidth,
                                        backgroundColor: borderColor,
                                    }}
                                />
                                <Text
                                    className="text-xs font-semibold uppercase opacity-50 px-4 pt-1 pb-2"
                                    style={{ color: textColor }}
                                >
                                    Organizations
                                </Text>
                                {orgs.map(org => {
                                    const isActive = org.slug === orgSlug
                                    const color = isActive ? activeColor : textColor
                                    return (
                                        <Pressable
                                            key={org.id}
                                            className="flex-row items-center gap-3.5 px-4 py-3.5 rounded-lg"
                                            onPress={() => handleNav(() => navigateToOrg(org.slug))}
                                        >
                                            <OrgLogo org={org} size={20} />
                                            <Text
                                                className="text-base font-medium"
                                                style={{ color }}
                                            >
                                                {org.name}
                                            </Text>
                                        </Pressable>
                                    )
                                })}
                            </>
                        ) : null}

                        <View
                            className="my-2 mx-3"
                            style={{
                                height: StyleSheet.hairlineWidth,
                                backgroundColor: borderColor,
                            }}
                        />

                        <Pressable
                            className="flex-row items-center gap-3.5 px-4 py-3.5 rounded-lg"
                            onPress={() => handleNav(logout)}
                        >
                            <LogOut size={20} color={textColor} />
                            <Text className="text-base font-medium" style={{ color: textColor }}>
                                Sign out
                            </Text>
                        </Pressable>

                        {overflowPkgs.length > 0 ? (
                            <>
                                <View
                                    className="my-2 mx-3"
                                    style={{
                                        height: StyleSheet.hairlineWidth,
                                        backgroundColor: borderColor,
                                    }}
                                />
                                {overflowPkgs.map(pkg => {
                                    const Icon = getIcon(pkg.nav?.icon ?? '')
                                    const isActive = activePkgSlug === pkg.slug
                                    const color = isActive ? activeColor : textColor
                                    return (
                                        <Pressable
                                            key={pkg.slug}
                                            testID={`nav-${pkg.slug}`}
                                            className="flex-row items-center gap-3.5 px-4 py-3.5 rounded-lg"
                                            onPress={() =>
                                                handleNav(() =>
                                                    router.push(`/a/${orgSlug}/${pkg.slug}`)
                                                )
                                            }
                                        >
                                            <Icon size={20} color={color} />
                                            <Text
                                                className="text-base font-medium"
                                                style={{ color }}
                                            >
                                                {pkg.nav?.label}
                                            </Text>
                                        </Pressable>
                                    )
                                })}
                            </>
                        ) : null}
                    </View>
                </Animated.View>
            </GestureDetector>
        </View>
    )
}
