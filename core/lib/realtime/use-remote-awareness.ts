import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { Awareness } from 'y-protocols/awareness'

// RemoteAwarenessEntry<T> pairs a parsed app-specific state with the
// numeric clientID that produced it. Consumers use clientID to key
// React lists and to drive visual differentiation between peers.
export interface RemoteAwarenessEntry<T> {
    clientID: number
    state: T
}

export interface UseRemoteAwarenessOptions<T> {
    // parse validates and shapes a raw awareness slot into the
    // app-specific T, or returns null to drop the slot entirely (e.g.
    // a peer that hasn't yet published valid state). Called for every
    // remote slot on every change.
    parse: (raw: unknown) => T | null

    // equals returns true when two parsed states are equivalent for
    // the consumer's purposes. The hook short-circuits its
    // useSyncExternalStore snapshot when the new and prior arrays are
    // pairwise-equal under this predicate, preventing spurious
    // re-renders.
    equals: (a: T, b: T) => boolean
}

// useRemoteAwareness returns the list of *other* clients' awareness
// states, parsed to T. Excludes the local client. Re-renders only
// when the parsed list actually changes (under the supplied equals).
//
// Generic over T so each consumer (sheets presence, mail thread
// indicator, calendar drag-cursor, …) keeps its own state shape and
// validator.
export function useRemoteAwareness<T>(
    awareness: Awareness | null,
    options: UseRemoteAwarenessOptions<T>
): RemoteAwarenessEntry<T>[] {
    const { parse, equals } = options

    const subscribe = useCallback(
        (onChange: () => void) => {
            if (awareness == null) return () => {}
            const handler = () => onChange()
            awareness.on('change', handler)
            return () => awareness.off('change', handler)
        },
        [awareness]
    )

    const snapshotRef = useRef<RemoteAwarenessEntry<T>[]>([])
    const getSnapshot = useCallback((): RemoteAwarenessEntry<T>[] => {
        if (awareness == null) return snapshotRef.current
        const states = awareness.getStates()
        const localID = awareness.clientID
        const next: RemoteAwarenessEntry<T>[] = []
        states.forEach((raw, clientID) => {
            if (clientID === localID) return
            const parsed = parse(raw)
            if (parsed == null) return
            next.push({ clientID, state: parsed })
        })
        // Stable order so consumers rendering lists don't flicker.
        next.sort((a, b) => a.clientID - b.clientID)
        const prev = snapshotRef.current
        if (sameEntries(prev, next, equals)) return prev
        snapshotRef.current = next
        return next
    }, [awareness, parse, equals])

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function sameEntries<T>(
    a: RemoteAwarenessEntry<T>[],
    b: RemoteAwarenessEntry<T>[],
    equals: (a: T, b: T) => boolean
): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
        if (a[i].clientID !== b[i].clientID) return false
        if (!equals(a[i].state, b[i].state)) return false
    }
    return true
}
