// Cross-origin isolation for pages served by a host that can't send COOP/COEP headers (GitHub Pages).
// webcrafts-coi-sw.js, a service worker scoped to this app's folder, adds the headers to every response;
// the build held back this page's module scripts (type="text/x-webcrafts-module"), and they start here
// once the page is isolated, or straight away when it can't be (the app then reports what it lacks).
;(() => {
  const KEY = 'webcrafts-coi-reloaded'
  const worker = new URL('webcrafts-coi-sw.js', document.currentScript.src)
  const session = {
    get: () => { try { return sessionStorage.getItem(KEY) } catch { return null } },
    set: () => { try { sessionStorage.setItem(KEY, '1') } catch {} },
    clear: () => { try { sessionStorage.removeItem(KEY) } catch {} },
  }

  const start = () => {
    for (const held of document.querySelectorAll('script[type="text/x-webcrafts-module"]')) {
      const script = document.createElement('script')
      for (const { name, value } of held.attributes) if (name !== 'type') script.setAttribute(name, value)
      script.type = 'module'
      script.textContent = held.textContent
      held.replaceWith(script)
    }
  }
  const startWhenParsed = () => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
    else start()
  }
  const reload = () => {
    session.set()
    location.reload()
  }

  if (window.crossOriginIsolated) {
    session.clear()
    return startWhenParsed()
  }
  // No service workers (insecure origin, some private modes), or the reload didn't help: give up.
  if (!window.isSecureContext || !('serviceWorker' in navigator) || session.get()) {
    session.clear()
    return startWhenParsed()
  }
  navigator.serviceWorker.register(worker).then(
    (registration) => {
      // Already in charge, but this load bypassed it (a hard reload): load again through it.
      if (navigator.serviceWorker.controller) return reload()
      navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true })
      // A worker that was already active claims nothing new; nudge it.
      registration.active?.postMessage('claim')
    },
    (error) => {
      console.warn('webcrafts: cross-origin isolation service worker failed to register', error)
      startWhenParsed()
    },
  )
})()
