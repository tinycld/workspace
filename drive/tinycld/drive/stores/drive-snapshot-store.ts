import { useSyncExternalStore } from 'react'
import type { DriveContextValue } from '../hooks/useDrive'

// Bridge between the in-tree DriveStateContext and consumers that render
// inside Menu.Portal. The Gluestack overlay used by Menu.Portal does not
// preserve the React context chain (it queues elements onto a root-mounted
// PortalProvider's state instead of using React.createPortal), so calling
// useDrive() from a portaled subtree throws. DriveStateProvider mirrors
// the latest value here on every render via writeDriveSnapshot, and
// notifyDriveSnapshotListeners must be called from a layout effect to
// flush change subscriptions to portaled consumers (useDriveSnapshot)
// after the parent commits — notifying during render would trigger
// React's "Cannot update a component while rendering a different
// component" warning when a snapshot subscriber is mounted.

let currentValue: DriveContextValue | null = null
let lastNotifiedValue: DriveContextValue | null = null
const listeners = new Set<() => void>()

// Update the snapshot synchronously during render so consumers that read
// via getSnapshot() (the next time they render) see fresh data. Does NOT
// notify listeners — that happens in notifyDriveSnapshotListeners.
export function writeDriveSnapshot(value: DriveContextValue): void {
    currentValue = value
}

// Flush change notifications to portaled subscribers. Must be called from
// a useLayoutEffect (or useEffect) — calling it during render would
// synchronously re-render mounted subscribers and trip React's
// concurrent-render guards.
export function notifyDriveSnapshotListeners(): void {
    if (lastNotifiedValue === currentValue) return
    lastNotifiedValue = currentValue
    for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

function getSnapshot(): DriveContextValue | null {
    return currentValue
}

export function useDriveSnapshot(): DriveContextValue {
    const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    if (!value) {
        throw new Error('useDriveSnapshot() called before <DriveStateProvider> mounted')
    }
    return value
}
