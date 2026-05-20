import { tinycldConfig } from '@tinycld/app-generated/tinycld-config'
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

/**
 * The statically-linked package set, derived once from tinycld.config.ts.
 * usePackages augments it with runtime-installed packages from the DB.
 */
export const packageRegistry = toStaticRegistry(tinycldConfig)
