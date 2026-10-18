// Dashboard behavior: language and naming toggles (both remembered), search, and local dates.
const root = document.documentElement
const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
}
const TEXT = {
  en: { search: 'Search apps' },
  es: { search: 'Buscar apps' },
}

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
