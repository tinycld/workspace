import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import type { Shortcut } from '../shortcuts/types'
import { useRegisterShortcuts } from '../shortcuts/use-register'
import { LOCAL_ORIGIN } from './client'

export interface UseYUndoManagerOptions {
    // The set of Y types to scope undo to. Most callers pass the
    // top-level Y.Maps that hold their app's mutable state — e.g.
    // sheets passes [doc.getMap('cells'), doc.getMap('sheets')].
    //
    // The `AbstractType<any>` typing matches Y.UndoManager's own
    // constructor signature in upstream yjs — it's the only correct
    // shape for "any Y type subclass."
    // biome-ignore lint/suspicious/noExplicitAny: matches Y.UndoManager's upstream constructor signature.
    scope: () => Y.AbstractType<any>[]

    // captureTimeout groups successive edits made within this many
    // milliseconds into one undo step. Default 500 — typing a cell
    // value isn't separate undo steps per keystroke.
    captureTimeoutMs?: number
}

export interface UndoManagerState {
    canUndo: boolean
    canRedo: boolean
    undo: () => void
    redo: () => void
}

// Frozen empty snapshot for SSR / no-doc cases. Module-level so
// useSyncExternalStore's getServerSnapshot returns a stable reference.
const EMPTY_SNAPSHOT: { canUndo: boolean; canRedo: boolean } = Object.freeze({
    canUndo: false,
    canRedo: false,
})

// computeNextSnapshot returns either the existing cached snapshot (when
// the booleans haven't changed) or a fresh object with the new values.
// Pulled out so the snapshot-identity contract — same object reference
// when nothing changed — is testable in isolation.
//
// useSyncExternalStore reads the snapshot every render; if the getter
// allocates a new object each time, React thinks state changed every
// render and loops forever. Caching by field equality is the documented
// fix.
export function computeNextSnapshot(
    cached: { canUndo: boolean; canRedo: boolean },
    canUndo: boolean,
    canRedo: boolean
): { canUndo: boolean; canRedo: boolean } {
    if (cached.canUndo === canUndo && cached.canRedo === canRedo) return cached
    return { canUndo, canRedo }
}

