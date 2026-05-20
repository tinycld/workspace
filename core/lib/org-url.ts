import { router } from 'expo-router'
import { Platform } from 'react-native'

function getOrgPath(orgSlug: string): string {
    let subPath = 'mail'
    if (Platform.OS === 'web') {
        const match = window.location.pathname.match(/^\/a\/[^/]+\/(.+)/)
        if (match) subPath = match[1]
    }
    return `/a/${orgSlug}/${subPath}`
}

export function getOrgHrefString(orgSlug: string): string {
    return getOrgPath(orgSlug)
}

export function navigateToOrg(orgSlug: string): void {
    router.push(getOrgPath(orgSlug))
}
