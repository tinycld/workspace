import { and, eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'

export type PackageAccessLevel = 'full' | 'readonly' | 'none'

export function usePkgAccess(pkgSlug: string): PackageAccessLevel {
    const { role, userOrgId } = useCurrentRole()
    const [orgPkgAccessCollection] = useStore('org_pkg_access')

    const { data: overrides } = useLiveQuery(
        query =>
            query
                .from({ org_pkg_access: orgPkgAccessCollection })
                .where(({ org_pkg_access }) =>
                    and(eq(org_pkg_access.user_org, userOrgId), eq(org_pkg_access.pkg, pkgSlug))
                ),
        [userOrgId, pkgSlug]
    )

    if (role === 'owner' || role === 'admin') return 'full'

    const override = overrides?.[0]

    if (role === 'guest') {
        return (override?.access as PackageAccessLevel) ?? 'none'
    }

    // member: default full, override to restrict
    return (override?.access as PackageAccessLevel) ?? 'full'
}
