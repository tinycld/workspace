import { Menu } from '@tinycld/core/ui/menu'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { MenuBarTrigger } from './MenuBarTrigger'
import { menuBarRegistryId, useIsMenuBarOpen } from './menubar-store'
import { useOpenMenuStore } from './open-menu-store'

interface MenuBarMenuProps {
    menuId: string
    label: string
    children: ReactNode
}

// MenuBarMenu binds one top-level menu to the shared open-menu
// registry. All menubar menus on screen consume the same controlled
// state so that:
//   1. Clicking another trigger (or any toolbar dropdown) while one
//      is open swaps cleanly — opening any menu in the registry
//      implicitly closes whichever was open before.
//   2. Hovering another menubar trigger while one is open swaps
//      without clicking (see MenuBarTrigger's onHoverIn).
//   3. A document-level outside-click handler (mounted via
//      useOpenMenuOutsideClick at the screen root) closes the
//      active menu without each menu rendering its own Menu.Overlay
//      (which would intercept clicks on sibling triggers and break
//      the swap behavior).
//
// The data-tinycld-menu="content" wrapper marks Menu.Content's
// portaled subtree as "part of a tinycld menu", so the document
// handler can recognise clicks that should NOT close (e.g. clicking
// a Menu.Item or a Menu.SubTrigger inside the popover).
export function MenuBarMenu({ menuId, label, children }: MenuBarMenuProps) {
    const isOpen = useIsMenuBarOpen(menuId)
    const open = useOpenMenuStore(s => s.open)
    const close = useOpenMenuStore(s => s.close)
    const registryId = menuBarRegistryId(menuId)

    return (
        <Menu isOpen={isOpen} onOpenChange={next => (next ? open(registryId) : close())}>
            <MenuBarTrigger label={label} menuId={menuId} />
            <Menu.Portal>
                <Menu.Content placement="bottom" align="start">
                    <View
                        {...(typeof document !== 'undefined'
                            ? { 'data-tinycld-menu': 'content' }
                            : {})}
                    >
                        {children}
                    </View>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
