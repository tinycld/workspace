import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Ban } from 'lucide-react-native'
import { Platform, Pressable, Text, View } from 'react-native'
import { COLOR_PALETTE, type Swatch } from './palette'

const SWATCH_SIZE = 18
const SWATCH_GAP = 4
const GRID_PADDING = 8
const GRID_COLS = 10

// Width of the rendered grid in CSS px. Exported so menu/popover
// hosts can size their content container to match — avoids
// flex-wrap reflow on first paint.
export const COLOR_PICKER_GRID_WIDTH =
    GRID_COLS * SWATCH_SIZE + (GRID_COLS - 1) * SWATCH_GAP + GRID_PADDING * 2

export interface ColorPickerGridProps {
    selected: string | undefined
    onSelect: (hex: string) => void
    // Optional palette override. Defaults to COLOR_PALETTE (80 swatches
    // in a 10-wide grid). Pass BORDERS_PALETTE (or any narrower set)
    // when the host context needs a compact picker.
    palette?: readonly Swatch[]
    // When true, prepend a Clear row above the grid that calls
    // onSelect(''). Used by calc fill/text pickers — the empty string
    // means "no override; inherit from cell defaults". Label and form
    // contexts where a color is required leave this false.
    showClear?: boolean
    // Optional label for the Clear row. Defaults to "Clear".
    clearLabel?: string
}

// ColorPickerGrid renders the swatch grid and (optionally) a Clear
// row. It is a presentational component — the host is responsible
// for the surrounding popover / menu / dialog container, the
// trigger button, and any state binding.
export function ColorPickerGrid({
    selected,
    onSelect,
    palette = COLOR_PALETTE,
    showClear = false,
    clearLabel = 'Clear',
}: ColorPickerGridProps) {
    const fg = useThemeColor('foreground')
    const border = useThemeColor('border')
    const accent = useThemeColor('accent')

    // hitSlop on native ensures the 18px swatches are still tappable;
    // web's pointer accuracy makes the slop unnecessary (and a non-zero
    // slop confuses hover-state delivery in some browsers).
    const swatchHitSlop =
        Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }

    return (
        <View style={{ padding: GRID_PADDING, gap: 6, width: COLOR_PICKER_GRID_WIDTH }}>
            {showClear ? (
                <>
                    <Pressable
                        onPress={() => onSelect('')}
                        accessibilityLabel={clearLabel}
                        accessibilityRole="button"
                        hitSlop={swatchHitSlop}
                        className="flex-row items-center rounded"
                        style={{ paddingVertical: 6, paddingHorizontal: 4, gap: 8 }}
                    >
                        <Ban size={14} color={fg} />
                        <Text style={{ fontSize: 13, color: fg }}>{clearLabel}</Text>
                    </Pressable>
                    <View style={{ height: 1, backgroundColor: border }} />
                </>
            ) : null}
            <View className="flex-row flex-wrap" style={{ gap: SWATCH_GAP }}>
                {palette.map(swatch => {
                    const isActive = (selected ?? '') === swatch.hex
                    return (
                        <Pressable
                            key={swatch.label}
                            onPress={() => onSelect(swatch.hex)}
                            accessibilityLabel={swatch.label}
                            accessibilityRole="button"
                            hitSlop={swatchHitSlop}
                            style={{
                                width: SWATCH_SIZE,
                                height: SWATCH_SIZE,
                                borderRadius: SWATCH_SIZE / 2,
                                borderWidth: isActive ? 2 : 1,
                                borderColor: isActive ? accent : border,
                                backgroundColor: swatch.hex,
                            }}
                        />
                    )
                })}
            </View>
        </View>
    )
}
