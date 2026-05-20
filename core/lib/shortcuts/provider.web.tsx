import { type ReactNode, useEffect, useRef } from 'react'
import { tinykeys } from 'tinykeys'
import { atomsForShortcuts, createMatcher } from './matcher'
import { useShortcutRegistry } from './registry'

export interface ShortcutsProviderProps {
    children: ReactNode
}

/**
 * Is the currently-focused element a text input? The matcher skips most
 * shortcuts when this is true (unless `allowInInputs` is set on the shortcut).
 */
function isFocusInInput(): boolean {
    const el = document.activeElement as HTMLElement | null
    if (!el) return false
    const tag = el.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (el.isContentEditable) return true
    if (el.closest?.('.ProseMirror')) return true
    return false
}

export function ShortcutsProvider({ children }: ShortcutsProviderProps) {
    const matcherRef = useRef(createMatcher())

    // Rebind tinykeys whenever the set of unique single atoms changes. We
    // diff by the sorted atom list so adding or removing a shortcut that
    // shares atoms with an existing one doesn't force a rebind.
    const atomsKey = useShortcutRegistry(state => {
        return atomsForShortcuts(state.shortcuts.values()).sort().join('|')
    })

    useEffect(() => {
        const atoms = atomsKey ? atomsKey.split('|') : []
        if (atoms.length === 0) return

        const bindings: Record<string, (event: KeyboardEvent) => void> = {}
        for (const atom of atoms) {
            bindings[atom] = event => {
                const consumed = matcherRef.current.feedAtom(atom, {
                    inInput: isFocusInInput(),
                })
                if (consumed) event.preventDefault()
            }
        }

        return tinykeys(window, bindings)
    }, [atomsKey])

    return <>{children}</>
}
