import type { LucideIcon } from 'lucide-react-native'
import type { DriveItemView } from '../types'

/**
 * A consumer-supplied action rendered in drive's per-row context menu
 * (right-click). Sheets uses this to inject "Open in Sheets" for xlsx
 * files; future packages can add their own openers without drive
 * needing to know they exist.
 *
 * Sibling registry to core's `preview-action-registry`. They are kept
 * separate because:
 *   - DriveItemAction operates on `DriveItemView` (drive's row shape).
 *   - PreviewAction operates on `FilePreviewSource` (core's preview
 *     shape, used by mail attachments and any future preview surface).
 * Unifying would either leak DriveItemView into core or downgrade
 * row-level actions to the lower-resolution preview shape.
 *
 * Convention: factories supplying both surfaces (a row action AND a
 * preview-modal button) register independently against each registry
 * with the same `id` so QA / users can correlate them.
 */
export interface DriveItemAction {
    /** Stable identifier used as the React key. */
    id: string
    /** Icon shown in the menu row. */
    icon: LucideIcon
    /** Short human-readable label rendered next to the icon. */
    label: string
    /**
     * Optional per-item predicate. When supplied, the action is only
     * rendered for items where this returns true. Sheets uses this to
     * limit "Open in Sheets" to xlsx mime types. Default: always
     * applicable to non-folder items.
     */
    isApplicable?: (item: DriveItemView) => boolean
    /** Invoked with the right-clicked item when the user picks the menu row. */
    onPress: (item: DriveItemView) => void
}

/**
 * A "factory hook" — called from React rendering so it can use other
 * hooks (mutations, useOrgHref, etc.) and returns a ready-to-use
 * DriveItemAction. Same pattern as core's PreviewActionFactory.
 */
export type DriveItemActionFactory = () => DriveItemAction

const factories = new Map<string, DriveItemActionFactory>()

/**
 * Register a DriveItemAction factory by ID. Re-registering the same
 * ID replaces the prior entry (most recent linker wins). Designed to
 * be called at module load from a consumer package's provider.
 */
export function registerDriveItemAction(id: string, factory: DriveItemActionFactory) {
    factories.set(id, factory)
}

export function unregisterDriveItemAction(id: string) {
    factories.delete(id)
}

/**
 * Returns the registered factories in insertion order. Drive's
 * context menu calls this from a React component, invokes each
 * factory to obtain hook results, and renders the resulting actions
 * after filtering by `isApplicable`.
 */
export function getDriveItemActionFactories(): DriveItemActionFactory[] {
    return Array.from(factories.values())
}

export function __resetDriveItemActionRegistryForTests() {
    factories.clear()
}
