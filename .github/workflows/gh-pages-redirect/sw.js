// Akashi was a PWA here under its old name, so anyone who opened
// jmatsu.github.io/aka/ still has a service worker precaching the old app --
// it would serve that build from cache forever and never reach the redirect
// page. Replacing that worker with this one is what reaches them, since the
// browser refetches this path even when every navigation is answered from the
// cache.
//
// So it has to keep being served for as long as anyone might still hold the old
// worker: this file is not a one-off deploy, and deleting it strands them.

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
      await self.registration.unregister()
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const client of clients) client.navigate(client.url)
    })(),
  )
})
