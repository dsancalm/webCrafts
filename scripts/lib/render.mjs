// The dashboard page (dist/index.html), rendered from the catalog and what the build installed.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// Text in both languages; the stylesheet shows the one in <html data-lang>.
const t = (en, es = en) => (en === es ? esc(en) : `<span class="l-en">${esc(en)}</span><span class="l-es">${esc(es)}</span>`)

const GITHUB_MARK =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.33.67.07-.52.28-.87.5-1.07-1.77-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z"/></svg>'

const TRASH_ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>'

const formatDate = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '')

function card(app, result) {
  const status = result?.status ?? 'missing'
  const href = status === 'ok' ? `${app.id}/` : status === 'external' ? app.external : null
  const search = [app.name, app.alternativeTo, app.description.en, app.description.es, app.repo].join(' ').toLowerCase()
  const badges = [
    app.experimental && `<span class="badge warn">${t('Experimental', 'Experimental')}</span>`,
    status === 'external' && result?.reason !== 'size' && `<span class="badge">${t('Hosted by the project', 'Alojada por el proyecto')}</span>`,
    status === 'external' && result?.reason === 'size' &&
      `<span class="badge">${t('Too big for GitHub Pages: opens a hosted copy', 'Demasiado grande para GitHub Pages: abre una copia alojada')}</span>`,
    status === 'too-big' && `<span class="badge muted">${t('Too big for GitHub Pages', 'Demasiado grande para GitHub Pages')}</span>`,
    status === 'missing' && `<span class="badge muted">${t('No web release yet', 'Aún sin versión web')}</span>`,
    status === 'failed' && `<span class="badge muted">${t('Unavailable in this build', 'No disponible en esta versión')}</span>`,
  ].filter(Boolean)
  const version =
    status === 'ok'
      ? `<a class="version" href="${esc(result.url)}" title="${esc(result.asset)}">${esc(result.tag)}</a>` +
        (result.date ? ` <time datetime="${esc(result.date)}">${formatDate(result.date)}</time>` : '')
      : ''
  const open = href
    ? `<a class="stretch" href="${esc(href)}"${status === 'external' ? ' rel="noopener"' : ''}><span class="visually-hidden">${t('Open', 'Abrir')} </span>` +
      `<span class="own">${esc(app.name)}</span><span class="alt">${esc(app.alternativeTo ?? app.name)}</span></a>`
    : `<span class="own">${esc(app.name)}</span><span class="alt">${esc(app.alternativeTo ?? app.name)}</span>`
  const subtitle = app.alternativeTo
    ? `<span class="own">${t('Alternative to', 'Alternativa a')} ${esc(app.alternativeTo)}</span>` +
      `<span class="alt">${esc(app.name)} · ${t('open source', 'código abierto')}</span>`
    : ''
  return `
        <article class="card${href ? '' : ' disabled'}" data-search="${esc(search)}" style="--accent:${esc(app.accent ?? '#8b8f9c')}">
          <img class="icon" src="icons/${esc(app.id)}.png" alt="" width="56" height="56" decoding="async">
          <div class="body">
            <h3 class="name">${open}</h3>
            <p class="subtitle">${subtitle}</p>
            <p class="description">${t(app.description.en, app.description.es)}</p>
            ${badges.length ? `<p class="badges">${badges.join(' ')}</p>` : ''}
            <p class="meta">${version}<a class="repo" href="https://github.com/${esc(app.repo)}" title="${esc(app.repo)}">${GITHUB_MARK}<span>${esc(app.repo)}</span></a></p>
          </div>
        </article>`
}

function section(group, results) {
  const heading = group.alternativeTo
    ? `<span class="own">${t(group.name.en, group.name.es)}</span><span class="alt">${esc(group.alternativeTo)}</span>`
    : t(group.name.en, group.name.es)
  return `
      <section class="group" aria-labelledby="g-${esc(group.id)}">
        <h2 id="g-${esc(group.id)}">${heading}</h2>
        <div class="grid">${group.apps.map((app) => card(app, results[app.id])).join('')}
        </div>
      </section>`
}

