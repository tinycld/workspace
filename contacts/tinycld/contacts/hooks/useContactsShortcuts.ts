import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { type Shortcut, useRegisterShortcuts, useShortcutScope } from '@tinycld/core/lib/shortcuts'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useRef } from 'react'
import { useContactsUIStore } from '../stores/contacts-ui-store'

interface ContactItem {
    id: string
}

interface UseContactsShortcutsArgs {
    items: ContactItem[]
    isEnabled: boolean
    /** Identifier for the current listing — resets focus when it changes. */
    listKey: string
}

export function useContactsShortcuts({ items, isEnabled, listKey }: UseContactsShortcutsArgs) {
    const storedIndex = useContactsUIStore((s) => s.focusedIndex)
    const hasFocus = useContactsUIStore((s) => s.hasFocus)
    const setFocusedIndex = useContactsUIStore((s) => s.setFocusedIndex)
    const clearFocus = useContactsUIStore((s) => s.clearFocus)
    const router = useRouter()
    const orgHref = useOrgHref()

    useShortcutScope('list')

    // Reset focus when the listing identity changes. Done in an effect so the
    // store update doesn't fire during render (which trips React's
    // "cannot update a component while rendering" guard).
    const prevListKeyRef = useRef(listKey)
    useEffect(() => {
        if (listKey !== prevListKeyRef.current) {
            prevListKeyRef.current = listKey
            clearFocus()
        }
    }, [listKey, clearFocus])

    const focusedIndex = items.length === 0 ? 0 : Math.min(storedIndex, items.length - 1)
    // Only expose focusedId when the user has affirmatively engaged keyboard
    // navigation; otherwise rows render without the focus indicator.
    const focusedId = hasFocus ? (items[focusedIndex]?.id ?? null) : null

    const shortcuts = useMemo<Shortcut[]>(() => {
        if (!isEnabled) return []
        const lastIndex = Math.max(items.length - 1, 0)
        // First j/k from no-focus lands on row 0 instead of advancing past it.
        const next = () =>
            hasFocus ? setFocusedIndex((i) => Math.min(i + 1, lastIndex)) : setFocusedIndex(0)
        const prev = () => (hasFocus ? setFocusedIndex((i) => Math.max(i - 1, 0)) : setFocusedIndex(0))
        return [
            {
                id: 'contacts.list.next',
                keys: 'j',
                scope: 'list',
                group: 'Contacts',
                description: 'Next contact',
                run: next,
            },
            {
                id: 'contacts.list.prev',
                keys: 'k',
                scope: 'list',
                group: 'Contacts',
                description: 'Previous contact',
                run: prev,
            },
            {
                id: 'contacts.list.open',
                keys: 'Enter',
                scope: 'list',
                group: 'Contacts',
                description: 'Open contact',
                run: () => {
                    if (!focusedId) return
                    router.push(orgHref('contacts/[id]', { id: focusedId }))
                },
            },
            {
                id: 'contacts.list.new',
                keys: 'c',
                scope: 'list',
                group: 'Contacts',
                description: 'New contact',
                run: () => router.push(orgHref('contacts/new')),
            },
        ]
    }, [isEnabled, items.length, hasFocus, focusedId, orgHref, router, setFocusedIndex])

    useRegisterShortcuts(shortcuts)

    return { focusedIndex, focusedId }
}
