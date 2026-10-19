// Dashboard behavior: language and naming toggles (both remembered), search, and local dates.
const root = document.documentElement
const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
}
const TEXT = {
  en: {
    search: 'Search apps',
    usage: (size) => `Stored by this domain in the browser: ${size}`,
    usageAfter: (size) => `Stored now: ${size}`,
    working: 'Deleting…',
    removed: 'Deleted:',
    nothing: 'There was nothing to delete.',
    workers: (n) => `${n} service worker${n === 1 ? '' : 's'}`,
    caches: (n) => `${n} cache${n === 1 ? '' : 's'}`,
    cookies: (n) => `${n} cookie${n === 1 ? '' : 's'}`,
    failed: 'Some data could not be deleted (the browser console says why).',
    freeing: 'The browser frees the space once no app tab or worker is using it any more (usually within a minute): the figure above updates by itself.',
  },
  es: {
    search: 'Buscar apps',
    usage: (size) => `Guardado por este dominio en el navegador: ${size}`,
    usageAfter: (size) => `Guardado ahora: ${size}`,
    working: 'Borrando…',
    removed: 'Borrado:',
    nothing: 'No había nada que borrar.',
    workers: (n) => `${n} service worker${n === 1 ? '' : 's'}`,
    caches: (n) => `${n} caché${n === 1 ? '' : 's'}`,
    cookies: (n) => `${n} cookie${n === 1 ? '' : 's'}`,
    failed: 'No se pudieron borrar algunos datos (la consola del navegador dice por qué).',
    freeing: 'El navegador libera el espacio cuando ya no lo usa ninguna pestaña ni worker de las apps (normalmente en menos de un minuto): la cifra de arriba se actualiza sola.',
  },
}
const text = () => TEXT[root.dataset.lang === 'es' ? 'es' : 'en']

const filter = document.getElementById('filter')
const naming = document.getElementById('naming')
const langButtons = document.querySelectorAll('[data-set-lang]')

function applyLang(lang) {
  root.dataset.lang = lang
  root.lang = lang
  for (const b of langButtons) b.setAttribute('aria-pressed', String(b.dataset.setLang === lang))
  filter.placeholder = TEXT[lang].search
  filter.setAttribute('aria-label', TEXT[lang].search)
  const format = new Intl.DateTimeFormat(lang, { dateStyle: 'medium' })
  for (const time of document.querySelectorAll('time[datetime]')) {
    const date = new Date(time.getAttribute('datetime'))
    if (!Number.isNaN(date.getTime())) time.textContent = format.format(date)
  }
}

for (const b of langButtons) {
  b.addEventListener('click', () => {
    store.set('webcrafts-lang', b.dataset.setLang)
    applyLang(b.dataset.setLang)
  })
}
applyLang(root.dataset.lang === 'es' ? 'es' : 'en')

naming.checked = root.dataset.naming === 'alternative'
naming.addEventListener('change', () => {
  if (naming.checked) root.dataset.naming = 'alternative'
  else delete root.dataset.naming
  store.set('webcrafts-naming', naming.checked ? 'alternative' : 'own')
})

// Search: every word typed must appear in the card's name, alternative, description or repo.
const cards = [...document.querySelectorAll('.card')]
const groups = [...document.querySelectorAll('.group')]
const empty = document.querySelector('.empty')
const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
for (const card of cards) card.dataset.search = fold(card.dataset.search)

function search() {
  const words = fold(filter.value).split(/\s+/).filter(Boolean)
  for (const card of cards) card.hidden = !words.every((w) => card.dataset.search.includes(w))
  for (const group of groups) group.hidden = !group.querySelector('.card:not([hidden])')
  empty.hidden = cards.some((c) => !c.hidden)
}
filter.addEventListener('input', search)
filter.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    filter.value = ''
    search()
  } else if (e.key === 'Enter') {
    const first = cards.find((c) => !c.hidden && c.querySelector('.stretch'))
    first?.querySelector('.stretch').click()
  }
})
if (filter.value) search()

document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
  const target = e.target
  if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
  e.preventDefault()
  filter.focus()
})

// "Clear data": only what the apps keep in this browser under this site's folder: service workers, Cache
// Storage entries and cookies whose path is in it. IndexedDB, browser files (OPFS), local and session storage
// and cookies for '/' belong to the whole origin, which on <user>.github.io every Pages site of that user
// shares and can't be told apart by site, so they are left alone.
const dialog = document.querySelector('dialog.reset')
const base = new URL('.', location.href)
const inSite = (url) => url.startsWith(base.href)

