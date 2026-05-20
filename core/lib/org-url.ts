import { router } from 'expo-router'
import { Platform } from 'react-native'

function getOrgPath(orgSlug: string): string {
    // Default to the org root and let app/a/[orgSlug]/index.tsx redirect to the
    // first AVAILABLE package (via useSortedPackages) — don't hardcode a package
    // slug, which 404s when that package isn't linked. On web, preserve the
    // current in-org subpath so a reload/redirect stays on the same screen.
    let subPath = ''
    if (Platform.OS === 'web') {
        const match = window.location.pathname.match(/^\/a\/[^/]+\/(.+)/)
        if (match) subPath = match[1]
    }
    return subPath ? `/a/${orgSlug}/${subPath}` : `/a/${orgSlug}`
}

export function getOrgHrefString(orgSlug: string): string {
    return getOrgPath(orgSlug)
}

export function navigateToOrg(orgSlug: string): void {
    router.push(getOrgPath(orgSlug))
}
