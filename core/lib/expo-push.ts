import { Platform } from 'react-native'
import { pb } from './pocketbase'

export async function registerExpoPushToken(userId: string): Promise<boolean> {
    if (Platform.OS === 'web') return false

    try {
        const Notifications = await import('expo-notifications')

        const { status: existingStatus } = await Notifications.getPermissionsAsync()
        let finalStatus = existingStatus
        if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync()
            finalStatus = status
        }
        if (finalStatus !== 'granted') return false

        const tokenData = await Notifications.getExpoPushTokenAsync()
        const token = tokenData.data

        // Check if this token is already registered
        const existing = await pb.collection('push_subscriptions').getFullList({
            filter: `user = "${userId}" && platform = "expo" && expo_token = "${token}"`,
        })
        if (existing.length > 0) return true

        await pb.collection('push_subscriptions').create({
            user: userId,
            platform: 'expo',
            expo_token: token,
            endpoint: `expo://${token}`,
            keys: {},
        })
        return true
    } catch {
        return false
    }
}
