import { Platform } from 'react-native'
import { pb } from './pocketbase'

export function isPushSupported(): boolean {
    return (
        Platform.OS === 'web' &&
        typeof navigator !== 'undefined' &&
        'serviceWorker' in navigator &&
        'PushManager' in window
    )
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!isPushSupported()) return null
    return navigator.serviceWorker.register('/sw.js')
}

export async function subscribeToPush(userId: string): Promise<boolean> {
    if (!isPushSupported()) return false

    const registration = await registerServiceWorker()
    if (!registration) return false

    const publicKey = process.env.VITE_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY
    if (!publicKey) return false

    const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    })

    const subscriptionJSON = subscription.toJSON()

    await pb.collection('push_subscriptions').create({
        user: userId,
        endpoint: subscriptionJSON.endpoint,
        keys: {
            p256dh: subscriptionJSON.keys?.p256dh,
            auth: subscriptionJSON.keys?.auth,
        },
        user_agent: navigator.userAgent.slice(0, 500),
        platform: 'web',
    })

    return true
}

export async function unsubscribeFromPush(userId: string): Promise<void> {
    if (!isPushSupported()) return

    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (subscription) {
        await subscription.unsubscribe()

        const records = await pb.collection('push_subscriptions').getFullList({
            filter: `user = "${userId}" && endpoint = "${subscription.endpoint}"`,
        })
        for (const record of records) {
            await pb.collection('push_subscriptions').delete(record.id)
        }
    }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = atob(base64)
    const outputArray = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
}
