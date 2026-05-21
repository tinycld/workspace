import type { EditorCommands } from '@tinycld/core/lib/editor/types'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ChevronDown } from 'lucide-react-native'
import { useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { FONT_SIZE_OPTIONS } from '../lib/font-options'

export { FONT_SIZE_OPTIONS } from '../lib/font-options'

interface FontSizePickerProps {
    currentPx: number | null
    commands: EditorCommands
    disabled?: boolean
}

// The label shown on the trigger when no fontSize attr is set. The
// editor's document-level CSS picks whatever the surrounding style
// gives (h1=2em, paragraph=1em, etc.), so "Default" is honest.
const DEFAULT_LABEL = 'Default'

// FontSizePicker renders a trigger button with the current size (or
// "Default") and opens a centred modal list when tapped. Selecting an
// option fires setFontSize/unsetFontSize on the editor commands.
// Mirrors the BorderMenu interaction pattern (Modal + Pressable
// backdrop) so the picker works identically on web and native.
export function FontSizePicker({ currentPx, commands, disabled = false }: FontSizePickerProps) {
    const [open, setOpen] = useState(false)
    const fg = useThemeColor('foreground')
    const muted = useThemeColor('muted-foreground')
    const label = currentPx == null ? DEFAULT_LABEL : `${currentPx}`

    const pick = (px: number | null) => {
        setOpen(false)
        if (px == null) {
            commands.unsetFontSize?.()
            return
        }
        commands.setFontSize?.(px)
    }

    // Stop the mousedown from moving DOM focus off ProseMirror — same
    // rationale as DocumentToolbar's FormatButton: the editor's blur
    // handler collapses its selection on focus loss, so a picker that
    // takes focus would clear the user's selection before its command
    // runs.
    const webProps =
        Platform.OS === 'web'
            ? { onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() }
            : {}

    const triggerOpacity = disabled ? 0.4 : 1

    return (
        <View>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Font size"
                accessibilityState={{ expanded: open, disabled }}
                disabled={disabled}
                onPress={() => setOpen(true)}
                {...webProps}
                className="flex-row items-center gap-1 px-2 py-1 rounded-md"
                style={{ opacity: triggerOpacity }}
            >
                <Text className="text-sm text-foreground min-w-[24px] text-center">{label}</Text>
                <ChevronDown size={12} color={muted} />
            </Pressable>

            <Modal transparent animationType="fade" visible={open} onRequestClose={() => setOpen(false)}>
                <Pressable
                    className="flex-1 items-center justify-center bg-black/30"
                    onPress={() => setOpen(false)}
                >
                    <Pressable className="w-[140px] max-h-[360px] rounded-lg bg-background border border-border py-1">
                        <ScrollView>
                            <SizeRow
                                label={DEFAULT_LABEL}
                                isActive={currentPx == null}
                                onPress={() => pick(null)}
                                color={fg}
                            />
                            {FONT_SIZE_OPTIONS.map(px => (
                                <SizeRow
                                    key={px}
                                    label={`${px}`}
                                    isActive={currentPx === px}
                                    onPress={() => pick(px)}
                                    color={fg}
                                />
                            ))}
                        </ScrollView>
                    </Pressable>
                </Pressable>
            </Modal>
        </View>
    )
}

interface SizeRowProps {
    label: string
    isActive: boolean
    onPress: () => void
    color: string
}

function SizeRow({ label, isActive, onPress, color }: SizeRowProps) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Font size ${label}`}
            accessibilityState={{ selected: isActive }}
            onPress={onPress}
            className={`px-3 py-1.5 ${isActive ? 'bg-accent/10' : ''}`}
        >
            <Text className="text-sm" style={{ color }}>
                {label}
            </Text>
        </Pressable>
    )
}
