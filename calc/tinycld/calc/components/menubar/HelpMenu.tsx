import { openHelp, openHelpPackage } from '@tinycld/core/lib/help/open-help'
import { useHelpSearchStore } from '@tinycld/core/lib/help/search-store'
import { Menu, MenuBarMenu, MenuShortcut, Separator } from '@tinycld/core/ui/menubar'
import { Platform } from 'react-native'

// Glanceable: one search entry, direct links to the two
// highest-traffic reference topics (keyboard shortcuts and the
// function list), and a breadcrumb to the package's topic index.
// Per-topic entries live in the search palette.
export function HelpMenu() {
    return (
        <MenuBarMenu menuId="help" label="Help">
            <Menu.Item onPress={() => useHelpSearchStore.getState().open()}>
                <Menu.ItemTitle>Search help…</Menu.ItemTitle>
                {Platform.OS === 'web' && <MenuShortcut keys="⌘/" />}
            </Menu.Item>
            <Menu.Item onPress={() => openHelp('calc:keyboard-shortcuts')}>
                <Menu.ItemTitle>Keyboard shortcuts</Menu.ItemTitle>
            </Menu.Item>
            <Menu.Item onPress={() => openHelp('calc:functions')}>
                <Menu.ItemTitle>Function list</Menu.ItemTitle>
            </Menu.Item>
            <Separator />
            <Menu.Item onPress={() => openHelpPackage('calc')}>
                <Menu.ItemTitle>Browse calc help</Menu.ItemTitle>
            </Menu.Item>
        </MenuBarMenu>
    )
}
