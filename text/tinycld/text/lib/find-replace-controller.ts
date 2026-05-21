// FindReplaceController abstracts the bar's editor dependency. The bar
// no longer talks to ProseMirror's state + dispatch directly — instead
// it reads observable state through getState() and posts commands
// through the controller's methods. Two implementations exist:
//
//   - makeWebFindReplaceController (in find-replace-controller-web.ts)
//     wraps the in-process Tiptap editor. getState() reads the plugin
//     state synchronously; commands dispatch transactions inline. The
//     bar re-renders per transaction via Tiptap's
//     shouldRerenderOnTransaction, so the bar always sees the latest
//     getState().
//
//   - makeNativeFindReplaceController (in native-find-replace-
//     controller.ts) posts messages to the WebView through
//     useWebViewEditor.postMessage. getState() reads from a Zustand
//     store that mirrors the WebView's broadcasted state-update
//     messages. The bar subscribes to the store so it re-renders when
//     the WebView's plugin state changes.
//
// The bar consumes this through useFindReplaceControllerState
// (declared in this module's companion hook file — see use-find-
// replace-controller-state.ts) which papers over the platform
// difference.
//
// This file holds ONLY the interface + pure helpers + the empty-state
// constant. It deliberately has zero runtime imports so the bar and
// hook (which import from here on every platform) never transitively
// pull in the ProseMirror plugin module — `@tiptap/pm/view`'s
// `Decoration` and `DecorationSet` touch DOM types at evaluation that
// crash on native at module load. The web factory and its plugin
// imports live in `find-replace-controller-web.ts`.

export interface FindReplaceControllerState {
    matchCount: number
    currentIndex: number
    query: string
}

// Frozen so the module-level constant can never accidentally drift —
// every code path that reads "no controller / no matches" sees the
// same canonical zero state and a stable reference. Mirrors the
// EMPTY_SNAPSHOT pattern in use-y-undo-manager.ts.
export const FIND_REPLACE_EMPTY_STATE: FindReplaceControllerState = Object.freeze({
    matchCount: 0,
    currentIndex: 0,
    query: '',
})

// Pure helper used by useFindReplaceControllerState's getSnapshot. The
// useSyncExternalStore contract requires getSnapshot to return the
// same reference when nothing has changed — otherwise React loops on
// dev mode warnings or runs excess re-renders in production. Both
// branches of the hook (web reads `controller.getState()`, native
// reads the mirror Zustand store) produce fresh objects per call, so
// both go through this cache.
//
// Pulled out here (not in the hook file) so unit tests can load it
// without dragging in `react-native`'s Flow-syntax entry point. Mirrors
// computeNextSnapshot in use-y-undo-manager.ts.
export function computeNextFindReplaceSnapshot(
    cached: FindReplaceControllerState,
    next: FindReplaceControllerState
): FindReplaceControllerState {
    if (
        cached.matchCount === next.matchCount &&
        cached.currentIndex === next.currentIndex &&
        cached.query === next.query
    ) {
        return cached
    }
    return next
}

export interface FindReplaceController {
    // Synchronous read of the latest observable state. The bar reads
    // this directly each render; subscription mechanics live in the
    // companion hook file.
    getState(): FindReplaceControllerState
    // Commands. All are sync from the caller's perspective; native
    // fires-and-forgets postMessage, web dispatches synchronously.
    setQuery(query: string): void
    clear(): void
    next(): void
    prev(): void
    replaceCurrent(replacement: string): void
    replaceAll(replacement: string): void
}
