import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useTakeoutImportStore } from '@tinycld/core/lib/stores/takeout-import-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Link, usePathname } from 'expo-router'
import { ActivityIndicator } from 'react-native'

export function ImportIndicator() {
    const phase = useTakeoutImportStore(s => s.phase)
    const pathname = usePathname()
    const orgHref = useOrgHref()
    const railText = useThemeColor('rail-text')

    if (phase !== 'importing') return null
    if (pathname?.endsWith('/settings/personal')) return null

    return (
        <Link
            href={orgHref('settings/personal')}
            style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                justifyContent: 'center',
                alignItems: 'center',
                display: 'flex',
            }}
            aria-label="Import in progress"
        >
            <ActivityIndicator size="small" color={railText} />
        </Link>
    )
}
