import { openHelp, openHelpPackage } from '@tinycld/core/lib/help/open-help'
import { useHelpSearchStore } from '@tinycld/core/lib/help/search-store'
import { Menu, MenuBarMenu, MenuShortcut, Separator } from '@tinycld/core/ui/menubar'
import { Platform } from 'react-native'
import type { MenuBarProps } from './MenuBar'

// The Help menu is glanceable on purpose: one global search entry,
// one direct link to the highest-traffic reference (keyboard
// shortcuts), and a breadcrumb to the full topic index. Per-topic
// entries live in the search palette now — listing them inline made
// the menu a wall of text.
export function HelpMenu(_props: MenuBarProps) {
    return (
        <MenuBarMenu menuId="help" label="Help">
            <Menu.Item onPress={() => useHelpSearchStore.getState().open()}>
                <Menu.ItemTitle>Search help…</Menu.ItemTitle>
                {Platform.OS === 'web' && <MenuShortcut keys="⌘/" />}
            </Menu.Item>
            <Menu.Item onPress={() => openHelp('text:keyboard-shortcuts')}>
                <Menu.ItemTitle>Keyboard shortcuts</Menu.ItemTitle>
            </Menu.Item>
            <Separator />
            <Menu.Item onPress={() => openHelpPackage('text')}>
                <Menu.ItemTitle>Browse text help</Menu.ItemTitle>
            </Menu.Item>
        </MenuBarMenu>
    )
}
