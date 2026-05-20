import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { getOrgLogoUrl } from '@tinycld/core/lib/use-org-info'
import type { ReactNode } from 'react'
import { Image, View } from 'react-native'

interface OrgLogoProps {
    org: { id: string; name: string; logo?: string } | null | undefined
    size?: number
    /** Rendered when org is null/loading. Defaults to nothing. */
    fallback?: ReactNode
}

/**
 * Round logo for an organization. Renders the uploaded image when present,
 * falls back to a NameAvatar (consistent colored initials) keyed off the org
 * name, and to `fallback` when the org itself is null (e.g. still loading).
 */
export function OrgLogo({ org, size = 36, fallback = null }: OrgLogoProps) {
    if (!org) return <>{fallback}</>
    const url = getOrgLogoUrl(org)
    if (url) {
        return (
            <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
                <Image
                    source={{ uri: url }}
                    style={{ width: size, height: size }}
                    accessibilityLabel={org.name}
                />
            </View>
        )
    }
    return <NameAvatar firstName={org.name} size={size} />
}
