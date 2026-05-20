import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@tinycld/core/lib/auth'
import { useStore } from '@tinycld/core/lib/pocketbase'

export function useUserOrgs() {
    const { user } = useAuth()
    const [userOrgCollection] = useStore('user_org')
    const [orgsCollection] = useStore('orgs')

    const { data: userOrgs } = useLiveQuery(
        query =>
            query
                .from({ user_org: userOrgCollection })
                .where(({ user_org }) => eq(user_org.user, user.id)),
        [user.id]
    )

    const orgIds = userOrgs?.map(uo => uo.org) ?? []

    const { data: orgs } = useLiveQuery(query => query.from({ orgs: orgsCollection }), [])

    return orgs?.filter(o => orgIds.includes(o.id)) ?? []
}
