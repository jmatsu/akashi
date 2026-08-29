// aka was a PWA here, so anyone who opened jmatsu.github.io/aka/ still has a
// service worker precaching the old app -- it would serve that build from cache
// forever and never reach the redirect page. This replaces it and takes itself
// out: the browser byte-compares this file against the workbox one it has and
// installs it, and this drops the caches, unregisters, and reloads the open
// tabs onto the redirect.
//
// It has to keep being served for as long as anyone might still be holding the
// old worker, which is why it is not a one-off deploy.

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
