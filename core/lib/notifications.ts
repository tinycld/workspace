import { Platform } from 'react-native'
import { registerServiceWorker } from './web-push'

interface NotifyOptions {
    title: string
    body?: string
    data?: Record<string, unknown>
}

interface ScheduleOptions extends NotifyOptions {
    /** Fire at this exact Date */
    triggerAt: Date
    /** Stable identifier so the same reminder isn't scheduled twice */
    identifier?: string
}

let permissionGranted: boolean | null = null

/**
 * Request permission to show OS-level notifications.
 * Call once early in the app lifecycle (e.g. from a provider).
 * Returns true if granted, false otherwise.
 */
export async function requestNotificationPermission(): Promise<boolean> {
    if (permissionGranted !== null) return permissionGranted

    if (Platform.OS === 'web') {
        if (typeof Notification === 'undefined') {
            permissionGranted = false
            return false
        }
        if (Notification.permission === 'granted') {
            permissionGranted = true
            registerServiceWorker()
            return true
        }
        if (Notification.permission === 'denied') {
            permissionGranted = false
            return false
        }
        const result = await Notification.requestPermission()
        permissionGranted = result === 'granted'
        if (permissionGranted) {
            registerServiceWorker()
        }
        return permissionGranted
    }

    // Native (iOS / Android)
    const ExpoNotifications = await import('expo-notifications')
    const { status: existing } = await ExpoNotifications.getPermissionsAsync()
    if (existing === 'granted') {
        permissionGranted = true
        return true
    }
    const { status } = await ExpoNotifications.requestPermissionsAsync()
    permissionGranted = status === 'granted'
    return permissionGranted
}

/**
 * Show an OS notification immediately.
 */
export async function notify({ title, body, data }: NotifyOptions): Promise<void> {
    const allowed = await requestNotificationPermission()
    if (!allowed) return

    if (Platform.OS === 'web') {
        new Notification(title, { body: body ?? undefined })
        return
    }

    const ExpoNotifications = await import('expo-notifications')
    await ExpoNotifications.scheduleNotificationAsync({
        content: { title, body: body ?? undefined, data: data ?? {} },
        trigger: null, // fire immediately
    })
}

/**
 * Schedule an OS notification for a future time.
 * Returns the scheduled notification identifier (useful for cancellation).
 */
export async function scheduleNotification({
    title,
    body,
    data,
    triggerAt,
    identifier,
}: ScheduleOptions): Promise<string | null> {
    const allowed = await requestNotificationPermission()
    if (!allowed) return null

    const secondsUntil = Math.max(0, (triggerAt.getTime() - Date.now()) / 1000)
    if (secondsUntil <= 0) {
        await notify({ title, body, data })
        return null
    }

    if (Platform.OS === 'web') {
        const ms = secondsUntil * 1000
        const timerId = setTimeout(() => {
            new Notification(title, { body: body ?? undefined })
        }, ms)
        // Store timer so it can be cancelled
        if (identifier) {
            webTimers.set(identifier, timerId)
        }
        return identifier ?? null
    }

    const ExpoNotifications = await import('expo-notifications')

    // Cancel any existing notification with the same identifier
    if (identifier) {
        await ExpoNotifications.cancelScheduledNotificationAsync(identifier).catch(() => {})
    }

    const id = await ExpoNotifications.scheduleNotificationAsync({
        identifier: identifier ?? undefined,
        content: { title, body: body ?? undefined, data: data ?? {} },
        trigger: {
            type: ExpoNotifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: Math.ceil(secondsUntil),
        },
    })
    return id
}

/**
 * Cancel a previously scheduled notification.
 */
export async function cancelNotification(identifier: string): Promise<void> {
    if (Platform.OS === 'web') {
        const timerId = webTimers.get(identifier)
        if (timerId != null) {
            clearTimeout(timerId)
            webTimers.delete(identifier)
        }
        return
    }

    const ExpoNotifications = await import('expo-notifications')
    await ExpoNotifications.cancelScheduledNotificationAsync(identifier).catch(() => {})
}

/**
 * Cancel all scheduled notifications.
 */
export async function cancelAllNotifications(): Promise<void> {
    if (Platform.OS === 'web') {
        webTimers.forEach(timerId => {
            clearTimeout(timerId)
        })
        webTimers.clear()
        return
    }

    const ExpoNotifications = await import('expo-notifications')
    await ExpoNotifications.cancelAllScheduledNotificationsAsync()
}

// Web: track setTimeout IDs so scheduled notifications can be cancelled
const webTimers = new Map<string, ReturnType<typeof setTimeout>>()
