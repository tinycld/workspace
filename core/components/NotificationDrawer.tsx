import { and, eq } from '@tanstack/db'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useWorkspaceStore } from '@tinycld/core/lib/stores/workspace-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import type { Notifications } from '@tinycld/core/types/pbSchema'
import { useRouter } from 'expo-router'
import { Bell, Calendar, Check, File, Mail, Shield, X } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated'

const DRAWER_WIDTH = 340
const RAIL_WIDTH = 64
const SPRING_CONFIG = { damping: 28, stiffness: 220, mass: 0.8 }

const PACKAGE_ICONS: Record<string, typeof Bell> = {
    calendar: Calendar,
    mail: Mail,
    drive: File,
    core: Shield,
}

/**
 * Desktop/tablet: side panel sliding from left edge.
 * Mobile: bottom sheet sliding up (same pattern as MoreDrawer).
 */
export function NotificationDrawer({ mobile = false }: { mobile?: boolean }) {
    if (mobile) return <MobileNotificationSheet />
    return <DesktopNotificationPanel />
}

// ── Desktop / Tablet panel ──

const TRANSITION = 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)'

function DesktopNotificationPanel() {
    const isOpen = useWorkspaceStore(s => s.isNotificationsOpen)
    const close = useWorkspaceStore(s => s.setNotificationsOpen)
    const overlayColor = useThemeColor('overlay-backdrop')
    const [isMounted, setIsMounted] = useState(isOpen)

    useEffect(() => {
        if (isOpen) {
            setIsMounted(true)
            return
        }
        const timeout = setTimeout(() => setIsMounted(false), 250)
        return () => clearTimeout(timeout)
    }, [isOpen])

    if (!isMounted) return null

    return (
        <View
            className="absolute top-0 right-0 bottom-0"
            style={{
                left: RAIL_WIDTH,
                zIndex: 200,
            }}
            pointerEvents={isOpen ? 'auto' : 'none'}
        >
            <Pressable
                className="absolute top-0 left-0 right-0 bottom-0"
                style={
                    {
                        backgroundColor: overlayColor,
                        opacity: isOpen ? 1 : 0,
                        transition: `opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)`,
                    } as object
                }
                onPress={() => close(false)}
            />

            <View
                className="absolute top-0 bottom-0 left-0 border-r border-border bg-background"
                style={
                    {
                        width: DRAWER_WIDTH,
                        zIndex: 201,
                        transform: `translateX(${isOpen ? 0 : -DRAWER_WIDTH}px)`,
                        transition: TRANSITION,
                    } as object
                }
            >
                <NotificationContent />
            </View>
        </View>
    )
}

// ── Mobile bottom sheet ──

function MobileNotificationSheet() {
    const isOpen = useWorkspaceStore(s => s.isNotificationsOpen)
    const setOpen = useWorkspaceStore(s => s.setNotificationsOpen)
    const overlayBg = useThemeColor('overlay-backdrop')

    const sheetHeight = useSharedValue(600)
    const translateY = useSharedValue(600)
    const backdropOpacity = useSharedValue(0)
    const [mounted, setMounted] = useState(false)

    const close = useCallback(() => setOpen(false), [setOpen])

    useEffect(() => {
        if (isOpen) {
            setMounted(true)
            translateY.value = withSpring(0, SPRING_CONFIG)
            backdropOpacity.value = withTiming(1, { duration: 200 })
        } else if (mounted) {
            translateY.value = withSpring(sheetHeight.value, SPRING_CONFIG)
            backdropOpacity.value = withTiming(0, { duration: 150 })
            const timeout = setTimeout(() => setMounted(false), 300)
            return () => clearTimeout(timeout)
        }
    }, [isOpen, translateY, backdropOpacity, mounted, sheetHeight])

    const panGesture = Gesture.Pan()
        .activeOffsetY(10)
        .onUpdate(e => {
            translateY.value = Math.max(0, e.translationY)
        })
        .onEnd(e => {
            if (e.translationY > 100 || e.velocityY > 500) {
                translateY.value = withSpring(sheetHeight.value, SPRING_CONFIG)
                backdropOpacity.value = withTiming(0, { duration: 150 })
                runOnJS(close)()
            } else {
                translateY.value = withSpring(0, SPRING_CONFIG)
            }
        })

    const sheetStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY.value }],
    }))

    const backdropStyle = useAnimatedStyle(() => ({
        opacity: backdropOpacity.value,
    }))

    if (!mounted) return null

    return (
        <View
            className="absolute top-0 left-0 right-0 bottom-0 z-[5]"
            pointerEvents={isOpen ? 'auto' : 'none'}
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
                        sheetHeight.value = e.nativeEvent.layout.height
                    }}
                    className="absolute left-0 right-0 bottom-0 max-h-[85%] rounded-t-2xl border-t border-border bg-background"
                    style={sheetStyle}
                >
                    <View className="items-center py-2.5">
                        <View className="w-9 h-1 rounded-sm bg-border" />
                    </View>
                    <NotificationContent />
                </Animated.View>
            </GestureDetector>
        </View>
    )
}

// ── Shared notification content ──

