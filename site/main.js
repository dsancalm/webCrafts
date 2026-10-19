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
    databases: (n) => `${n} database${n === 1 ? '' : 's'}`,
    files: (n) => `${n} file${n === 1 ? '' : 's'} or folder${n === 1 ? '' : 's'} in browser storage`,
    cookies: (n) => `${n} cookie${n === 1 ? '' : 's'}`,
    storage: (n) => `${n} local storage entr${n === 1 ? 'y' : 'ies'}`,
    blocked: 'Some data is in use by an app tab that is still open: close it and delete again.',
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
    databases: (n) => `${n} base${n === 1 ? '' : 's'} de datos`,
    files: (n) => `${n} archivo${n === 1 ? '' : 's'} o carpeta${n === 1 ? '' : 's'} del almacenamiento del navegador`,
    cookies: (n) => `${n} cookie${n === 1 ? '' : 's'}`,
    storage: (n) => `${n} entrada${n === 1 ? '' : 's'} de almacenamiento local`,
    blocked: 'Algunos datos los está usando una pestaña de app que sigue abierta: ciérrala y vuelve a borrar.',
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

// "Clear data": everything the apps keep in this browser. Service workers and Cache Storage entries are
// matched to this site's folder. IndexedDB, browser files (OPFS), cookies and local storage belong to the
// whole origin, which on <user>.github.io every Pages site of that user shares: the dialog says so there.
// The dashboard's own two settings (language, naming) are kept.
const dialog = document.querySelector('dialog.reset')
const base = new URL('.', location.href)
const inSite = (url) => url.startsWith(base.href)
const PREFS = ['webcrafts-lang', 'webcrafts-naming']

const formatSize = (bytes) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`)
const usage = async () => {
  try {
    return (await navigator.storage.estimate()).usage
  } catch {
    return undefined
  }
}

const deleteDatabase = (name) =>
  new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve(true)
    request.onerror = () => resolve(false)
    // Another tab still has it open: it goes once that tab closes; don't wait for it.
    request.onblocked = () => setTimeout(() => resolve(false), 1500)
  })

async function clearSiteData(appIds) {
  const done = { workers: 0, caches: 0, databases: 0, files: 0, cookies: 0, storage: 0, blocked: false }
  // Each step runs only where the browser has its API; a failure means the data is in use.
  const step = async (supported, fn) => {
    if (!supported) return
    try {
      await fn()
    } catch (e) {
      console.warn('webcrafts: clear data', e)
      done.blocked = true
    }
  }
  await step('serviceWorker' in navigator, async () => {
    for (const registration of await navigator.serviceWorker.getRegistrations()) {
      if (inSite(registration.scope) && (await registration.unregister())) done.workers++
    }
  })
  await step('caches' in self, async () => {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      const requests = await cache.keys()
      const mine = requests.filter((r) => inSite(r.url))
      if (mine.length === requests.length) await caches.delete(name)
      else await Promise.all(mine.map((r) => cache.delete(r)))
      if (mine.length) done.caches++
    }
  })
  await step(typeof indexedDB !== 'undefined' && 'databases' in indexedDB, async () => {
    for (const { name } of await indexedDB.databases()) {
      if (await deleteDatabase(name)) done.databases++
      else done.blocked = true
    }
  })
  await step(typeof navigator.storage?.getDirectory === 'function', async () => {
    const dir = await navigator.storage.getDirectory()
    const names = []
    for await (const name of dir.keys()) names.push(name)
    for (const name of names) {
      try {
        await dir.removeEntry(name, { recursive: true })
        done.files++
      } catch {
        done.blocked = true // open in an app tab
      }
    }
  })
  await step(true, async () => {
    // A cookie is only visible from its own path: those the apps set for their folder are read and expired
    // through a hidden iframe of a small same-origin file there (the app's icon).
    const expire = (doc, path) => {
      const names = new Set(doc.cookie.split(';').map((c) => c.split('=')[0].trim()).filter(Boolean))
      for (const name of names) {
        for (const p of new Set(['/', base.pathname, path])) doc.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${p}`
      }
      return names.size
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
  await step(true, () => {
    const kept = PREFS.map((k) => [k, localStorage.getItem(k)]).filter(([, v]) => v !== null)
    done.storage = localStorage.length - kept.length + sessionStorage.length
    localStorage.clear()
    sessionStorage.clear()
    for (const [k, v] of kept) localStorage.setItem(k, v)
  })
  return done
}

if (dialog) {
  const appIds = dialog.dataset.apps.split(' ').filter(Boolean)
  const usageLine = dialog.querySelector('.usage')
  const result = dialog.querySelector('.result')
  const [cancel, go, close] = ['.cancel', '.go', '.close'].map((s) => dialog.querySelector(s))
  if (location.hostname.endsWith('.github.io') && base.pathname !== '/') {
    dialog.querySelector('.shared').hidden = false
    dialog.querySelector('.host').textContent = location.hostname
  }

  document.querySelector('.reset-open').addEventListener('click', async () => {
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
    const lines = ['workers', 'caches', 'databases', 'files', 'cookies', 'storage'].filter((k) => done[k]).map((k) => t[k](done[k]))
    const items = lines.length ? [t.removed, ...lines] : [t.nothing]
    if (done.blocked) items.push(t.blocked)
    result.replaceChildren(...items.map((line) => Object.assign(document.createElement('li'), { textContent: line })))
    result.hidden = false
    const bytes = await usage()
    usageLine.textContent = bytes === undefined ? '' : t.usageAfter(formatSize(bytes))
    cancel.hidden = go.hidden = true
    close.hidden = false
    close.focus()
  })
}