// useYUndoManager wires Cmd-Z / Cmd-Shift-Z / Cmd-Y to a Y.UndoManager
// scoped over the supplied Y types AND surfaces { canUndo, canRedo,
// undo, redo } so callers can render toolbar buttons backed by the
// same manager instance the keyboard shortcuts drive. The UndoManager
// only captures LOCAL_ORIGIN updates from the realtime client layer's
// sentinel — REMOTE_ORIGIN and SYNC_ORIGIN updates are excluded so
// undoing my edits never reverts a peer's edits, and the initial
// sync state transfer doesn't show up as a single giant undo step.
//
// Consumers must wrap their own writes in `doc.transact(fn,
// LOCAL_ORIGIN)` for the captures to work; see use-y-cell.ts in calc
// for the canonical pattern.
//
// Shortcuts register through the shared shortcut registry (powered by
// tinykeys via ShortcutsProvider) with `allowInInputs: true` and
// `scope: 'global'` so undo/redo fires regardless of focus — including
// while the user is typing in a TextInput. On native the registry
// provider is a no-op, which is fine: there's no hardware keyboard to
// listen for and the toolbar buttons are the in-app alternative.
export function useYUndoManager(
    doc: Y.Doc | null,
    options: UseYUndoManagerOptions
): UndoManagerState {
    const { scope, captureTimeoutMs = 500 } = options

    // Holds the live manager so the snapshot getter, subscribe
    // function, and stable undo/redo callbacks can all read from one
    // place without recreating themselves on every render.
    const managerRef = useRef<Y.UndoManager | null>(null)
    // Cached snapshot — see computeNextSnapshot above. Initialized to
    // EMPTY_SNAPSHOT so the very first render returns a stable
    // reference even before the manager is constructed.
    const snapshotRef = useRef<{ canUndo: boolean; canRedo: boolean }>(EMPTY_SNAPSHOT)
    // Subscribers passed in by useSyncExternalStore. Held in a ref so
    // the manager-construction effect can notify them when a doc swap
    // tears down the old manager and builds a new one (and React
    // needs to re-read the snapshot against the new manager).
    const subscribersRef = useRef<Set<() => void>>(new Set())

    // biome-ignore lint/correctness/useExhaustiveDependencies: scope is intentionally captured by closure on first mount; remounting on every render would tear down and recreate the UndoManager (and its undo stack) constantly.
    useEffect(() => {
        if (doc == null) return
        if (typeof window === 'undefined') return

        const targets = scope()
        if (targets.length === 0) return

        const manager = new Y.UndoManager(targets, {
            captureTimeout: captureTimeoutMs,
            // Allowlist: only LOCAL_ORIGIN updates produce undo
            // entries. Anything else (REMOTE_ORIGIN, SYNC_ORIGIN, or
            // any unknown origin some other library introduces) is
            // excluded by virtue of not being in the set.
            trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
        })
        managerRef.current = manager

        const notify = () => {
            for (const cb of subscribersRef.current) cb()
        }

        manager.on('stack-item-added', notify)
        manager.on('stack-item-popped', notify)
        manager.on('stack-cleared', notify)
        manager.on('stack-item-updated', notify)

        // The manager just changed identity — fire once so any active
        // subscriber re-reads the snapshot against the new instance
        // (canUndo/canRedo both reset to false on a fresh manager).
        notify()

        return () => {
            manager.off('stack-item-added', notify)
            manager.off('stack-item-popped', notify)
            manager.off('stack-cleared', notify)
            manager.off('stack-item-updated', notify)
            manager.destroy()
            managerRef.current = null
            // Notify so subscribers re-read and observe the now-null
            // manager (snapshot collapses back to {false,false}).
            for (const cb of subscribersRef.current) cb()
        }
    }, [doc, captureTimeoutMs])

    const subscribe = useCallback((cb: () => void) => {
        subscribersRef.current.add(cb)
        return () => {
            subscribersRef.current.delete(cb)
        }
    }, [])

    const getSnapshot = useCallback(() => {
        const m = managerRef.current
        const canUndo = m?.canUndo() ?? false
        const canRedo = m?.canRedo() ?? false
        snapshotRef.current = computeNextSnapshot(snapshotRef.current, canUndo, canRedo)
        return snapshotRef.current
    }, [])

    const getServerSnapshot = useCallback(() => EMPTY_SNAPSHOT, [])

    const { canUndo, canRedo } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

    // Stable callbacks: identity survives re-renders and manager
    // rebuilds because they read from the ref. A consumer wiring
    // these into a memoized Toolbar won't invalidate the memo on
    // every parent render.
    const undo = useCallback(() => {
        managerRef.current?.undo()
    }, [])
    const redo = useCallback(() => {
        managerRef.current?.redo()
    }, [])

    // Register Cmd-Z / Cmd-Shift-Z / Cmd-Y through the shared shortcut
    // registry. allowInInputs lets undo fire while a TextInput has
    // focus (the formula bar / cell editor in calc); scope: 'global'
    // means no caller has to wrap the consuming screen in a
    // useShortcutScope. The shortcuts memo depends only on the stable
    // undo/redo callbacks so it re-registers exactly once per mount.
    const shortcuts = useMemo<Shortcut[]>(
        () => [
            {
                id: 'undo-manager.undo',
                keys: '$mod+z',
                scope: 'global',
                group: 'Edit',
                description: 'Undo',
                allowInInputs: true,
                run: undo,
            },
            {
                id: 'undo-manager.redo-shift',
                keys: '$mod+Shift+z',
                scope: 'global',
                group: 'Edit',
                description: 'Redo',
                allowInInputs: true,
                run: redo,
            },
            {
                id: 'undo-manager.redo-y',
                keys: '$mod+y',
                scope: 'global',
                group: 'Edit',
                description: 'Redo (Windows alt)',
                allowInInputs: true,
                run: redo,
            },
        ],
        [undo, redo]
    )
    useRegisterShortcuts(shortcuts)

    return { canUndo, canRedo, undo, redo }
}
