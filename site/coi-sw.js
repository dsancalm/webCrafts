// Service worker that makes the pages in its folder cross-origin isolated (see webcrafts-coi.js): it
// passes every request through and adds COOP/COEP to the answers, plus CORP so same-site resources load
// under require-corp. Opaque (no-cors cross-origin) answers can't be changed and are passed through as is.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('message', (event) => {
  if (event.data === 'claim') self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  // Chrome throws on these when they're re-fetched from a worker.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return
  event.respondWith(
    fetch(request).then((response) => {
      if (response.status === 0) return response
      const headers = new Headers(response.headers)
      headers.set('Cross-Origin-Opener-Policy', 'same-origin')
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
      if (!headers.has('Cross-Origin-Resource-Policy')) headers.set('Cross-Origin-Resource-Policy', 'same-site')
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    }),
  )
})
