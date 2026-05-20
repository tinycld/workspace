import { useWorkspaceStore } from '@tinycld/core/lib/stores/workspace-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useOrgSlug } from '@tinycld/core/lib/use-org-slug'
import { useSortedPackages } from '@tinycld/core/lib/use-sorted-packages'
import { useRouter } from 'expo-router'
import { Ellipsis } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getIcon } from './package-icon-map'

export const MAX_VISIBLE_TABS = 4

export function MobileTabBar() {
    const railBg = useThemeColor('rail-background')
    const railText = useThemeColor('rail-text')
    const railActive = useThemeColor('rail-active-text')
    const indicatorColor = useThemeColor('active-indicator')
    const sorted = useSortedPackages()
    const activePkgSlug = useWorkspaceStore(s => s.activePkgSlug)
    const isMoreOpen = useWorkspaceStore(s => s.isMoreOpen)
    const setMoreOpen = useWorkspaceStore(s => s.setMoreOpen)
    const router = useRouter()
    const insets = useSafeAreaInsets()
    const orgSlug = useOrgSlug()

    const visiblePkgs =
        sorted.length > MAX_VISIBLE_TABS ? sorted.slice(0, MAX_VISIBLE_TABS) : sorted

    return (
        <View
            className="flex-row pt-2 pb-1 border-t border-border items-center z-10"
            style={{
                backgroundColor: railBg,
                paddingBottom: insets.bottom,
            }}
        >
            {visiblePkgs.map(pkg => {
                const Icon = getIcon(pkg.nav?.icon ?? '')
                const isActive = activePkgSlug === pkg.slug
                const color = isActive ? railActive : railText
                return (
                    <Pressable
                        key={pkg.slug}
                        testID={`nav-${pkg.slug}`}
                        className="flex-1 items-center justify-center gap-1 py-1 relative"
                        onPress={() => {
                            setMoreOpen(false)
                            router.push(`/a/${orgSlug}/${pkg.slug}`)
                        }}
                        accessibilityLabel={pkg.nav?.label}
                    >
                        {isActive ? (
                            <View
                                className="absolute -top-1 w-6 h-[3px] rounded-sm"
                                style={{ backgroundColor: indicatorColor }}
                            />
                        ) : null}
                        <Icon size={22} color={color} />
                        <Text className="text-[10px] font-medium" style={{ color }}>
                            {pkg.nav?.label}
                        </Text>
                    </Pressable>
                )
            })}
            <Pressable
                testID="nav-more"
                className="flex-1 items-center justify-center gap-1 py-1 relative"
                onPress={() => setMoreOpen(!isMoreOpen)}
                accessibilityLabel="More"
            >
                <Ellipsis size={22} color={railText} />
                <Text className="text-[10px] font-medium" style={{ color: railText }}>
                    More
                </Text>
            </Pressable>
        </View>
    )
}
