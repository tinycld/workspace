import type { EditorCommands } from '@tinycld/core/lib/editor/types'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import {
    Grid3x3,
    Minus,
    Plus,
    Square,
    SquareDashed,
    SquareDot,
    type LucideIcon,
} from 'lucide-react-native'
import { useState } from 'react'
import { Modal, Platform, Pressable, Text, TextInput, View } from 'react-native'
import type { CellBorderPreset, CellBorderStyle } from '../lib/cell-borders'

interface BorderMenuProps {
    isOpen: boolean
    onClose: () => void
    commands: EditorCommands
}

interface PresetButton {
    id: CellBorderPreset
    label: string
    Icon: LucideIcon
}

// The 3×3 preset grid matches the Google Docs / Word "borders" picker:
//   row 1: all          inner         outer
//   row 2: horizontal   vertical      none
//   row 3: top          bottom        left/right (paired)
//
// We use a 3×3 of buttons plus a final "side" picker row because
// Word's grid uses iconic glyphs that don't all map cleanly to lucide
// icons. The label under each button keeps it obvious which is which.
const PRESETS: PresetButton[] = [
    { id: 'all', label: 'All', Icon: Grid3x3 },
    { id: 'inner', label: 'Inner', Icon: SquareDot },
    { id: 'outer', label: 'Outer', Icon: Square },
    { id: 'horizontal', label: 'Horizontal', Icon: Minus },
    { id: 'vertical', label: 'Vertical', Icon: Plus },
    { id: 'none', label: 'None', Icon: SquareDashed },
]

const SIDE_PRESETS: PresetButton[] = [
    { id: 'top', label: 'Top', Icon: Minus },
    { id: 'bottom', label: 'Bottom', Icon: Minus },
    { id: 'left', label: 'Left', Icon: Plus },
    { id: 'right', label: 'Right', Icon: Plus },
]

const STYLES: { id: CellBorderStyle; label: string }[] = [
    { id: 'solid', label: 'Solid' },
    { id: 'dashed', label: 'Dashed' },
    { id: 'dotted', label: 'Dotted' },
    { id: 'double', label: 'Double' },
]

// BorderMenu lets the user apply a preset border configuration to the
// currently selected cells. It's a centred Modal — same rationale as
// LinkPopover / TableMenu (no platform-specific popover positioning).
//
// The user picks a preset (top row); the modal closes and the
// setCellBorders command runs against the current selection. The
// style/width/color controls at the bottom modify the next applied
// preset; they persist in component state for the lifetime of the
// modal so a user can experiment without re-opening.
export function BorderMenu({ isOpen, onClose, commands }: BorderMenuProps) {
    const [style, setStyle] = useState<CellBorderStyle>('solid')
    const [widthPx, setWidthPx] = useState('1')
    const [color, setColor] = useState('')
    const fg = useThemeColor('foreground')
    const placeholderColor = useThemeColor('field-placeholder')

    if (!isOpen) return null

    const apply = (preset: CellBorderPreset) => {
        const parsedWidth = Number.parseInt(widthPx, 10)
        commands.setCellBorders?.(preset, {
            style,
            widthPx: Number.isFinite(parsedWidth) && parsedWidth > 0 ? parsedWidth : 1,
            color: color.trim() === '' ? null : color.trim(),
        })
        onClose()
    }

    return (
        <Modal transparent animationType="fade" visible={isOpen} onRequestClose={onClose}>
            <Pressable className="flex-1 items-center justify-center bg-black/30" onPress={onClose}>
                <Pressable className="w-[340px] gap-3 p-4 rounded-lg bg-background border border-border">
                    <Text className="text-sm font-semibold text-foreground">Cell borders</Text>

                    <View className="flex-row flex-wrap gap-2">
                        {PRESETS.map(p => (
                            <PresetTile key={p.id} preset={p} onPress={() => apply(p.id)} />
                        ))}
                    </View>

                    <Text className="text-xs font-medium text-muted-foreground mt-1">
                        Single edge
                    </Text>
                    <View className="flex-row gap-2">
                        {SIDE_PRESETS.map(p => (
                            <PresetTile key={p.id} preset={p} onPress={() => apply(p.id)} />
                        ))}
                    </View>

                    <View className="h-px bg-border my-1" />

                    <Text className="text-xs font-medium text-muted-foreground">Style</Text>
                    <View className="flex-row flex-wrap gap-1">
                        {STYLES.map(s => (
                            <StyleChip
                                key={s.id}
                                label={s.label}
                                isActive={style === s.id}
                                onPress={() => setStyle(s.id)}
                            />
                        ))}
                    </View>

                    <View className="flex-row gap-2">
                        <View className="flex-1">
                            <Text className="text-xs text-muted-foreground mb-1">Width (px)</Text>
                            <TextInput
                                value={widthPx}
                                onChangeText={setWidthPx}
                                placeholder="1"
                                placeholderTextColor={placeholderColor}
                                keyboardType="number-pad"
                                className="px-2 py-1.5 rounded-md border border-border bg-field-background"
                                style={{ color: fg }}
                            />
                        </View>
                        <View className="flex-1">
                            <Text className="text-xs text-muted-foreground mb-1">
                                Color (CSS)
                            </Text>
                            <TextInput
                                value={color}
                                onChangeText={setColor}
                                placeholder="#000 or theme"
                                placeholderTextColor={placeholderColor}
                                autoCapitalize="none"
                                autoCorrect={false}
                                className="px-2 py-1.5 rounded-md border border-border bg-field-background"
                                style={{ color: fg }}
                            />
                        </View>
                    </View>

                    <View className="flex-row justify-end gap-2 mt-1">
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Cancel"
                            onPress={onClose}
                            className="px-3 py-1.5 rounded-md bg-surface-secondary"
                        >
                            <Text className="text-sm text-foreground">Cancel</Text>
                        </Pressable>
                    </View>
                </Pressable>
            </Pressable>
        </Modal>
    )
}

function PresetTile({ preset, onPress }: { preset: PresetButton; onPress: () => void }) {
    const fg = useThemeColor('foreground')
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Apply ${preset.label} borders`}
            onPress={onPress}
            className="w-[88px] gap-1 items-center px-2 py-2 rounded-md border border-border hover:bg-surface-secondary"
            hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
        >
            <preset.Icon size={20} color={fg} />
            <Text className="text-xs text-foreground">{preset.label}</Text>
        </Pressable>
    )
}

function StyleChip({
    label,
    isActive,
    onPress,
}: {
    label: string
    isActive: boolean
    onPress: () => void
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label} style`}
            accessibilityState={{ selected: isActive }}
            onPress={onPress}
            className={`px-2.5 py-1 rounded-md border ${
                isActive ? 'border-accent bg-accent/10' : 'border-border'
            }`}
        >
            <Text className={`text-xs ${isActive ? 'text-accent' : 'text-foreground'}`}>
                {label}
            </Text>
        </Pressable>
    )
}
