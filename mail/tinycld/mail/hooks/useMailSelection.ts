import { useRef, useState } from 'react'
import type { ThreadListItem } from '../components/thread-list-item'

export function useMailSelection(items: ThreadListItem[], folder: string | null, labels: string[]) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

    const prevFolderRef = useRef(folder)
    const prevLabelsRef = useRef(labels.join(','))

    const labelsKey = labels.join(',')
    if (folder !== prevFolderRef.current || labelsKey !== prevLabelsRef.current) {
        prevFolderRef.current = folder
        prevLabelsRef.current = labelsKey
        if (selectedIds.size > 0) {
            setSelectedIds(new Set())
        }
    }

    const itemIds = new Set(items.map((i) => i.stateId))
    const selectedItems = items.filter((i) => selectedIds.has(i.stateId))
    const selectedCount = selectedItems.length
    const hasSelection = selectedCount > 0
    const allSelected = selectedCount > 0 && selectedCount === items.length
    const someSelected = selectedCount > 0 && selectedCount < items.length

    const allSelectedRead = hasSelection && selectedItems.every((i) => i.isRead)
    const allSelectedStarred = hasSelection && selectedItems.every((i) => i.isStarred)

    function toggle(stateId: string) {
        if (!itemIds.has(stateId)) return
        setSelectedIds((prev) => {
            const next = new Set(prev)
            if (next.has(stateId)) {
                next.delete(stateId)
            } else {
                next.add(stateId)
            }
            return next
        })
    }

    function toggleAll() {
        if (allSelected) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(items.map((i) => i.stateId)))
        }
    }

    function clearSelection() {
        setSelectedIds(new Set())
    }

    return {
        selectedIds,
        selectedItems,
        selectedCount,
        hasSelection,
        allSelected,
        someSelected,
        allSelectedRead,
        allSelectedStarred,
        toggle,
        toggleAll,
        clearSelection,
    }
}
