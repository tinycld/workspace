import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import type { LucideIcon } from 'lucide-react-native'
import { forwardRef, useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'

interface SidebarActionButtonProps {
    label: string
    icon?: LucideIcon
    onPress?: () => void
}

export const SidebarActionButton = forwardRef<View, SidebarActionButtonProps>(
    function SidebarActionButton({ label, icon: Icon, onPress }, ref) {
        const primaryColor = useThemeColor('primary')
        const accentFgColor = useThemeColor('accent-foreground')
        const [isHovered, setIsHovered] = useState(false)

        const hoverWebProps =
            Platform.OS === 'web'
                ? {
                      onMouseEnter: () => setIsHovered(true),
                      onMouseLeave: () => setIsHovered(false),
                  }
                : {}

        return (
            <View className="px-3 py-2">
                <Pressable ref={ref} onPress={onPress} {...hoverWebProps}>
                    <View
                        className="flex-row items-center justify-center gap-2 px-5 py-3 rounded-3xl border"
                        style={{
                            borderColor: isHovered ? primaryColor : `${primaryColor}40`,
                            backgroundColor: isHovered ? 'transparent' : `${primaryColor}12`,
                            boxShadow: isHovered ? 'none' : `0 1px 3px ${primaryColor}1A`,
                        }}
                    >
                        {Icon ? <Icon size={16} color={accentFgColor} /> : null}
                        <Text className="text-sm font-semibold text-accent-foreground">
                            {label}
                        </Text>
                    </View>
                </Pressable>
            </View>
        )
    }
)
