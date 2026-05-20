import { and, eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@tinycld/core/lib/auth'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'
import { useCallback } from 'react'
import { useColorScheme } from 'react-native'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const APP = 'core'
const KEY = 'theme'

export function useThemePreference() {
    const systemScheme = useColorScheme()
    const { user, isLoggedIn } = useAuth({ throwIfAnon: false })
    const [userPreferencesCollection] = useStore('user_preferences')

    const { data: rows } = useLiveQuery(
        query =>
            query
                .from({ user_preferences: userPreferencesCollection })
                .where(({ user_preferences }) =>
                    and(
                        eq(user_preferences.app, APP),
                        eq(user_preferences.key, KEY),
                        eq(user_preferences.user, user?.id ?? '')
                    )
                ),
        [user?.id]
    )

    const existing = rows?.[0]
    const preference: ThemePreference =
        isLoggedIn && existing ? (existing.value as ThemePreference) : 'system'

    const upsert = useMutation({
        mutationFn: mutation(function* (newValue: ThemePreference) {
            if (!user) return
            if (existing) {
                yield userPreferencesCollection.update(existing.id, draft => {
                    draft.value = newValue
                })
            } else {
                yield userPreferencesCollection.insert({
                    id: newRecordId(),
                    app: APP,
                    key: KEY,
                    value: newValue,
                    user: user.id,
                })
            }
        }),
    })

    const setPreference = useCallback(
        (pref: ThemePreference) => {
            upsert.mutate(pref)
        },
        [upsert]
    )

    const resolved: ResolvedTheme =
        preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference

    return { preference, resolved, setPreference }
}