function NotificationContent() {
    const [notificationsCollection] = useStore('notifications')
    const mutedColor = useThemeColor('muted-foreground')
    const primaryColor = useThemeColor('primary')
    const close = useWorkspaceStore(s => s.setNotificationsOpen)
    const router = useRouter()

    const { data: rawNotifications } = useOrgLiveQuery(
        (query, { orgId }) =>
            query
                .from({ n: notificationsCollection })
                .where(({ n }) => and(eq(n.org, orgId), eq(n.dismissed, false))),
        []
    )

    const notifications = useMemo(
        () => [...(rawNotifications ?? [])].sort((a, b) => (b.created > a.created ? 1 : -1)),
        [rawNotifications]
    )

    const markAllRead = useMutation({
        mutationFn: mutation(function* () {
            const unread = notifications.filter(n => !n.read)
            const txs = unread.map(n =>
                notificationsCollection.update(n.id, draft => {
                    draft.read = true
                })
            )
            yield txs
        }),
    })

    const markRead = useMutation({
        mutationFn: mutation(function* (id: string) {
            yield notificationsCollection.update(id, draft => {
                draft.read = true
            })
        }),
    })

    const dismiss = useMutation({
        mutationFn: mutation(function* (id: string) {
            yield notificationsCollection.update(id, draft => {
                draft.dismissed = true
            })
        }),
    })

    const handleNotificationPress = (notification: Notifications) => {
        markRead.mutate(notification.id)
        if (notification.url) {
            router.push(notification.url as never)
        }
        close(false)
    }

    return (
        <>
            <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
                <Text className="text-base font-bold text-foreground">Notifications</Text>
                <View className="flex-row items-center gap-3">
                    <MarkAllReadButton
                        isVisible={notifications.some(n => !n.read) && !markAllRead.isPending}
                        onPress={() => {
                            markAllRead.mutate()
                            close(false)
                        }}
                        color={primaryColor}
                    />
                    <Pressable onPress={() => close(false)} hitSlop={8}>
                        <X size={18} color={mutedColor} />
                    </Pressable>
                </View>
            </View>

            <ScrollView className="flex-1">
                <EmptyState isVisible={!notifications.length} color={mutedColor} />
                {notifications.map(notification => (
                    <NotificationItem
                        key={notification.id}
                        notification={notification}
                        onPress={() => handleNotificationPress(notification)}
                        onDismiss={() => dismiss.mutate(notification.id)}
                    />
                ))}
            </ScrollView>
        </>
    )
}

function MarkAllReadButton({
    isVisible,
    onPress,
    color,
}: {
    isVisible: boolean
    onPress: () => void
    color: string
}) {
    if (!isVisible) return null
    return (
        <Pressable onPress={onPress} className="flex-row items-center gap-1">
            <Check size={14} color={color} />
            <Text style={{ fontSize: 12, color }}>Mark all read</Text>
        </Pressable>
    )
}

function EmptyState({ isVisible, color }: { isVisible: boolean; color: string }) {
    if (!isVisible) return null
    return (
        <View className="items-center py-12 gap-2">
            <Bell size={28} color={color} />
            <Text style={{ fontSize: 14, color }}>No notifications</Text>
        </View>
    )
}

function NotificationItem({
    notification,
    onPress,
    onDismiss,
}: {
    notification: Notifications
    onPress: () => void
    onDismiss: () => void
}) {
    const mutedColor = useThemeColor('muted-foreground')
    const accentColor = useThemeColor('accent')
    const primaryColor = useThemeColor('primary')

    const Icon = PACKAGE_ICONS[notification.package] ?? Bell
    const isUnread = !notification.read

    return (
        <Pressable
            onPress={onPress}
            className="flex-row items-start gap-3 px-4 py-3 border-b border-border"
            style={{
                backgroundColor: isUnread ? `${accentColor}08` : undefined,
            }}
        >
            <Icon size={18} color={mutedColor} style={{ marginTop: 2 }} />

            <View style={{ flex: 1, gap: 2 }}>
                <Text
                    className={`text-sm text-foreground ${isUnread ? 'font-semibold' : 'font-normal'}`}
                    numberOfLines={1}
                >
                    {notification.title}
                </Text>
                <NotificationBody body={notification.body} color={mutedColor} />
                <Text className="text-[11px] text-muted-foreground">
                    {formatRelativeTime(notification.created)}
                </Text>
            </View>

            <View className="flex-row items-center gap-1.5">
                <UnreadDot isVisible={isUnread} color={primaryColor} />
                <Pressable
                    onPress={e => {
                        e.stopPropagation?.()
                        onDismiss()
                    }}
                    hitSlop={6}
                >
                    <X size={14} color={mutedColor} />
                </Pressable>
            </View>
        </Pressable>
    )
}

function NotificationBody({ body, color }: { body: string; color: string }) {
    if (!body) return null
    return (
        <Text style={{ fontSize: 13, color }} numberOfLines={2}>
            {body}
        </Text>
    )
}

function UnreadDot({ isVisible, color }: { isVisible: boolean; color: string }) {
    if (!isVisible) return null
    return (
        <View
            style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: color,
            }}
        />
    )
}

function formatRelativeTime(dateStr: string | undefined): string {
    if (!dateStr) return 'just now'
    const date = new Date(dateStr.replace(' ', 'T'))
    const now = Date.now()
    const diff = now - date.getTime()
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (seconds < 60) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 7) return `${days}d ago`
    return date.toLocaleDateString()
}
