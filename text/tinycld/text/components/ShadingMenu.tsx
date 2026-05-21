import type { EditorCommands } from '@tinycld/core/lib/editor/types'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Ban } from 'lucide-react-native'
import { Modal, Platform, Pressable, Text, View } from 'react-native'
import { CELL_SHADING_PALETTE, type CellShadingOption } from '../lib/cell-shading'

interface ShadingMenuProps {
    isOpen: boolean
    onClose: () => void
    commands: EditorCommands
}

// ShadingMenu lets the user paint the selected table cells with a
// background color from a curated palette. Selecting "None" clears
// the shading attr (cell falls back to the editor's default
// transparent background).
//
// Centred Modal pattern mirrors BorderMenu / LinkPopover — keeps the
// menu platform-agnostic (no native popover positioning to worry
// about) and reuses the dimmed backdrop dismiss behaviour.
export function ShadingMenu({ isOpen, onClose, commands }: ShadingMenuProps) {
    if (!isOpen) return null

    const apply = (option: CellShadingOption) => {
        commands.setCellShading?.(option.value)
        onClose()
    }

    return (
        <Modal transparent animationType="fade" visible={isOpen} onRequestClose={onClose}>
            <Pressable className="flex-1 items-center justify-center bg-black/30" onPress={onClose}>
                <Pressable className="w-[280px] gap-3 p-4 rounded-lg bg-background border border-border">
                    <Text className="text-sm font-semibold text-foreground">Cell shading</Text>
                    <View className="flex-row flex-wrap gap-2">
                        {CELL_SHADING_PALETTE.map(option => (
                            <ShadingSwatch
                                key={option.label}
                                option={option}
                                onPress={() => apply(option)}
                            />
                        ))}
                    </View>
                </Pressable>
            </Pressable>
        </Modal>
    )
}

function ShadingSwatch({
    option,
    onPress,
}: {
    option: CellShadingOption
    onPress: () => void
}) {
    const border = useThemeColor('border')
    const mutedFg = useThemeColor('muted-foreground')
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Apply ${option.label} shading`}
            onPress={onPress}
            className="w-[56px] gap-1 items-center"
            hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
        >
            <Swatch color={option.value} border={border} mutedFg={mutedFg} />
            <Text className="text-[10px] text-foreground text-center">{option.label}</Text>
        </Pressable>
    )
}

function Swatch({
    color,
    border,
    mutedFg,
}: {
    color: string | null
    border: string
    mutedFg: string
}) {
    if (color === null) {
        return (
            <View
                className="w-8 h-8 rounded-md items-center justify-center"
                style={{ borderWidth: 1, borderColor: border }}
            >
                <Ban size={16} color={mutedFg} />
            </View>
        )
    }
    return (
        <View
            className="w-8 h-8 rounded-md"
            style={{ backgroundColor: color, borderWidth: 1, borderColor: border }}
        />
    )
}
