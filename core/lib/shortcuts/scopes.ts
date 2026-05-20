import { useEffect } from 'react'
import type { Scope } from './types'

const stack: { id: number; scope: Scope }[] = []
let nextId = 1

export function pushScope(scope: Scope): number {
    const id = nextId++
    stack.push({ id, scope })
    return id
}

export function popScope(id: number) {
    const idx = stack.findIndex(e => e.id === id)
    if (idx !== -1) stack.splice(idx, 1)
}

export function topScope(): Scope | null {
    return stack.length > 0 ? stack[stack.length - 1].scope : null
}

/** Reset all scope state — for use in tests only. */
export function resetScopes() {
    stack.length = 0
    nextId = 1
}

/**
 * Push a scope onto the stack for the lifetime of the mounted component.
 * The matcher fires a shortcut only when its scope === 'global' or matches
 * the top of the stack.
 */
export function useShortcutScope(scope: Scope) {
    useEffect(() => {
        const id = pushScope(scope)
        return () => popScope(id)
    }, [scope])
}
