import { and, eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useStore } from '@tinycld/core/lib/pocketbase'

export function useSettings(app: string, orgId: string) {
    const [settingsCollection] = useStore('settings')

    const { data: settings } = useLiveQuery(
        query =>
            query
                .from({ settings: settingsCollection })
                .where(({ settings }) => and(eq(settings.app, app), eq(settings.org, orgId))),
        [app, orgId]
    )

    return settings ?? []
}
