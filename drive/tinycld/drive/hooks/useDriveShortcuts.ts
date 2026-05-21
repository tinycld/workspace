import { type Shortcut, useRegisterShortcuts, useShortcutScope } from '@tinycld/core/lib/shortcuts'
import { useEffect, useMemo, useRef } from 'react'
import { useDriveUIStore } from '../stores/drive-ui-store'
import type { DriveItemView } from '../types'

interface UseDriveShortcutsArgs {
    items: DriveItemView[]
    toggleSelect: (id: string) => void
    openItem: (item: DriveItemView) => void
    onNewFolder: () => void
    isEnabled: boolean
    /** Identifier for the current listing — resets focus when it changes. */
    listKey: string
}

export function useDriveShortcuts({
    items,
    toggleSelect,
    openItem,
    onNewFolder,
    isEnabled,
    listKey,
}: UseDriveShortcutsArgs) {
    const storedIndex = useDriveUIStore((s) => s.focusedIndex)
    const hasFocus = useDriveUIStore((s) => s.hasFocus)
    const setFocusedIndex = useDriveUIStore((s) => s.setFocusedIndex)
    const clearFocus = useDriveUIStore((s) => s.clearFocus)

    useShortcutScope('list')

    // Reset focus when we navigate into a different folder/section. Done in
    // an effect so the store update doesn't fire during render.
    const prevListKeyRef = useRef(listKey)
    useEffect(() => {
        if (listKey !== prevListKeyRef.current) {
            prevListKeyRef.current = listKey
            clearFocus()
        }
    }, [listKey, clearFocus])

    const focusedIndex = items.length === 0 ? 0 : Math.min(storedIndex, items.length - 1)
    // Only expose focused item when the user has affirmatively engaged
    // keyboard nav; otherwise rows render without the focus indicator.
    const focused = hasFocus ? (items[focusedIndex] ?? null) : null

    const shortcuts = useMemo<Shortcut[]>(() => {
        if (!isEnabled) return []
        const lastIndex = Math.max(items.length - 1, 0)
        // First j/k from no-focus lands on row 0 instead of advancing past it.
        const next = () => (hasFocus ? setFocusedIndex((i) => Math.min(i + 1, lastIndex)) : setFocusedIndex(0))
        const prev = () => (hasFocus ? setFocusedIndex((i) => Math.max(i - 1, 0)) : setFocusedIndex(0))
        return [
            {
                id: 'drive.list.next',
                keys: 'j',
                scope: 'list',
                group: 'Drive',
                description: 'Next item',
                run: next,
            },
            {
                id: 'drive.list.prev',
                keys: 'k',
                scope: 'list',
                group: 'Drive',
                description: 'Previous item',
                run: prev,
            },
            {
                id: 'drive.list.open',
                keys: 'Enter',
                scope: 'list',
                group: 'Drive',
                description: 'Open item',
                run: () => {
                    if (!focused) return
                    openItem(focused)
                },
            },
            {
                id: 'drive.list.select',
                keys: 'x',
                scope: 'list',
                group: 'Drive',
                description: 'Toggle selection',
                run: () => {
                    if (!focused) return
                    toggleSelect(focused.id)
                },
            },
            {
                id: 'drive.list.newFolder',
                keys: 'Shift+F',
                scope: 'list',
                group: 'Drive',
                description: 'New folder',
                run: () => onNewFolder(),
            },
        ]
    }, [isEnabled, items.length, hasFocus, focused, openItem, toggleSelect, onNewFolder, setFocusedIndex])

    useRegisterShortcuts(shortcuts)

    return { focusedIndex, focusedId: focused?.id ?? null }
}
