import type { EditorCommands } from '@tinycld/core/lib/editor/types'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ChevronDown } from 'lucide-react-native'
import { useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { cssFamily, FONT_FAMILY_OPTIONS, type FontOption } from '../lib/font-options'

export { FONT_FAMILY_OPTIONS, type FontOption } from '../lib/font-options'
// cssFamily is the render-side helper that pairs a stored bare family name
// with its generic fallback. Storage on the textStyle mark is bare ("Georgia")
// so that the DOCX <w:rFonts w:ascii> attr is a single resolvable name —
// fallback chains live only in CSS output.

interface FontFamilyPickerProps {
    currentFamily: string | null
    commands: EditorCommands
    disabled?: boolean
}

const DEFAULT_LABEL = 'Default'

// Pre-computed map for fast lookup in the trigger label. Falls back to
// "Default" rendering when the active family isn't in the curated set
// — that's possible if a Word import carried in an unknown name.
const OPTION_BY_NAME = new Map(FONT_FAMILY_OPTIONS.map(o => [o.name, o]))

export function FontFamilyPicker({
    currentFamily,
    commands,
    disabled = false,
}: FontFamilyPickerProps) {
    const [open, setOpen] = useState(false)
    const fg = useThemeColor('foreground')
    const muted = useThemeColor('muted-foreground')

    // Strip a CSS fallback chain ("Georgia, serif") down to just the head
    // name for the trigger label so docs imported with bare names AND docs
    // touched by older versions of this picker both render cleanly.
    const triggerLabel = currentFamily ? stripFallback(currentFamily) : DEFAULT_LABEL
    const triggerOpacity = disabled ? 0.4 : 1

    const pick = (option: FontOption | null) => {
        setOpen(false)
        if (option == null) {
            commands.unsetFontFamily?.()
            return
        }
        commands.setFontFamily?.(option.name)
    }

    const webProps =
        Platform.OS === 'web'
            ? { onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() }
            : {}

    return (
        <View>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Font family"
                accessibilityState={{ expanded: open, disabled }}
                disabled={disabled}
                onPress={() => setOpen(true)}
                {...webProps}
                className="flex-row items-center gap-1 px-2 py-1 rounded-md"
                style={{ opacity: triggerOpacity }}
            >
                <Text className="text-sm text-foreground min-w-[60px]" numberOfLines={1}>
                    {triggerLabel}
                </Text>
                <ChevronDown size={12} color={muted} />
            </Pressable>

            <Modal
                transparent
                animationType="fade"
                visible={open}
                onRequestClose={() => setOpen(false)}
            >
                <Pressable
                    className="flex-1 items-center justify-center bg-black/30"
                    onPress={() => setOpen(false)}
                >
                    <Pressable className="w-[220px] max-h-[360px] rounded-lg bg-background border border-border py-1">
                        <ScrollView>
                            <FamilyRow
                                option={null}
                                isActive={currentFamily == null}
                                onPress={() => pick(null)}
                                color={fg}
                            />
                            {FONT_FAMILY_OPTIONS.map(option => (
                                <FamilyRow
                                    key={option.name}
                                    option={option}
                                    isActive={isOptionActive(option, currentFamily)}
                                    onPress={() => pick(option)}
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

// Pickers since this PR write bare names ("Georgia"), but documents
// authored by an earlier build of this code, or pasted-in content from
// elsewhere, may carry a CSS fallback chain ("Georgia, serif"). Both
// should highlight the Georgia row.
function isOptionActive(option: FontOption, current: string | null): boolean {
    if (!current) return false
    return stripFallback(current) === option.name
}

// stripFallback peels a CSS font-family chain down to the head name,
// dropping any leading/trailing quotes around it. Returns the input
// unchanged when there's no comma.
function stripFallback(value: string): string {
    const head = value.split(',', 1)[0].trim()
    return head.replace(/^['"]/, '').replace(/['"]$/, '')
}

interface FamilyRowProps {
    option: FontOption | null
    isActive: boolean
    onPress: () => void
    color: string
}

function FamilyRow({ option, isActive, onPress, color }: FamilyRowProps) {
    const label = option?.name ?? DEFAULT_LABEL
    const styleFontFamily = option ? cssFamily(option.name, option.fallback) : undefined
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Font ${label}`}
            accessibilityState={{ selected: isActive }}
            onPress={onPress}
            className={`px-3 py-1.5 ${isActive ? 'bg-accent/10' : ''}`}
        >
            <Text
                className="text-sm"
                style={{
                    color,
                    fontFamily: styleFontFamily,
                }}
            >
                {label}
            </Text>
        </Pressable>
    )
}
