import { create } from '@tinycld/core/lib/store'
import type { ImageSelection } from '../../webview-editor/source/editor-state-types'

// Image-selection store: the bottom sheet's open/closed state is
// driven entirely by whether the WebView's editor reports an image
// node-selection. The native useDocumentEditor variant subscribes to
// ui.selection-changed messages and pushes the payload into here;
// ImageAttrsBottomSheet renders when `selection` is non-null and
// returns null otherwise.
//
// Transient by design — image selection is ephemeral per editing
// session, so no persist() wrap. The store still bundles into the web
// build (Metro can't tree-shake through this import graph) but goes
// unused there because ImageAttrsBottomSheet returns null on web.

interface ImageSelectionState {
    selection: ImageSelection | null
    setSelection: (next: ImageSelection | null) => void
    clearSelection: () => void
}

export const useImageSelectionStore = create<ImageSelectionState>(set => ({
    selection: null,
    setSelection: next => set({ selection: next }),
    clearSelection: () => set({ selection: null }),
}))
