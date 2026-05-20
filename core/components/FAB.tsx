import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import type { LucideIcon } from 'lucide-react-native'
import { Pressable } from 'react-native'

interface FABProps {
    icon: LucideIcon
    onPress: () => void
    accessibilityLabel: string
    isVisible: boolean
    size?: number
    iconSize?: number
}

export function FAB({
    icon: Icon,
    onPress,
    accessibilityLabel,
    isVisible,
    size = 56,
    iconSize = 22,
}: FABProps) {
    const primaryFg = useThemeColor('primary-foreground')

    if (!isVisible) return null

    return (
        <Pressable
            className="absolute items-center justify-center bg-primary"
            style={{
                bottom: 80,
                right: 16,
                width: size,
                height: size,
                borderRadius: size / 2,
                elevation: 4,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.25,
                shadowRadius: 4,
                zIndex: 50,
            }}
            onPress={onPress}
            accessibilityLabel={accessibilityLabel}
        >
            <Icon size={iconSize} color={primaryFg} />
        </Pressable>
    )
}
