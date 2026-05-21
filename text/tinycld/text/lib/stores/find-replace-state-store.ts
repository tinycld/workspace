import { create } from '@tinycld/core/lib/store'

// Mirror of the in-WebView find/replace plugin state for native. The
// WebView broadcasts a 'find-replace.state-update' message on every
// transaction whose effect on the plugin state changes; the native-
// side hook (use-document-editor.native.tsx) routes that message into
// setState() here. The FindReplaceBar reads the mirror through
// useFindReplaceControllerState so it re-renders on every update.
//
// Kept as a transient store (no persist middleware) — find/replace
// state shouldn't survive an app restart, just like the bar's UI
// store. Web has no use for this mirror; its bar reads the plugin
// state directly off the FindReplaceController.getState() path.
interface FindReplaceStateStore {
    matchCount: number
    currentIndex: number
    query: string
    setState: (next: { matchCount: number; currentIndex: number; query: string }) => void
}

export const useFindReplaceStateStore = create<FindReplaceStateStore>(set => ({
    matchCount: 0,
    currentIndex: 0,
    query: '',
    setState: next => set(next),
}))
