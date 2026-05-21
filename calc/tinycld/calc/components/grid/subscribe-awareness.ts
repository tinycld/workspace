import type { Awareness } from 'y-protocols/awareness'
import type { GridStoreApi } from '../../hooks/grid-store'
import { primaryAnchor } from '../../lib/selection-range'

// subscribeAwarenessToStore wires the local Zustand store to the
// y-protocols Awareness instance. Any change to the primary anchor
// or editSession triggers a setLocalState call so peers see it.
//
// Plan Risk 5: only the primary anchor is broadcast (not the full
// disjoint selection). Peers don't have a sensible way to render a
// remote disjoint selection and the payload would grow unboundedly;
// Sheets behaves the same way (peers see only the primary cell).
export function subscribeAwarenessToStore(
    store: GridStoreApi,
    awareness: Awareness,
    sheetId: string
): () => void {
    const publish = () => {
        const { selection, editSession } = store.getState()
        const local = awareness.getLocalState() ?? {}
        awareness.setLocalState({
            ...local,
            sheetId,
            selection: primaryAnchor(selection),
            editing:
                editSession != null
                    ? { row: editSession.row, col: editSession.col, draft: editSession.draft }
                    : null,
        })
    }
    publish()
    // Subscribe to the whole selection object — when ranges change
    // identity (any selection mutation), re-derive the primary anchor.
    // Awareness publishes are cheap and infrequent enough that we
    // don't need a more granular subscription.
    let prevPrimary = primaryAnchor(store.getState().selection)
    return store.subscribe((state, prev) => {
        if (state.editSession !== prev.editSession) {
            publish()
            return
        }
        if (state.selection !== prev.selection) {
            const next = primaryAnchor(state.selection)
            if (
                next?.row !== prevPrimary?.row ||
                next?.col !== prevPrimary?.col
            ) {
                prevPrimary = next
                publish()
            }
        }
    })
}
