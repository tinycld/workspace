import { and, eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@tinycld/core/lib/auth'
import { useStore } from '@tinycld/core/lib/pocketbase'

export function useCurrentUserOrg(orgSlug: string) {
    const { user } = useAuth()
    const [userOrgCollection] = useStore('user_org')
    const [orgsCollection] = useStore('orgs')

    const { data: orgs } = useLiveQuery(
        query => query.from({ orgs: orgsCollection }).where(({ orgs }) => eq(orgs.slug, orgSlug)),
        [orgSlug]
    )

    const orgId = orgs?.[0]?.id ?? ''

    const { data: userOrgs } = useLiveQuery(
        query =>
            query
                .from({ user_org: userOrgCollection })
                .where(({ user_org }) => and(eq(user_org.user, user.id), eq(user_org.org, orgId))),
        [user.id, orgId]
    )

    return userOrgs?.[0] ?? null
}
