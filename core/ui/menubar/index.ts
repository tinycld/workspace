// Re-export the underlying menu compound + Separator so consumers
// only need a single import to declare menubar items.
export { Menu, Separator } from '@tinycld/core/ui/menu'
export { MenuBar } from './MenuBar'
export { MenuBarMenu } from './MenuBarMenu'
export { MenuShortcut } from './MenuShortcut'
export { useIsMenuBarOpen, useOpenMenuBarId } from './menubar-store'
export {
    useOpenMenu,
    useOpenMenuStore,
} from './open-menu-store'
export { useOpenMenuOutsideClick } from './use-open-menu-outside-click'
