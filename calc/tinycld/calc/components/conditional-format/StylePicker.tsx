// Compact style picker for a CF rule's format. v1 supports the same
// surface Sheets' single-color rule offers: bold / italic / underline /
// strike toggles plus font-color and fill-color swatches.
//
// State management: the parent owns the CellStyle; this component is a
// view + onChange. Helpers compose a patched style by spreading the
// current value and toggling the requested attribute.

import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Bold, Italic, Strikethrough, Underline } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { COLOR_PALETTE } from '../toolbar/ColorPickerMenu'
import type { CellStyle } from '../../lib/workbook-types'

interface StylePickerProps {
    style: CellStyle
    onChange: (next: CellStyle) => void
    disabled?: boolean
}

export function StylePicker({ style, onChange, disabled }: StylePickerProps) {
    const fg = useThemeColor('foreground')
    const muted = useThemeColor('muted-foreground')

    const bold = style.font?.bold === true
    const italic = style.font?.italic === true
    const underline = style.font?.underline === true
    const strike = style.font?.strike === true
    const fontColor = style.font?.color
    const fillColor = style.fill?.fgColor ?? style.fill?.bgColor

    const setFontFlag = (key: 'bold' | 'italic' | 'underline' | 'strike', value: boolean) => {
        onChange({
            ...style,
            font: { ...(style.font ?? {}), [key]: value || undefined },
        })
    }
    const setFontColor = (color: string | undefined) => {
        onChange({
            ...style,
            font: { ...(style.font ?? {}), color: color || undefined },
        })
    }
    const setFillColor = (color: string | undefined) => {
        if (color == null || color === '') {
            // Clear fill entirely so the cell falls back to its base style.
            const { fill: _drop, ...rest } = style
            onChange(rest)
            return
        }
        onChange({
            ...style,
            fill: { type: 'pattern', pattern: 'solid', fgColor: color, bgColor: color },
        })
    }

    return (
        <View className="rounded border border-border p-2">
            <View className="flex-row items-center gap-1">
                <ToggleButton
                    label="Bold"
                    icon={<Bold size={14} color={bold ? fg : muted} />}
                    isOn={bold}
                    disabled={disabled}
                    onPress={() => setFontFlag('bold', !bold)}
                />
                <ToggleButton
                    label="Italic"
                    icon={<Italic size={14} color={italic ? fg : muted} />}
                    isOn={italic}
                    disabled={disabled}
                    onPress={() => setFontFlag('italic', !italic)}
                />
                <ToggleButton
                    label="Underline"
                    icon={<Underline size={14} color={underline ? fg : muted} />}
                    isOn={underline}
                    disabled={disabled}
                    onPress={() => setFontFlag('underline', !underline)}
                />
                <ToggleButton
                    label="Strikethrough"
                    icon={<Strikethrough size={14} color={strike ? fg : muted} />}
                    isOn={strike}
                    disabled={disabled}
                    onPress={() => setFontFlag('strike', !strike)}
                />
            </View>
            <View className="mt-3">
                <Text className="mb-1 text-xs text-muted-foreground">Text color</Text>
                <ColorSwatchGrid
                    selected={fontColor}
                    onSelect={setFontColor}
                    disabled={disabled}
                />
            </View>
            <View className="mt-3">
                <Text className="mb-1 text-xs text-muted-foreground">Fill color</Text>
                <ColorSwatchGrid
                    selected={fillColor}
                    onSelect={setFillColor}
                    disabled={disabled}
                />
            </View>
        </View>
    )
}

interface ToggleButtonProps {
    label: string
    icon: React.ReactNode
    isOn: boolean
    disabled?: boolean
    onPress: () => void
}

function ToggleButton({ label, icon, isOn, disabled, onPress }: ToggleButtonProps) {
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityLabel={label}
            className="rounded border border-border px-2 py-1"
            style={{
                backgroundColor: isOn ? 'rgba(34, 160, 107, 0.15)' : 'transparent',
                opacity: disabled ? 0.5 : 1,
            }}
        >
            {icon}
        </Pressable>
    )
}

interface ColorSwatchGridProps {
    selected: string | undefined
    onSelect: (color: string | undefined) => void
    disabled?: boolean
}

function ColorSwatchGrid({ selected, onSelect, disabled }: ColorSwatchGridProps) {
    const border = useThemeColor('border')
    return (
        <View className="flex-row flex-wrap gap-1">
            <Pressable
                onPress={() => onSelect(undefined)}
                disabled={disabled}
                accessibilityLabel="Default color"
                style={{
                    width: 18,
                    height: 18,
                    borderRadius: 2,
                    borderWidth: 1,
                    borderColor: border,
                    backgroundColor: 'transparent',
                    opacity: disabled ? 0.5 : 1,
                }}
            />
            {COLOR_PALETTE.map((c) => (
                <Pressable
                    key={c.hex}
                    onPress={() => onSelect(c.hex)}
                    disabled={disabled}
                    accessibilityLabel={c.label}
                    style={{
                        width: 18,
                        height: 18,
                        borderRadius: 2,
                        borderWidth: selected?.toLowerCase() === c.hex.toLowerCase() ? 2 : 1,
                        borderColor:
                            selected?.toLowerCase() === c.hex.toLowerCase() ? '#22a06b' : border,
                        backgroundColor: c.hex,
                        opacity: disabled ? 0.5 : 1,
                    }}
                />
            ))}
        </View>
    )
}
