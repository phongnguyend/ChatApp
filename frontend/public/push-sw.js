self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      const isAppActive = windows.some(
        (client) =>
          new URL(client.url).origin === self.location.origin &&
          client.visibilityState === 'visible' &&
          client.focused,
      )
      if (isAppActive) return

      let payload = {}
      try {
        payload = event.data ? event.data.json() : {}
      } catch {
        payload = { body: event.data ? event.data.text() : '' }
      }

      await self.registration.showNotification(payload.title || 'Huddle', {
        body: payload.body || 'You have a new message.',
        tag: payload.tag || 'huddle-message',
        data: {
          url: payload.url || '/',
          conversationId: payload.conversationId,
        },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const targetUrl = new URL(
        event.notification.data?.url || '/',
        self.location.origin,
      ).toString()
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      const existing = windows.find(
        (client) => new URL(client.url).origin === self.location.origin,
      )
      if (existing) {
        await existing.navigate(targetUrl)
        return existing.focus()
      }
      return self.clients.openWindow(targetUrl)
    })(),
  )
})
