import { ChevronDown, ChevronUp, X } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'

// Bare field chip rendered inside a panel slot (Rows / Cols / Filters).
// Has a label and three action buttons: move-up, move-down, remove. The
// plan sidesteps drag-and-drop primitives entirely — the panel reorders
// fields through arrow buttons so we don't have to wire RNGH gestures
// into the pivot editor. The parent owns the disabled-edge logic
// (canMoveUp / canMoveDown) so we can render the same component at the
// top and bottom of the list.
export interface FieldRowProps {
    label: string
    canMoveUp: boolean
    canMoveDown: boolean
    onMoveUp: () => void
    onMoveDown: () => void
    onRemove: () => void
    disabled?: boolean
}

export function FieldRow({
    label,
    canMoveUp,
    canMoveDown,
    onMoveUp,
    onMoveDown,
    onRemove,
    disabled,
}: FieldRowProps) {
    const iconColor = useThemeColor('muted-foreground')
    return (
        <View className="flex-row items-center justify-between rounded-md border border-border bg-surface-secondary px-3 py-2">
            <Text className="flex-1 text-sm text-foreground">{label}</Text>
            <View className="flex-row items-center gap-1">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Move up"
                    disabled={disabled || !canMoveUp}
                    onPress={onMoveUp}
                    className="rounded-md p-1"
                >
                    <ChevronUp size={14} color={iconColor} />
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Move down"
                    disabled={disabled || !canMoveDown}
                    onPress={onMoveDown}
                    className="rounded-md p-1"
                >
                    <ChevronDown size={14} color={iconColor} />
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove field"
                    disabled={disabled}
                    onPress={onRemove}
                    className="rounded-md p-1"
                >
                    <X size={14} color={iconColor} />
                </Pressable>
            </View>
        </View>
    )
}
