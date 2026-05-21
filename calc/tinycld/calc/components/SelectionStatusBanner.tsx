import { useCallback, useEffect } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useGridStore, useGridStoreApi } from '../hooks/use-grid-store'

// SelectionStatusBanner surfaces transient selection-level
// notifications. Today's only kind is the clipboard refusal raised
// by useClipboard when copy/cut is invoked on a disjoint selection
// (plan §6.d). Dismissed by clicking the X, or auto-dismissed when
// the user's next selection change happens (so the banner doesn't
// linger on subsequent unrelated actions).
//
// Renders nothing while status is null so the toolbar layout doesn't
// shift in the common case.
export function SelectionStatusBanner() {
    const status = useGridStore(s => s.selectionStatus)
    const store = useGridStoreApi()
    const onDismiss = useCallback(() => store.getState().dismissSelectionStatus(), [store])

    // Auto-dismiss the banner when the user's next selection change
    // arrives. `setSelectionStatus` itself is the action that lit
    // the banner — we use the post-stamp `selection` value as the
    // baseline so the *next* selection-mutating action clears the
    // banner.
    useEffect(() => {
        if (status == null) return
        const initialSelection = store.getState().selection
        const unsub = store.subscribe((state, prev) => {
            if (state.selection !== prev.selection && state.selection !== initialSelection) {
                store.getState().dismissSelectionStatus()
            }
        })
        return unsub
    }, [status, store])
    if (status == null) return null
    const message =
        status.kind === 'copy-disjoint-refused'
            ? "Can't copy a disjoint selection. Select a single rectangle."
            : ''
    return (
        <View
            accessibilityLabel="Selection status"
            className="bg-surface-secondary border-b border-border flex-row items-center justify-between"
            style={{ paddingHorizontal: 12, paddingVertical: 6 }}
        >
            <Text className="text-foreground" style={{ fontSize: 12 }}>
                {message}
            </Text>
            <Pressable
                onPress={onDismiss}
                accessibilityLabel="Dismiss selection status"
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
