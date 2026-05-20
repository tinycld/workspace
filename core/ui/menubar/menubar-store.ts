import { useOpenMenuStore } from './open-menu-store'

// Selectors against the shared open-menu registry. Top-level menubar
// menus participate in the same single-open pool as the toolbar
// pickers — opening one closes whichever was open elsewhere — but the
// hover-swap behavior still needs to know whether the *currently open*
// menu is itself a menubar menu, so it can hand off to a sibling.

const MENUBAR_PREFIX = 'menubar:'

export function menuBarRegistryId(menuId: string): string {
    return `${MENUBAR_PREFIX}${menuId}`
}

export function useOpenMenuBarId(): string | null {
    return useOpenMenuStore(s => {
        if (s.openId == null) return null
        if (!s.openId.startsWith(MENUBAR_PREFIX)) return null
        return s.openId.slice(MENUBAR_PREFIX.length)
    })
}

export function useIsMenuBarOpen(menuId: string): boolean {
    const registryId = menuBarRegistryId(menuId)
    return useOpenMenuStore(s => s.openId === registryId)
}
