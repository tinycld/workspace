import { create } from '@tinycld/core/lib/store'
import type { Shortcut } from './types'

interface RegistryState {
    shortcuts: Map<string, Shortcut>
    register: (shortcut: Shortcut) => void
    unregister: (id: string) => void
}

export const useShortcutRegistry = create<RegistryState>(set => ({
    shortcuts: new Map(),
    register: shortcut =>
        set(state => {
            const next = new Map(state.shortcuts)
            next.set(shortcut.id, shortcut)
            return { shortcuts: next }
        }),
    unregister: id =>
        set(state => {
            if (!state.shortcuts.has(id)) return state
            const next = new Map(state.shortcuts)
            next.delete(id)
            return { shortcuts: next }
        }),
}))

export function getShortcuts(): Map<string, Shortcut> {
    return useShortcutRegistry.getState().shortcuts
}
