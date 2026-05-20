import { and, eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@tinycld/core/lib/auth'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgInfo } from '@tinycld/core/lib/use-org-info'

export function useCurrentRole() {
    const { user } = useAuth()
    const { orgId } = useOrgInfo()
    const [userOrgCollection] = useStore('user_org')

    const { data: userOrgs } = useLiveQuery(
        query =>
            query
                .from({ user_org: userOrgCollection })
                .where(({ user_org }) => and(eq(user_org.user, user.id), eq(user_org.org, orgId))),
        [user.id, orgId]
    )

    const userOrg = userOrgs?.[0]
    const role = userOrg?.role ?? null
    return {
        role,
        isOwner: role === 'owner',
        isAdmin: role === 'owner' || role === 'admin',
        isMember: role === 'member',
        isGuest: role === 'guest',
        canManageOrg: role === 'owner' || role === 'admin',
        canManageMembers: role === 'owner' || role === 'admin',
        userOrgId: userOrg?.id ?? '',
    }
}
