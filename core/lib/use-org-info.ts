import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { pb, useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgSlug } from '@tinycld/core/lib/use-org-slug'

export function useOrgInfo() {
    const orgSlug = useOrgSlug()
    const [orgsCollection] = useStore('orgs')
    const { data: orgs } = useLiveQuery(
        query => query.from({ orgs: orgsCollection }).where(({ orgs }) => eq(orgs.slug, orgSlug)),
        [orgSlug]
    )
    const org = orgs?.[0] ?? null
    return { orgSlug, orgId: org?.id ?? '', org }
}

/** Returns a fully-qualified URL for an org's logo, or null when unset. */
export function getOrgLogoUrl(
    org: { id: string; logo?: string } | null | undefined
): string | null {
    if (!org?.id || !org.logo) return null
    return pb.files.getURL({ collectionId: 'orgs', id: org.id }, org.logo)
}
