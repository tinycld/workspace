import { useCallback, useRef, useSyncExternalStore } from 'react'
import { Platform } from 'react-native'
import {
    computeNextFindReplaceSnapshot,
    FIND_REPLACE_EMPTY_STATE,
    type FindReplaceController,
    type FindReplaceControllerState,
} from './find-replace-controller'
import { useFindReplaceStateStore } from './stores/find-replace-state-store'

// Bar-side hook that returns the current controller state. On native
// it subscribes to the mirrored Zustand store so the bar re-renders
// when the WebView broadcasts a state-update; on web it reads the
// controller's getState() directly on every render (Tiptap's per-
// transaction re-render already brings us back here, so an explicit
// subscription would just duplicate work). Returns null when the
// controller isn't ready yet (web before tiptap mounts, native before
// the WebView has posted its initial broadcast).
//
// Implemented with useSyncExternalStore so the contract reads
// uniformly on both platforms; the web subscribe is a no-op returning
// a no-op unsubscribe.
//
// Snapshot identity is cached through `computeNextFindReplaceSnapshot`
// — useSyncExternalStore reads the snapshot on every render and
// requires it to be stable when nothing has changed (otherwise React
// dev mode logs "The result of getSnapshot should be cached to avoid
// an infinite loop" and production runs excess re-renders). Both the
// web (controller.getState()) and the native (mirror-store) branches
// produce fresh objects per call, so both go through the cache.
//
// Lives in its own file (not alongside the controller factories) so
// the controller module stays free of react-native imports — that
// lets unit tests for the web controller load it without transforming
// react-native's Flow-syntax entry point.

export function useFindReplaceControllerState(
    controller: FindReplaceController | null
): FindReplaceControllerState | null {
    const isNative = Platform.OS !== 'web'
    const cachedRef = useRef<FindReplaceControllerState>(FIND_REPLACE_EMPTY_STATE)

    const getSnapshot = useCallback(() => {
        const raw = isNative
            ? readNativeStoreSnapshot()
            : controller
              ? controller.getState()
              : FIND_REPLACE_EMPTY_STATE
        const next = computeNextFindReplaceSnapshot(cachedRef.current, raw)
        cachedRef.current = next
        return next
    }, [controller, isNative])

    const subscribe = isNative ? subscribeNativeStore : noopSubscribe

    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    if (!controller) return null
    return state
}

function noopSubscribe(): () => void {
    return () => undefined
}

// subscribeNativeStore calls useFindReplaceStateStore.subscribe(cb), the
// vanilla Zustand subscribe API (returns an unsubscribe). It is NOT a
// React hook — the `use*` prefix on the store is just Zustand's idiom.
function subscribeNativeStore(cb: () => void): () => void {
    return useFindReplaceStateStore.subscribe(cb)
}

function readNativeStoreSnapshot(): FindReplaceControllerState {
    const s = useFindReplaceStateStore.getState()
    return { matchCount: s.matchCount, currentIndex: s.currentIndex, query: s.query }
}
