import type { PackageManifest } from './types'

type EntryLike = { manifest: PackageManifest & { packageName?: string } }
type RegistryEntry = PackageManifest & { packageName: string }

/**
 * Map tinycld.config.ts entries to the registry shape usePackages() expects
 * (each manifest flattened with a guaranteed packageName). Replaces the old
 * generated package-registry.ts.
 */
export function toStaticRegistry(entries: readonly EntryLike[]): RegistryEntry[] {
    return entries.map(e => ({
        ...e.manifest,
        packageName: e.manifest.packageName ?? `@tinycld/${e.manifest.slug}`,
    }))
}
