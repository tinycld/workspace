import { and, eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@tinycld/core/lib/auth'
import { useStore } from '@tinycld/core/lib/pocketbase'

export function useUserPreferences(app: string) {
    const { user } = useAuth()
    const [userPreferencesCollection] = useStore('user_preferences')

    const { data: preferences } = useLiveQuery(
        query =>
            query
                .from({ user_preferences: userPreferencesCollection })
                .where(({ user_preferences }) =>
                    and(eq(user_preferences.app, app), eq(user_preferences.user, user.id))
                ),
        [app, user.id]
    )

    return preferences ?? []
}
