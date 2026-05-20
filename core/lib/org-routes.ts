import { useOrgSlug } from '@tinycld/core/lib/use-org-slug'
import type { Href } from 'expo-router'

type QueryParams = Record<string, string | number | string[]>

/**
 * Hook for org-scoped navigation.
 * Returns a function that builds href objects from short paths (without /a/[orgSlug] prefix).
 *
 * Usage:
 *   const orgHref = useOrgHref()
 *   router.push(orgHref('contacts/new'))
 *   router.push(orgHref('contacts/[id]', { id: '123' }))
 *   router.push(orgHref('mail', { folder: 'sent' }))
 *   router.push(orgHref('settings/[...section]', { section: ['mail', 'provider'] }))
 *   <Link href={orgHref('mail/[id]', { id: threadId })} />
 */
export function useOrgHref() {
    const orgSlug = useOrgSlug()
    return (path: string, extra?: QueryParams): Href => {
        const pathname = path === '' ? '/a/[orgSlug]' : `/a/[orgSlug]/${path}`
        return {
            pathname,
            params: { orgSlug, ...extra },
        } as Href
    }
}
