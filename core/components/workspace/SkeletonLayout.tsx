import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useEffect, useRef } from 'react'
import { Animated, Platform, View } from 'react-native'
import { useBreakpoint } from './useBreakpoint'

function SkeletonBlock({
    width,
    height,
    style,
}: {
    width: number | string
    height: number
    style?: object
}) {
    const borderColor = useThemeColor('border')
    const opacity = useRef(new Animated.Value(0.3)).current

    useEffect(() => {
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
                Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
            ])
        )
        animation.start()
        return () => animation.stop()
    }, [opacity])

    return (
        <Animated.View
            style={[
                {
                    width: width as number,
                    height,
                    borderRadius: 8,
                    backgroundColor: borderColor ?? '#88888833',
                    opacity,
                },
                style,
            ]}
        />
    )
}

function SkeletonRail() {
    const railBg = useThemeColor('rail-background')
    const railText = useThemeColor('rail-text')

    return (
        <View
            style={{
                width: 64,
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingVertical: 12,
                backgroundColor: railBg,
            }}
        >
            <View className="items-center gap-2">
                <SkeletonBlock width={36} height={36} style={{ borderRadius: 10, opacity: 0.15 }} />
                <View
                    className="my-1"
                    style={{
                        width: 28,
                        height: 1,
                        opacity: 0.2,
                        backgroundColor: railText,
                    }}
                />
                <SkeletonBlock width={36} height={36} style={{ borderRadius: 10, opacity: 0.15 }} />
                <SkeletonBlock width={36} height={36} style={{ borderRadius: 10, opacity: 0.15 }} />
                <SkeletonBlock width={36} height={36} style={{ borderRadius: 10, opacity: 0.15 }} />
            </View>
            <View className="items-center gap-2">
                <SkeletonBlock width={36} height={36} style={{ borderRadius: 10, opacity: 0.15 }} />
                <SkeletonBlock width={28} height={28} style={{ borderRadius: 14, opacity: 0.15 }} />
            </View>
        </View>
    )
}

export function SkeletonSidebar({ width }: { width: number }) {
    const sidebarBg = useThemeColor('sidebar-background')

    return (
        <View
            className="border-r border-border px-3"
            style={{
                width,
                backgroundColor: sidebarBg,
            }}
        >
            <SkeletonBlock width={100} height={11} style={{ marginBottom: 12, marginTop: 20 }} />
            <SkeletonBlock width="85%" height={32} style={{ marginBottom: 4 }} />
            <SkeletonBlock width="85%" height={32} style={{ marginBottom: 4 }} />
            <SkeletonBlock width="85%" height={32} style={{ marginBottom: 16 }} />
            <View className="h-px my-2 bg-border" />
            <SkeletonBlock width={80} height={11} style={{ marginBottom: 12, marginTop: 8 }} />
            <SkeletonBlock width="85%" height={32} style={{ marginBottom: 4 }} />
            <SkeletonBlock width="85%" height={32} />
        </View>
    )
}

function SkeletonMain() {
    return (
        <View className="flex-1 p-6 bg-background">
            <SkeletonBlock width={200} height={24} style={{ marginBottom: 24 }} />
            <SkeletonBlock width="100%" height={48} style={{ marginBottom: 12 }} />
            <SkeletonBlock width="100%" height={48} style={{ marginBottom: 12 }} />
            <SkeletonBlock width="100%" height={48} style={{ marginBottom: 12 }} />
            <SkeletonBlock width="60%" height={48} />
        </View>
    )
}

const SIDEBAR_WIDTH = 260

function SkeletonTabBar() {
    const railBg = useThemeColor('rail-background')

    return (
        <View
            className="h-14 border-t border-border flex-row items-center justify-around px-4"
            style={{
                backgroundColor: railBg,
            }}
        >
            <SkeletonBlock width={36} height={36} style={{ borderRadius: 10, opacity: 0.15 }} />
            <SkeletonBlock width={36} height={36} style={{ borderRadius: 10, opacity: 0.15 }} />
            <SkeletonBlock width={36} height={36} style={{ borderRadius: 10, opacity: 0.15 }} />
        </View>
    )
}

export function SkeletonLayout() {
    if (Platform.OS !== 'web') {
        return (
            <View className="flex-1">
                <View className="flex-1 p-6">
                    <SkeletonBlock width={200} height={24} style={{ marginBottom: 24 }} />
                    <SkeletonBlock width="100%" height={48} style={{ marginBottom: 12 }} />
                    <SkeletonBlock width="100%" height={48} style={{ marginBottom: 12 }} />
                    <SkeletonBlock width="100%" height={48} style={{ marginBottom: 12 }} />
                    <SkeletonBlock width="60%" height={48} />
                </View>
            </View>
        )
    }

    return <SkeletonLayoutWeb />
}

function SkeletonLayoutWeb() {
    const breakpoint = useBreakpoint()

    if (breakpoint === 'mobile') {
        return (
            <View className="flex-1 bg-background" style={{ height: '100vh' as never }}>
                <SkeletonMain />
                <SkeletonTabBar />
            </View>
        )
    }

    return (
        <View className="flex-1 flex-row bg-background" style={{ height: '100vh' as never }}>
            <SkeletonRail />
            <SkeletonSidebar width={SIDEBAR_WIDTH} />
            <SkeletonMain />
        </View>
    )
}