export function renderDashboard({ catalog, results, builtAt, siteRepo }) {
  const ready = catalog.apps.filter((a) => ['ok', 'external'].includes(results[a.id]?.status)).length
  const source = siteRepo ? `https://github.com/${siteRepo}` : null
  return `<!doctype html>
<html lang="en" data-lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>webCrafts</title>
  <meta name="description" content="Open-source alternatives to desktop creative and office apps, running in the browser.">
  <meta name="color-scheme" content="dark light">
  <link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
  <script>
    // Language and naming before the first paint (assets/main.js keeps them in sync with the toggles).
    {
      const root = document.documentElement
      const saved = (k) => { try { return localStorage.getItem(k) } catch { return null } }
      const q = new URLSearchParams(location.search)
      const lang = q.get('lang') || saved('webcrafts-lang') || (/^es\\b/i.test(navigator.language) ? 'es' : 'en')
      root.dataset.lang = lang === 'es' ? 'es' : 'en'
      root.lang = root.dataset.lang
      if (saved('webcrafts-naming') === 'alternative') root.dataset.naming = 'alternative'
    }
  </script>
  <link rel="stylesheet" href="assets/style.css">
  <script type="module" src="assets/main.js"></script>
</head>
<body>
  <a class="skip visually-hidden" href="#apps">${t('Skip to the apps', 'Ir a las apps')}</a>
  <header class="top">
    <div class="wrap">
      <p class="brand"><img src="assets/favicon.svg" alt="" width="22" height="22"> webCrafts</p>
      <div class="top-actions">
        <button type="button" class="reset-open" aria-haspopup="dialog">${TRASH_ICON}<span class="label">${t('Clear data', 'Borrar datos')}</span></button>
        <div class="lang" role="group" aria-label="Language / Idioma">
          <button type="button" data-set-lang="en">EN</button><button type="button" data-set-lang="es">ES</button>
        </div>
      </div>
    </div>
  </header>
  <main class="wrap">
    <section class="hero">
      <h1>${t('Creative and office apps, right in your browser.', 'Apps creativas y de oficina, directamente en tu navegador.')}</h1>
      <p class="lead">${t(
        `${ready} open-source alternatives to well-known creative and office software, compiled to WebAssembly. Nothing to install: your files stay on your device.`,
        `${ready} alternativas de código abierto a programas creativos y de oficina conocidos, compiladas a WebAssembly. Sin instalar nada: tus archivos se quedan en tu equipo.`,
      )}</p>
      <div class="controls">
        <label class="search">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"/></svg>
          <input type="search" id="filter" autocomplete="off" spellcheck="false" placeholder="Search apps" aria-label="Search apps">
          <kbd>/</kbd>
        </label>
        <label class="switch"><input type="checkbox" role="switch" id="naming"> ${t('Alternative naming', 'Nombres alternativos')}</label>
      </div>
    </section>
    <div id="apps">${catalog.groups.map((g) => section(g, results)).join('')}
      <p class="empty" hidden>${t('No app matches that search.', 'Ninguna app coincide con la búsqueda.')}</p>
    </div>
  </main>
  <footer class="wrap foot">
    <div class="foot-inner">
    <p>${t(
      'Each app is the official web build from the latest GitHub release of its project, served unmodified. A browser with hardware acceleration (WebGPU or WebGL 2) is strongly recommended.',
      'Cada app es la versión web oficial de la última release de su proyecto en GitHub, servida sin modificar. Se recomienda encarecidamente un navegador con aceleración por hardware (WebGPU o WebGL 2).',
    )}</p>
    <p>${t('Built', 'Generado el')} <time datetime="${esc(builtAt)}">${formatDate(builtAt)}</time>${
      source ? ` · <a href="${esc(source)}">${t('Source of this site', 'Código de este sitio')}</a>` : ''
    } · ${t('Inspired by', 'Inspirado en')} <a href="https://playground.daijro.dev/">playground.daijro.dev</a></p>
    <p class="legal">${t(
      'Not affiliated with, endorsed or sponsored by Adobe, Microsoft, Autodesk, Avid, Image-Line or Figma. Product names are trademarks of their owners and appear only to say which product each open-source project is an alternative to.',
      'Sin relación con Adobe, Microsoft, Autodesk, Avid, Image-Line ni Figma, ni respaldado o patrocinado por ellas. Los nombres de producto son marcas de sus propietarios y solo aparecen para indicar a qué producto sustituye cada proyecto de código abierto.',
    )}</p>
    </div>
  </footer>
  <dialog class="reset" aria-labelledby="reset-title" data-apps="${esc(catalog.apps.map((a) => a.id).join(' '))}">
    <form method="dialog">
      <h2 id="reset-title">${t('Clear app data', 'Borrar datos de las apps')}</h2>
      <p>${t(
        'Deletes everything the apps keep in this browser: service workers, cached files (WebAssembly included), databases, files in browser storage, cookies and local storage.',
        'Borra todo lo que las apps guardan en este navegador: service workers, archivos en caché (WebAssembly incluido), bases de datos, archivos del almacenamiento del navegador, cookies y almacenamiento local.',
      )}</p>
      <p class="warn">${t(
        'Documents, libraries and settings saved inside the apps are lost too. Close any app tabs you have open first.',
        'También se pierden los documentos, bibliotecas y ajustes guardados dentro de las apps. Cierra antes las pestañas de apps que tengas abiertas.',
      )}</p>
      <p class="shared" hidden>${t('Every GitHub Pages site at', 'Todos los sitios de GitHub Pages de')} <b class="host"></b> ${t(
        'shares this storage, so their databases, browser files and local storage are deleted as well.',
        'comparten este almacenamiento, así que sus bases de datos, archivos y almacenamiento local también se borran.',
      )}</p>
      <p class="note">${t(
        "The browser's regular HTTP cache can only be emptied from its settings; GitHub Pages has it check for new versions every 10 minutes.",
        'La caché HTTP normal del navegador solo se vacía desde sus ajustes; GitHub Pages hace que compruebe si hay versiones nuevas cada 10 minutos.',
      )}</p>
      <p class="usage" aria-live="polite"></p>
      <ul class="result" hidden></ul>
      <div class="actions">
        <button value="cancel" class="cancel">${t('Cancel', 'Cancelar')}</button>
        <button type="button" class="danger go">${t('Delete everything', 'Borrar todo')}</button>
        <button value="close" class="close" hidden>${t('Close', 'Cerrar')}</button>
      </div>
    </form>
  </dialog>
</body>
</html>
`
}

export function renderNotFound() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Not found · webCrafts</title>
  <meta name="color-scheme" content="dark light">
  <style>
    :root { --bg: #15161a; --text: #ececef; --muted: #9a9ca6; --link: #8ab4ff; }
    @media (prefers-color-scheme: light) { :root { --bg: #f6f6f8; --text: #17181c; --muted: #5b5e69; --link: #2457c5; } }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text);
      font: 16px/1.5 system-ui, sans-serif; padding: 16px; box-sizing: border-box; text-align: center; }
    p { color: var(--muted); } a { color: var(--link); }
  </style>
</head>
<body>
  <main>
    <h1>404</h1>
    <p>This page doesn't exist. · Esta página no existe.</p>
    <p><a id="home" href="/">webCrafts</a></p>
  </main>
  <script>
    // On <user>.github.io/<repo>/ the site lives one folder down.
    if (location.hostname.endsWith('.github.io')) {
      const first = location.pathname.split('/')[1]
      if (first) document.getElementById('home').href = '/' + first + '/'
    }
  </script>
</body>
</html>
`
}
