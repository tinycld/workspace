import type { Context, InitialQueryBuilder, QueryBuilder } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { useOrgInfo } from '@tinycld/core/lib/use-org-info'
import { useMemo } from 'react'

export interface OrgScope {
    orgId: string
    userOrgId: string
    orgSlug: string
}

export function useOrgLiveQuery<TContext extends Context>(
    queryFn: (q: InitialQueryBuilder, org: OrgScope) => QueryBuilder<TContext> | undefined | null,
    deps: unknown[] = []
) {
    const { orgId, orgSlug } = useOrgInfo()
    const { userOrgId } = useCurrentRole()
    const scope = useMemo(() => ({ orgId, orgSlug, userOrgId }), [orgId, orgSlug, userOrgId])

    return useLiveQuery(
        q => {
            if (!orgId || !userOrgId) return null
            return queryFn(q, scope)
        },
        [orgId, userOrgId, ...deps]
    )
}
