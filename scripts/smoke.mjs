#!/usr/bin/env node
// Opens the built site in headless Chromium, served like GitHub Pages serves it (scripts/serve.mjs), and
// checks that the dashboard links work and that each installed app's page loads its own files: any
// same-origin request answered with an error fails the check (a path problem), so does a Rust panic, and an
// app that needs cross-origin isolation must get it. Other console errors are reported but don't fail it:
// headless Chromium has no GPU, and several apps say so.
//
//   node scripts/smoke.mjs [--dir dist] [--wait 8000] [--only id,id] [--screenshots dir]
//
// Browser: $CHROME_PATH, else Playwright's Chromium in $PLAYWRIGHT_BROWSERS_PATH, else Chrome/Chromium.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import { serve } from './serve.mjs'

const { values: opts } = parseArgs({
  options: {
    dir: { type: 'string', default: 'dist' },
    wait: { type: 'string', default: '8000' },
    only: { type: 'string' },
    screenshots: { type: 'string' },
  },
})

function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (pw && existsSync(pw)) {
    for (const d of readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) if (existsSync(join(pw, d, sub))) return join(pw, d, sub)
    }
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
}

// Files apps ask for that their release doesn't ship, and do fine without: PhotoCraft's optional fonts/ folder
// and the CJK fonts LightCraft loads on demand.
const OPTIONAL = [/\/fonts\/manifest\.txt$/, /_zh_han[st]\.otf$/]

const { apps } = JSON.parse(readFileSync(join(opts.dir, 'versions.json'), 'utf8'))
const only = opts.only && new Set(opts.only.split(','))
const installed = Object.entries(apps).filter(([id, a]) => a.status === 'ok' && (!only || only.has(id))).map(([id]) => id)
const catalog = JSON.parse(readFileSync('apps.json', 'utf8')).groups.flatMap((g) => g.apps)
const isolated = new Set(catalog.filter((a) => a.isolated).map((a) => a.id))

const executablePath = findBrowser()
if (!executablePath) throw new Error('No Chrome/Chromium found: set CHROME_PATH')
const { server, url: site } = await serve({ dir: opts.dir, port: 0 })
const browser = await chromium.launch({
  executablePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
})
if (opts.screenshots) mkdirSync(opts.screenshots, { recursive: true })

const problems = []
const report = []

// The dashboard: every app link must answer 200.
{
  const page = await browser.newPage()
  await page.goto(site)
  const hrefs = await page.$$eval('a.stretch', (as) => as.map((a) => a.href).filter((h) => h.startsWith(location.origin)))
  for (const href of hrefs) {
    const status = (await page.request.get(href)).status()
    if (status !== 200) problems.push(`dashboard: ${href} answered ${status}`)
  }
  if (hrefs.length !== installed.length && !only) problems.push(`dashboard: ${hrefs.length} app links for ${installed.length} installed apps`)
  // (lazy images below the fold haven't loaded yet: ask for them)
  for (const src of await page.$$eval('img', (imgs) => imgs.map((i) => i.src))) {
    const status = (await page.request.get(src)).status()
    if (status !== 200) problems.push(`dashboard: image ${src} answered ${status}`)
  }
  if (opts.screenshots) await page.screenshot({ path: join(opts.screenshots, 'dashboard.png'), fullPage: true })
  await page.close()
  report.push(`dashboard: ${hrefs.length} app links OK`)
}

for (const id of installed) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const failed = []
  const errors = []
  const origin = new URL(site).origin
  const optional = []
  page.on('response', (r) => {
    if (!r.url().startsWith(origin) || r.status() < 400) return
    ;(OPTIONAL.some((re) => re.test(r.url())) ? optional : failed).push(`${r.status()} ${r.url().slice(origin.length)}`)
  })
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(origin) && !/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) failed.push(`${r.failure()?.errorText} ${r.url().slice(origin.length)}`)
  })
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().split('\n')[0]))
  try {
    await page.goto(`${site}${id}/`, { waitUntil: 'load', timeout: 60000 })
    await page.waitForTimeout(Number(opts.wait))
    const state = await page.evaluate(() => ({
      title: document.title,
      isolated: self.crossOriginIsolated,
      canvases: [...document.querySelectorAll('canvas')].filter((c) => c.width > 0 && c.height > 0).length,
    }))
    if (failed.length) problems.push(`${id}: ${failed.length} failed requests: ${[...new Set(failed)].slice(0, 5).join('; ')}`)
    const panic = errors.find((e) => /panicked at/.test(e))
    if (panic) problems.push(`${id}: ${panic.slice(0, 200)}`)
    if (isolated.has(id) && !state.isolated) problems.push(`${id}: not cross-origin isolated`)
    report.push(
      `${id}: "${state.title}", ${state.canvases} canvas(es)${isolated.has(id) ? `, isolated=${state.isolated}` : ''}` +
        (errors.length ? `, ${errors.length} console error(s), first: ${errors[0].slice(0, 160)}` : '') +
        (optional.length ? `, optional files missing: ${optional.join('; ')}` : ''),
    )
    if (opts.screenshots) await page.screenshot({ path: join(opts.screenshots, `${id}.png`) })
  } catch (e) {
    problems.push(`${id}: ${e.message.split('\n')[0]}`)
  }
  await context.close()
}

await browser.close()
server.close()
console.log(report.join('\n'))
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = ['### Smoke test', '', ...report.map((r) => `- ${r}`), '', problems.length ? `**${problems.length} problem(s):**` : 'Passed.', ...problems.map((p) => `- ${p}`)]
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.map((p) => `- ${p}`).join('\n')}`)
  process.exitCode = 1
} else console.log('\nSmoke test passed.')
