self.addEventListener('push', event => {
    if (!event.data) return

    const data = event.data.json()
    const options = {
        body: data.body || '',
        icon: '/app-icon.png',
        tag: data.tag || undefined,
        data: { url: data.url || '/' },
    }

    event.waitUntil(self.registration.showNotification(data.title || 'TinyCld', options))
})

self.addEventListener('notificationclick', event => {
    event.notification.close()

    const url = event.notification.data?.url || '/'

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (const client of windowClients) {
                if (client.url.includes(url) && 'focus' in client) {
                    return client.focus()
                }
            }
            return clients.openWindow(url)
        })
    )
})
