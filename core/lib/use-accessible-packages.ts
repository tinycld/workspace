import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { usePackages } from '@tinycld/core/lib/packages/use-packages'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'

export function useAccessiblePackages() {
    const packages = usePackages()
    const { role, userOrgId } = useCurrentRole()
    const [orgPkgAccessCollection] = useStore('org_pkg_access')
    const [pkgRegistryCollection] = useStore('pkg_registry')
    const [orgPkgEnabledCollection] = useStore('org_pkg_enabled')

    // Global registry: which packages are active (bundled or installed)
    const { data: registryRecords } = useLiveQuery(
        query =>
            query
                .from({ pkg_registry: pkgRegistryCollection })
                .where(({ pkg_registry }) => eq(pkg_registry.status, 'bundled')),
        []
    )

    // Also include 'installed' status packages
    const { data: installedRecords } = useLiveQuery(
        query =>
            query
                .from({ pkg_registry: pkgRegistryCollection })
                .where(({ pkg_registry }) => eq(pkg_registry.status, 'installed')),
        []
    )

    // Org-level package toggles
    const { data: orgToggles } = useOrgLiveQuery(
        (query, { orgId }) =>
            query
                .from({ org_pkg_enabled: orgPkgEnabledCollection })
                .where(({ org_pkg_enabled }) => eq(org_pkg_enabled.org, orgId)),
        []
    )

    // User-level access overrides
    const { data: overrides } = useOrgLiveQuery(
        query =>
            query
                .from({ org_pkg_access: orgPkgAccessCollection })
                .where(({ org_pkg_access }) => eq(org_pkg_access.user_org, userOrgId)),
        [userOrgId]
    )

    // Build set of globally active package slugs from registry
    const allActiveRecords = [...(registryRecords ?? []), ...(installedRecords ?? [])]
    const activeSlugs = new Set(allActiveRecords.map(r => r.slug))

    // Build map of org-level disabled packages
    const orgDisabledSlugs = new Set((orgToggles ?? []).filter(t => !t.enabled).map(t => t.pkg))

    // Start with packages that are both compiled-in and active in registry
    // If the registry has no records yet (first load), fall back to all packages
    const hasRegistry = allActiveRecords.length > 0
    let filtered = hasRegistry ? packages.filter(pkg => activeSlugs.has(pkg.slug)) : packages

    // Remove org-level disabled packages
    filtered = filtered.filter(pkg => !orgDisabledSlugs.has(pkg.slug))

    // Apply user-level access for non-admins
    if (role === 'owner' || role === 'admin') return filtered

    const overrideMap = new Map(
        (overrides ?? []).map(o => [o.pkg, o.access as 'full' | 'readonly' | 'none'])
    )

    return filtered.filter(pkg => {
        const access = overrideMap.get(pkg.slug)
        if (role === 'guest') return access === 'full' || access === 'readonly'
        return access !== 'none'
    })
}
