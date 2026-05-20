import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { packageSettings } from '@tinycld/core/lib/packages/derive-components'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { useNavigateBack } from '@tinycld/core/lib/use-navigate-back'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ArrowLeft } from 'lucide-react-native'
import { Suspense, useMemo } from 'react'
import { Pressable, Text, View } from 'react-native'

export default function PackageSettingsSection() {
    const router = useRouter()
    const { isAdmin } = useCurrentRole()
    const orgHref = useOrgHref()
    const navigateBack = useNavigateBack(() => orgHref('settings'))
    const params = useLocalSearchParams<{ section: string[] }>()
    const segments = params.section ?? []
    const [pkgSlug, panelSlug] = segments

    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const bgColor = useThemeColor('background')
    const primaryColor = useThemeColor('primary')

    const match = useMemo(() => {
        if (!pkgSlug || !panelSlug) return null
        const group = packageSettings.find(g => g.pkgSlug === pkgSlug)
        if (!group) return null
        const panel = group.panels.find(p => p.slug === panelSlug)
        if (!panel) return null
        return { group, panel }
    }, [pkgSlug, panelSlug])

    if (!isAdmin) {
        return (
            <View
                className="flex-1 p-5 items-center justify-center"
                style={{ backgroundColor: bgColor }}
            >
                <Text style={{ fontSize: 16, color: mutedColor }}>
                    Only admins can access package settings.
                </Text>
            </View>
        )
    }

    if (!match) {
        return (
            <View
                className="flex-1 p-5 items-center justify-center"
                style={{ backgroundColor: bgColor }}
            >
                <Text className="mb-3" style={{ fontSize: 18, fontWeight: 'bold', color: fgColor }}>
                    Settings not found
                </Text>
                <Pressable onPress={() => router.push(orgHref('settings'))}>
                    <Text style={{ fontSize: 15, color: primaryColor }}>Back to Settings</Text>
                </Pressable>
            </View>
        )
    }

    const { group, panel } = match
    const PanelComponent = panel.Component

    return (
        <View className="flex-1" style={{ backgroundColor: bgColor }}>
            <View className="flex-row gap-3 items-center p-5 pb-0">
                <Pressable onPress={navigateBack}>
                    <ArrowLeft size={24} color={fgColor} />
                </Pressable>
                <Text style={{ fontSize: 22, fontWeight: 'bold', color: fgColor }}>
                    {panel.label}
                </Text>
                <Text style={{ fontSize: 15, color: mutedColor }}>{group.packageName}</Text>
            </View>
            <View className="flex-1">
                <Suspense fallback={null}>
                    <PanelComponent />
                </Suspense>
            </View>
        </View>
    )
}
