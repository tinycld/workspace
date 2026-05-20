import { useAuth } from '@tinycld/core/lib/auth'
import { registerExpoPushToken } from '@tinycld/core/lib/expo-push'
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'

export function useExpoPushRegistration() {
    const { user } = useAuth()
    const registered = useRef(false)

    useEffect(() => {
        if (Platform.OS === 'web' || registered.current || !user?.id) return
        registered.current = true
        registerExpoPushToken(user.id)
    }, [user?.id])
}
