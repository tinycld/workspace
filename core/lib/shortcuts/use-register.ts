import { useEffect } from 'react'
import { useShortcutRegistry } from './registry'
import type { Shortcut } from './types'

/**
 * Register a shortcut for the lifetime of the component. Pass a stable
 * `Shortcut` object (e.g. memoised or module-level) to avoid re-registering
 * on every render.
 */
export function useRegisterShortcut(shortcut: Shortcut | null | false | undefined) {
    const register = useShortcutRegistry(s => s.register)
    const unregister = useShortcutRegistry(s => s.unregister)

    useEffect(() => {
        if (!shortcut) return
        register(shortcut)
        return () => unregister(shortcut.id)
    }, [shortcut, register, unregister])
}

/**
 * Register multiple shortcuts. The array identity is tracked; pass a stable
 * array (module-level or `useMemo`) to avoid thrash.
 */
export function useRegisterShortcuts(shortcuts: Shortcut[]) {
    const register = useShortcutRegistry(s => s.register)
    const unregister = useShortcutRegistry(s => s.unregister)

    useEffect(() => {
        for (const s of shortcuts) register(s)
        return () => {
            for (const s of shortcuts) unregister(s.id)
        }
    }, [shortcuts, register, unregister])
}
