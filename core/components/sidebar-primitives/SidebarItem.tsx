import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { useWorkspaceStore } from '@tinycld/core/lib/stores/workspace-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import type { LucideIcon } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'

interface SidebarItemProps {
    label: string
    icon?: LucideIcon
    colorDot?: string
    isActive?: boolean
    badge?: string | number
    closesDrawer?: boolean
    onPress?: () => void
}

export function SidebarItem({
    label,
    icon: Icon,
    colorDot,
    isActive,
    badge,
    closesDrawer,
    onPress,
}: SidebarItemProps) {
    const activeIndicatorColor = useThemeColor('active-indicator')
    const mutedColor = useThemeColor('muted-foreground')
    const setDrawerOpen = useWorkspaceStore(s => s.setDrawerOpen)
    const isMobile = useBreakpoint() === 'mobile'

    const handlePress = () => {
        onPress?.()
        if (closesDrawer && isMobile) {
            setTimeout(() => setDrawerOpen(false), 500)
        }
    }

    return (
        <Pressable
            onPress={handlePress}
            className="flex-row items-center gap-2.5 px-3 py-2 rounded-lg"
            style={isActive ? { backgroundColor: `${activeIndicatorColor}18` } : undefined}
        >
            {colorDot ? (
                <View
                    style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: colorDot,
                    }}
                />
            ) : Icon ? (
                <Icon size={18} color={isActive ? activeIndicatorColor : mutedColor} />
            ) : null}
            <Text
                numberOfLines={1}
                className={`flex-1 text-sm ${isActive ? 'font-semibold' : 'text-foreground'}`}
                style={isActive ? { color: activeIndicatorColor } : undefined}
            >
                {label}
            </Text>
            {badge != null && (
                <View
                    style={{
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderRadius: 10,
                        minWidth: 22,
                        alignItems: 'center',
                        backgroundColor: `${mutedColor}30`,
                    }}
                >
                    <Text className="text-[11px] font-semibold text-muted-foreground">{badge}</Text>
                </View>
            )}
        </Pressable>
    )
}
