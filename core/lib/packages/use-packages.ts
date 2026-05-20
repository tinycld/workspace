import { eq, or } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { packageRegistry } from './static-registry'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useMemo } from 'react'
import type { PackageManifest } from './types'

type PackageEntry = PackageManifest & { packageName: string }

// Raw useLiveQuery is correct here: pkg_registry is a global (non-org-scoped) collection
// used as a bootstrap dependency by other org-scoped hooks (useAccessiblePackages).
export function usePackages(): PackageEntry[] {
    const [pkgRegistryCollection] = useStore('pkg_registry')

    const { data: dbRecords } = useLiveQuery(
        query =>
            query
                .from({ pkg_registry: pkgRegistryCollection })
                .where(({ pkg_registry }) =>
                    or(eq(pkg_registry.status, 'installed'), eq(pkg_registry.status, 'bundled'))
                ),
        []
    )

    return useMemo(() => {
        const staticSlugs = new Set(packageRegistry.map(p => p.slug))
        const dynamicEntries: PackageEntry[] = []

        for (const record of dbRecords ?? []) {
            if (staticSlugs.has(record.slug)) continue
            if (record.status !== 'installed') continue

            const manifest = record.manifest_json as Partial<PackageManifest> | null
            if (!manifest?.name || !manifest?.slug || !manifest?.routes || !manifest?.nav) continue

            dynamicEntries.push({
                name: manifest.name,
                slug: manifest.slug,
                version: manifest.version ?? record.version ?? '',
                description: manifest.description ?? record.description ?? '',
                routes: manifest.routes,
                nav: manifest.nav,
                migrations: manifest.migrations,
                hooks: manifest.hooks,
                collections: manifest.collections,
                sidebar: manifest.sidebar,
                settings: manifest.settings,
                seed: manifest.seed,
                tests: manifest.tests,
                server: manifest.server,
                dependencies: manifest.dependencies,
                packageName: record.npm_package ?? manifest.slug,
            })
        }

        if (dynamicEntries.length === 0) return packageRegistry

        return [...packageRegistry, ...dynamicEntries]
    }, [dbRecords])
}

export function usePackage(slug: string) {
    const packages = usePackages()
    return packages.find(a => a.slug === slug) ?? null
}
