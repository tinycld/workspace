import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { openHelp } from '@tinycld/core/lib/help/open-help'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { HelpCircle, Maximize2, Minimize2, X } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import type { ComposeMode } from '../hooks/useComposeState'

interface ComposeHeaderProps {
    mode: ComposeMode
    title?: string
    onMinimize: () => void
    onMaximize: () => void
    onClose: () => void
}

export function ComposeHeader({ mode, title, onMinimize, onMaximize, onClose }: ComposeHeaderProps) {
    const foregroundColor = useThemeColor('foreground')
    const backgroundColor = useThemeColor('background')
    const breakpoint = useBreakpoint()
    const showWindowControls = breakpoint === 'desktop'
    const displayTitle = title?.trim() || 'New Message'

    return (
        <View
            className="flex-row items-center justify-between px-3"
            style={{
                height: 40,
                borderTopLeftRadius: 8,
                borderTopRightRadius: 8,
                backgroundColor: foregroundColor,
            }}
        >
            <Pressable className="flex-1" onPress={mode === 'minimized' ? onMinimize : undefined}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: backgroundColor }} numberOfLines={1}>
                    {displayTitle}
                </Text>
            </Pressable>
            <View className="flex-row items-center gap-1">
                {showWindowControls ? (
                    <>
                        <Pressable className="rounded" style={{ padding: 6 }} onPress={onMinimize}>
                            <Minimize2 size={14} color={backgroundColor} />
                        </Pressable>
                        <Pressable className="rounded" style={{ padding: 6 }} onPress={onMaximize}>
                            <Maximize2 size={14} color={backgroundColor} />
                        </Pressable>
                    </>
                ) : null}
                <Pressable
                    className="rounded"
                    style={{ padding: 6 }}
                    onPress={() => openHelp('mail:composing')}
                    accessibilityRole="button"
                    accessibilityLabel="Open help"
                >
                    <HelpCircle size={14} color={backgroundColor} />
                </Pressable>
                <Pressable className="rounded" style={{ padding: 6 }} onPress={onClose}>
                    <X size={14} color={backgroundColor} />
                </Pressable>
            </View>
        </View>
    )
}
