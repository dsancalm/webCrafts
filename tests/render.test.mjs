import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCatalog } from '../scripts/lib/catalog.mjs'
import { renderDashboard } from '../scripts/lib/render.mjs'

const catalog = parseCatalog({
  groups: [
    {
      id: 'g',
      name: { en: 'Group', es: 'Grupo' },
      alternativeTo: 'Suite',
      apps: [
        { id: 'ready', name: 'Ready<b>', repo: 'o/ready', alternativeTo: 'Big App', description: { en: 'Ready "app"', es: 'App lista' } },
        { id: 'hosted', name: 'Hosted', repo: 'o/hosted', external: 'https://o.github.io/hosted/', description: { en: 'Hosted' } },
        { id: 'none', name: 'None', repo: 'o/none', experimental: true, description: { en: 'None' } },
        { id: 'broken', name: 'Broken', repo: 'o/broken', description: { en: 'Broken' } },
      ],
    },
  ],
})
const results = {
  ready: { status: 'ok', tag: 'v1.2.3', date: '2026-10-01T10:00:00Z', url: 'https://github.com/o/ready/releases/tag/v1.2.3', asset: 'ready-web-1.2.3.zip' },
  hosted: { status: 'external' },
  none: { status: 'missing' },
  broken: { status: 'failed', error: 'boom' },
}
const html = renderDashboard({ catalog, results, builtAt: '2026-10-18T00:00:00Z', siteRepo: 'me/site' })

test('links installed apps relatively, so the site works under any base path', () => {
  assert.match(html, /<a class="stretch" href="ready\/">/)
  assert.ok(!/href="\/ready/.test(html))
  assert.match(html, /<a class="version" href="https:\/\/github.com\/o\/ready\/releases\/tag\/v1.2.3"/)
  assert.match(html, /<time datetime="2026-10-01T10:00:00Z">2026-10-01<\/time>/)
})

test('external, missing and failed apps', () => {
  assert.match(html, /href="https:\/\/o.github.io\/hosted\/" rel="noopener"/)
  assert.match(html, /Hosted by the project/)
  assert.match(html, /No web release yet/)
  assert.match(html, /Unavailable in this build/)
  assert.match(html, /Experimental/)
  assert.equal((html.match(/class="card disabled"/g) ?? []).length, 2)
})

test('escapes catalog text and renders both languages and namings', () => {
  assert.match(html, /Ready&lt;b&gt;/)
  assert.ok(!html.includes('Ready<b>'))
  assert.match(html, /Ready &quot;app&quot;/)
  assert.match(html, /<span class="l-en">Group<\/span><span class="l-es">Grupo<\/span>/)
  assert.match(html, /<span class="alt">Suite<\/span>/)
  assert.match(html, /<span class="alt">Big App<\/span>/)
  assert.match(html, /href="https:\/\/github.com\/me\/site"/)
  // two of four apps are usable
  assert.match(html, /<span class="l-en">2 open-source alternatives/)
})

test('the headline flows across the width and the clear-data dialog knows every app', () => {
  assert.ok(!/<h1>[^]*<br>[^]*<\/h1>/.test(html))
  assert.match(html, /<button type="button" class="reset-open"/)
  assert.match(html, /<dialog class="reset"[^>]* data-apps="ready hosted none broken"/)
  assert.match(html, /<span class="l-es">Borrar<\/span>/)
  // it only clears what is under the site's folder, and says what it keeps
  assert.match(html, /<span class="l-es">Se conservan las bases de datos/)
  assert.ok(!/class="shared"/.test(html))
  assert.match(html, /<div class="foot-inner">/)
})
