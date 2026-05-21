import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Platform, Pressable, ScrollView, Text, View } from 'react-native'

interface FormulaSuggestionListProps {
    items: readonly string[]
    selectedIndex: number
    // Position relative to the Grid root. width is optional — the
    // dropdown sizes to its content if omitted.
    anchor: { left: number; top: number; width?: number } | null
    onSelect: (item: string) => void
    onHover: (index: number) => void
}

const webShadow =
    Platform.OS === 'web'
        ? ({ boxShadow: '0 4px 16px rgba(0,0,0,0.18)' } as Record<string, unknown>)
        : {}

// Generic, presentational dropdown for formula function suggestions.
// All keyboard navigation lives in Grid (which routes ↑/↓/Tab/Enter
// from both inputs); this component just renders the items, paints the
// highlighted index, and dispatches mouse/touch hover/selection.
//
// Anchored to absolute coordinates supplied by Grid so the popover can
// float above the cell viewport's overflow:hidden clip — the same
// reason MailRecipientSuggestionList sits in a relative parent doesn't
// apply here, since our anchors come from the formula bar OR a cell
// inside a virtualized scroller.
export function FormulaSuggestionList({
    items,
    selectedIndex,
    anchor,
    onSelect,
    onHover,
}: FormulaSuggestionListProps) {
    const backgroundColor = useThemeColor('background')
    const borderColor = useThemeColor('border')
    const hoverBgColor = useThemeColor('surface-secondary')
    const accentColor = useThemeColor('accent')
    const accentForegroundColor = useThemeColor('accent-foreground')
    const foregroundColor = useThemeColor('foreground')

    if (anchor == null || items.length === 0) return null

    return (
        <View
            accessibilityLabel="Formula suggestions"
            className="absolute border rounded-md overflow-hidden"
            style={{
                left: anchor.left,
                top: anchor.top,
                width: anchor.width,
                minWidth: 140,
                zIndex: 2000,
                borderColor,
                backgroundColor,
                ...webShadow,
            }}
        >
            <ScrollView style={{ maxHeight: 240 }} keyboardShouldPersistTaps="handled">
                {items.map((item, index) => {
                    const isSelected = index === selectedIndex
                    return (
                        <Pressable
                            key={item}
                            onPress={() => onSelect(item)}
                            onHoverIn={Platform.OS === 'web' ? () => onHover(index) : undefined}
                            style={({ pressed }) => ({
                                paddingHorizontal: 10,
                                paddingVertical: 5,
                                backgroundColor: isSelected
                                    ? accentColor
                                    : pressed
                                      ? hoverBgColor
                                      : backgroundColor,
                            })}
                        >
                            <Text
                                style={{
                                    fontSize: 12,
                                    fontFamily: 'monospace',
                                    color: isSelected ? accentForegroundColor : foregroundColor,
                                }}
                            >
                                {item}
                            </Text>
                        </Pressable>
                    )
                })}
            </ScrollView>
        </View>
    )
}
