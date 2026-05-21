import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Pressable, ScrollView, Text, View } from 'react-native'
import type { AnchoredOverlayProps } from '../lib/anchored-overlay/anchored-overlay-controller'
import { resolveSlashMenuIcon } from '../lib/editor/slash-menu-icon-lookup'
import type { SerializedSlashMenuItem } from '../lib/editor/slash-menu'

// Payload the bridge render strategy puts on every show-popover /
// popover-update message. Mirrors SlashMenu.web.tsx's store shape but
// without the LucideIcon refs (they can't ride the JSON message bus —
// the host re-resolves them from iconName).
interface SlashMenuPopoverPayload {
    items: SerializedSlashMenuItem[]
    query: string
    selectedIndex: number
}

// SlashMenuPopover — the native body for the anchored-overlay
// registry's 'slash-menu' kind. The controller positions and frames
// us; we render the list of commands and respond on tap. Keyboard
// navigation (arrow up/down/enter/escape) is owned by the WebView's
// suggestion plugin, which posts popover-update on each keystroke;
// this component re-renders to reflect the new selectedIndex.
export function SlashMenuPopover({ payload, respond }: AnchoredOverlayProps) {
    const items = (payload as SlashMenuPopoverPayload | null)?.items ?? []
    const selectedIndex = (payload as SlashMenuPopoverPayload | null)?.selectedIndex ?? 0

    if (items.length === 0) {
        // No matches — popover stays open at zero rows so the user
        // can keep typing (or backspace into the trigger). We render
        // an empty wrapper rather than null so the controller's
        // backdrop tap target stays the right size.
        return (
            <View className="rounded-lg border border-border bg-background py-1 overflow-hidden shadow-lg">
                <View className="px-3 py-2">
                    <Text className="text-xs text-muted-foreground">No matches</Text>
                </View>
            </View>
        )
    }

    const handlePress = (id: string) => {
        respond('select', { commandId: id })
    }

    return (
        <View
            className="rounded-lg border border-border bg-background py-1 overflow-hidden shadow-lg"
            accessibilityRole="menu"
            accessibilityLabel="Slash menu"
        >
            <ScrollView keyboardShouldPersistTaps="always">
                {items.map((item, index) => (
                    <SlashMenuPopoverRow
                        key={item.id}
                        item={item}
                        isSelected={index === selectedIndex}
                        onPress={() => handlePress(item.id)}
                    />
                ))}
            </ScrollView>
        </View>
    )
}

interface SlashMenuPopoverRowProps {
    item: SerializedSlashMenuItem
    isSelected: boolean
    onPress: () => void
}

function SlashMenuPopoverRow({ item, isSelected, onPress }: SlashMenuPopoverRowProps) {
    const foregroundColor = useThemeColor('foreground')
    const Icon = resolveSlashMenuIcon(item.iconName)
    return (
        <Pressable
            accessibilityRole="menuitem"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: isSelected }}
            onPress={onPress}
            className={`flex-row items-center gap-2 px-3 py-2 ${
                isSelected ? 'bg-surface-secondary' : 'bg-transparent'
            }`}
        >
            {Icon ? <Icon size={16} color={foregroundColor} /> : null}
            <Text className="text-sm text-foreground">{item.label}</Text>
        </Pressable>
    )
}
