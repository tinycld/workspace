import { useCallback } from 'react'
import { type GestureResponderEvent, Platform } from 'react-native'
import { useDriveUIStore } from '../stores/drive-ui-store'

export function useFileSelection(orderedItemIds: string[]) {
    const selectSingle = useDriveUIStore((s) => s.selectSingle)
    const selectToggle = useDriveUIStore((s) => s.selectToggle)
    const selectRange = useDriveUIStore((s) => s.selectRange)
    const selectItem = useDriveUIStore((s) => s.selectItem)
    const selectedIds = useDriveUIStore((s) => s.selectedIds)

    const handleSelect = useCallback(
        (itemId: string, event: GestureResponderEvent) => {
            if (Platform.OS !== 'web') {
                selectSingle(itemId)
                selectItem(itemId)
                return
            }
            const native = event.nativeEvent as unknown as MouseEvent
            if (native.metaKey || native.ctrlKey) {
                selectToggle(itemId)
                // After toggle, we can't easily know the resulting set size here,
                // so clear the detail panel item — the component can check selectedIds
                selectItem(null)
            } else if (native.shiftKey) {
                selectRange(itemId, orderedItemIds)
                selectItem(null)
            } else {
                selectSingle(itemId)
                selectItem(itemId)
            }
        },
        [orderedItemIds, selectSingle, selectToggle, selectRange, selectItem]
    )

    const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds])

    return { handleSelect, isSelected, selectedIds }
}
