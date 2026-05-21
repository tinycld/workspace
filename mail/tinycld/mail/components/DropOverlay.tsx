import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Paperclip } from 'lucide-react-native'
import { Text, View } from 'react-native'

interface DropOverlayProps {
    isVisible: boolean
}

export function DropOverlay({ isVisible }: DropOverlayProps) {
    // Lucide icons render via react-native-svg which doesn't inherit color from
    // a parent className — pass the resolved token directly.
    const accentColor = useThemeColor('accent-foreground')
    if (!isVisible) return null
    return (
        <View
            pointerEvents="none"
            className="absolute top-0 left-0 right-0 bottom-0 z-[100] items-center justify-center bg-accent/20 border-2 border-dashed border-accent-foreground rounded-lg"
        >
            <View className="items-center gap-2">
                <Paperclip size={28} color={accentColor} />
                <Text className="text-base font-semibold text-accent-foreground">Drop files to attach</Text>
            </View>
        </View>
    )
}