const formatSize = (bytes) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`)
const usage = async () => {
  try {
    return (await navigator.storage.estimate()).usage
  } catch {
    return undefined
  }
}

// Runs in a short-lived worker (see clearSiteData): deletes the Cache Storage entries under `base` and says
// how many caches had some.
function clearCaches() {
  onmessage = async ({ data: base }) => {
    try {
      let count = 0
      for (const name of await caches.keys()) {
        const cache = await caches.open(name)
        const requests = await cache.keys()
        const mine = requests.filter((r) => r.url.startsWith(base))
        // (an empty cache can't be told apart by site: it stays)
        if (mine.length && mine.length === requests.length) await caches.delete(name)
        else await Promise.all(mine.map((r) => cache.delete(r)))
        if (mine.length) count++
      }
      postMessage({ count })
    } catch (e) {
      postMessage({ error: String(e) })
    }
  }
}

async function clearSiteData(appIds) {
  const done = { workers: 0, caches: 0, cookies: 0, failed: false }
  // Each step runs only where the browser has its API.
  const step = async (supported, fn) => {
    if (!supported) return
    try {
      await fn()
    } catch (e) {
      console.warn('webcrafts: clear data', e)
      done.failed = true
    }
  }
  await step('serviceWorker' in navigator, async () => {
    for (const registration of await navigator.serviceWorker.getRegistrations()) {
      if (inSite(registration.scope) && (await registration.unregister())) done.workers++
    }
  })
  await step('caches' in self, async () => {
    // A deleted cache stays on disk while any page or worker still holds it open, and each one has to be
    // opened to read its URLs: a worker does it, and ending the worker lets go of them at once.
    const url = URL.createObjectURL(new Blob([`(${clearCaches})()`], { type: 'text/javascript' }))
    const worker = new Worker(url)
    try {
      const answer = await new Promise((resolve, reject) => {
        worker.onmessage = (e) => resolve(e.data)
        worker.onerror = (e) => reject(e.message)
        worker.postMessage(base.href)
      })
      if (answer.error) throw answer.error
      done.caches = answer.count
    } finally {
      worker.terminate()
      URL.revokeObjectURL(url)
    }
  })
  await step(true, async () => {
    // A cookie is only visible from its own path: those the apps set for their folder are read and expired
    // through a hidden iframe of a small same-origin file there (the app's icon). document.cookie doesn't
    // say which path each one has, so every name seen is expired at this site's paths only, never at '/',
    // and what disappeared is counted. A cookie set without a path gets its page's folder without the
    // final slash ('/webCrafts/app'), one set with it keeps it: both are expired.
    const count = (doc) => doc.cookie.split(';').filter((c) => c.trim()).length
    const expire = (doc, folder) => {
      const before = count(doc)
      const names = new Set(doc.cookie.split(';').map((c) => c.split('=')[0].trim()).filter(Boolean))
      const paths = new Set([base.pathname, folder].flatMap((p) => [p, p.slice(0, -1)]).filter((p) => p.length > 1))
      for (const name of names) {
        for (const p of paths) doc.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${p}`
      }
      return before - count(doc)
    }
    done.cookies += expire(document, base.pathname)
    const inFolder = (id) =>
      new Promise((resolve) => {
        const frame = document.createElement('iframe')
        const finish = (n) => {
          frame.remove()
          resolve(n)
        }
        frame.hidden = true
        frame.onload = () => {
          try {
            finish(expire(frame.contentDocument, `${base.pathname}${id}/`))
          } catch {
            finish(0)
          }
        }
        setTimeout(() => finish(0), 5000)
        frame.src = `${base.pathname}${id}/webcrafts-icon.png`
        document.body.append(frame)
      })
    for (const n of await Promise.all(appIds.map(inFolder))) done.cookies += n
  })
  return done
}

if (dialog) {
  const appIds = dialog.dataset.apps.split(' ').filter(Boolean)
  const usageLine = dialog.querySelector('.usage')
  const result = dialog.querySelector('.result')
  const [cancel, go, close] = ['.cancel', '.go', '.close'].map((s) => dialog.querySelector(s))

  // The space comes back once nothing holds the deleted data open any more: an app's service worker stops
  // about 30 s after it's unregistered, an app tab when it closes. The figure follows it for a while.
  let watch = 0
  const followUsage = async () => {
    const run = ++watch
    for (let i = 0; i < 30; i++) {
      const bytes = await usage()
      if (run !== watch || !dialog.open) return
      usageLine.textContent = bytes === undefined ? '' : text().usageAfter(formatSize(bytes))
      if (!bytes) return
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }

  document.querySelector('.reset-open').addEventListener('click', async () => {
    watch++
    result.hidden = true
    result.replaceChildren()
    cancel.hidden = go.hidden = false
    close.hidden = true
    go.disabled = false
    usageLine.textContent = ''
    dialog.showModal()
    const bytes = await usage()
    if (bytes !== undefined) usageLine.textContent = text().usage(formatSize(bytes))
  })

  go.addEventListener('click', async () => {
    go.disabled = true
    usageLine.textContent = text().working
    const done = await clearSiteData(appIds)
    const t = text()
    const lines = ['workers', 'caches', 'cookies'].filter((k) => done[k]).map((k) => t[k](done[k]))
    const items = lines.length ? [t.removed, ...lines] : [t.nothing]
    if (done.failed) items.push(t.failed)
    if (done.workers || done.caches) items.push(t.freeing)
    result.replaceChildren(...items.map((line) => Object.assign(document.createElement('li'), { textContent: line })))
    result.hidden = false
    followUsage()
    cancel.hidden = go.hidden = true
    close.hidden = false
    close.focus()
  })
}
