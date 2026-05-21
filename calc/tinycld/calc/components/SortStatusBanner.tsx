import { useCallback } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useGridStore, useGridStoreApi } from '../hooks/use-grid-store'
import { pluralize } from '../lib/pluralize'

// SortStatusBanner shows a transient notice after a sort dissolved
// merged cells. Dismissed by clicking the X. Renders nothing while
// status is null, so the toolbar layout doesn't shift in the common
// case.
export function SortStatusBanner() {
    const status = useGridStore(s => s.sortStatus)
    const store = useGridStoreApi()
    const onDismiss = useCallback(() => store.getState().setSortStatus(null), [store])
    if (status == null) return null
    return (
        <View
            accessibilityLabel="Sort status"
            className="bg-surface-secondary border-b border-border flex-row items-center justify-between"
            style={{ paddingHorizontal: 12, paddingVertical: 6 }}
        >
            <Text className="text-foreground" style={{ fontSize: 12 }}>
                {`${pluralize(status.mergesBroken, 'merge')} in the range ${
                    status.mergesBroken === 1 ? 'was' : 'were'
                } dissolved`}
            </Text>
            <Pressable
                onPress={onDismiss}
                accessibilityLabel="Dismiss sort status"
                accessibilityRole="button"
                className="px-2 py-1"
            >
                <Text className="text-foreground" style={{ fontSize: 12 }}>
                    ✕
                </Text>
            </Pressable>
        </View>
    )
}
