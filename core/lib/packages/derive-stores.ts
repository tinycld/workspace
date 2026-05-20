import type { CoreStores } from '@tinycld/core/lib/pocketbase'
import type { PackageStoresReturn } from './config-types'

/**
 * Spread each config entry's registerCollections(nc, core) into one store map —
 * the runtime equivalent of the old generated packageStores().
 *
 * Type: asserted to PackageStoresReturn<Entries> (the inferred intersection of
 * every entry's register return). The loop can't carry per-entry types, but the
 * cast TARGET is fully inferred from the `as const` config array, so it's sound
 * as long as `entries` is the source of truth. See ~/code/tinycld/new/spike2.
 */
export function buildPackageStores<
    Entries extends readonly { registerCollections?: (...a: never[]) => unknown }[],
>(entries: Entries, newCollection: unknown, coreStores: CoreStores): PackageStoresReturn<Entries> {
    const out: Record<string, unknown> = {}
    for (const entry of entries) {
        if (typeof entry.registerCollections === 'function') {
            Object.assign(
                out,
                entry.registerCollections(newCollection as never, coreStores as never)
            )
        }
    }
    return out as PackageStoresReturn<Entries>
}
