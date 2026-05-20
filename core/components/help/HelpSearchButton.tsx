import { useHelpSearchStore } from '@tinycld/core/lib/help/search-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { HelpCircle } from 'lucide-react-native'
import { Platform, Pressable } from 'react-native'

// Subtle "?" launcher pinned to the right edge of a package toolbar.
// Single responsibility: open the help search palette. The icon stays
// muted-foreground in all states because it's a launcher, not a toggle
// — the palette itself is the only stateful surface.
export function HelpSearchButton() {
    const iconColor = useThemeColor('muted-foreground')
    // Match other toolbar buttons: keep focus inside the host editor
    // when clicked so the editor's selection isn't collapsed.
    const webProps =
        Platform.OS === 'web'
            ? { onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() }
            : {}
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search help"
            onPress={() => useHelpSearchStore.getState().toggle()}
            {...webProps}
            className="rounded-md p-1.5"
        >
            <HelpCircle size={16} color={iconColor} />
        </Pressable>
    )
}
