#!/usr/bin/env node
// Builds the static site into dist/: the dashboard, plus each app of apps.json unpacked from the web zip of
// its newest GitHub release into dist/<id>/.
//
//   node scripts/build.mjs [--out dist] [--cache .cache] [--only id,id] [--list] [--strict] [--catalog apps.json]
//                          [--budget-mb 950]
//
//   --only       build just these apps (the others show as unavailable)
//   --list       only print the release each app would be installed from
//   --strict     exit with an error when an app with a web release fails to install
//   --budget-mb  the most the site may weigh; over it, the biggest apps are linked to their hosted copy
//                (`external` in apps.json), or else left out
//
// Set GITHUB_TOKEN to lift GitHub's anonymous API limit (60 requests an hour).
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { loadCatalog } from './lib/catalog.mjs'
import { downloadAsset, listReleases } from './lib/github.mjs'
import { installZip, walk } from './lib/install.mjs'
import { pickRelease } from './lib/releases.mjs'
import { renderDashboard, renderNotFound } from './lib/render.mjs'

// GitHub Pages: published sites may be at most 1 GB, and git-hosted files at most 100 MB.
const SITE_LIMIT = 1e9
const FILE_WARN = 100 * 1024 ** 2

const { values: opts } = parseArgs({
  options: {
    out: { type: 'string', default: 'dist' },
    cache: { type: 'string', default: '.cache' },
    only: { type: 'string' },
    list: { type: 'boolean', default: false },
    strict: { type: 'boolean', default: false },
    catalog: { type: 'string', default: 'apps.json' },
    'budget-mb': { type: 'string', default: '950' },
  },
})

const catalog = loadCatalog(opts.catalog)
const only = opts.only ? new Set(opts.only.split(',').map((s) => s.trim())) : null
for (const id of only ?? []) if (!catalog.apps.some((a) => a.id === id)) throw new Error(`--only: no app "${id}" in apps.json`)
const mb = (n) => `${(n / 1024 ** 2).toFixed(1)} MB`
const warn = (message) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${message}` : `Warning: ${message}`)

// Runs `fn` over `items`, `limit` at a time.
async function pool(items, limit, fn) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  }))
}

async function resolve(app) {
  const pick = pickRelease(await listReleases(app.repo), app)
  return pick && { release: pick.release, asset: pick.asset }
}

if (opts.list) {
  await pool(catalog.apps, 4, async (app) => {
    try {
      const r = await resolve(app)
      console.log(r ? `${app.id}: ${r.release.tag_name}${r.release.prerelease ? ' (pre-release)' : ''} ${r.asset.name} ${mb(r.asset.size)}` : `${app.id}: no web release${app.external ? `, links to ${app.external}` : ''}`)
    } catch (e) {
      console.log(`${app.id}: ERROR ${e.message}`)
    }
  })
  process.exit(0)
}

const out = opts.out
rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'assets'), { recursive: true })
mkdirSync(join(out, 'icons'), { recursive: true })
mkdirSync(opts.cache, { recursive: true })
for (const f of ['style.css', 'main.js', 'favicon.svg']) cpSync(join('site', f), join(out, 'assets', f))
for (const app of catalog.apps) {
  const icon = join('icons', `${app.id}.png`)
  if (existsSync(icon)) cpSync(icon, join(out, 'icons', `${app.id}.png`))
  else console.warn(`${app.id}: no ${icon}`)
}

const results = {}
const usedZips = new Set()
let failures = 0

await pool(catalog.apps, 3, async (app) => {
  if (only && !only.has(app.id)) return (results[app.id] = { status: 'skipped' })
  try {
    const picked = await resolve(app)
    if (!picked) {
      results[app.id] = { status: app.external ? 'external' : 'missing' }
      return console.log(`${app.id}: no web release${app.external ? `; linking to ${app.external}` : ''}`)
    }
    const { release, asset } = picked
    const zip = join(opts.cache, `${app.id}-${asset.id}.zip`)
    usedZips.add(zip)
    if (existsSync(zip) && statSync(zip).size === asset.size) {
      console.log(`${app.id}: ${asset.name} (cached)`)
    } else {
      console.log(`${app.id}: downloading ${asset.name} (${mb(asset.size)}) from ${release.tag_name}`)
      await downloadAsset(asset, `${zip}.part`)
      rmSync(zip, { force: true })
      cpSync(`${zip}.part`, zip)
      rmSync(`${zip}.part`, { force: true })
    }
    const facts = installZip(zip, join(out, app.id), { app, iconPath: join('icons', `${app.id}.png`), siteDir: 'site' })
    results[app.id] = {
      status: 'ok',
      tag: release.tag_name,
      prerelease: release.prerelease,
      date: release.published_at,
      url: release.html_url,
      asset: asset.name,
      ...facts,
    }
    console.log(`${app.id}: installed ${release.tag_name}, ${facts.files} files, ${mb(facts.bytes)}${facts.removed.length ? ` (dropped ${facts.removed.join(', ')})` : ''}`)
  } catch (e) {
    failures++
    results[app.id] = { status: app.external ? 'external' : 'failed', error: e.message }
    console.error(`${app.id}: FAILED ${e.message}`)
  }
})

// Over the size budget, the biggest apps go first: to their hosted copy when they have one, else left out.
const budget = Number(opts['budget-mb']) * 1024 ** 2
let total = walk(out).reduce((n, f) => n + statSync(f).size, 0)
while (total > budget) {
  const installed = catalog.apps.filter((a) => results[a.id]?.status === 'ok').sort((a, b) => results[b.id].bytes - results[a.id].bytes)
  const app = installed.find((a) => a.external) ?? installed[0]
  if (!app) break
  const { bytes, tag } = results[app.id]
  rmSync(join(out, app.id), { recursive: true, force: true })
  total -= bytes
  results[app.id] = { status: app.external ? 'external' : 'too-big', reason: 'size', tag, bytes, error: `${tag} is ${mb(bytes)}: over the site's size budget` }
  warn(`${app.id} ${tag} (${mb(bytes)}) doesn't fit the ${opts['budget-mb']} MB budget: ${app.external ? `linking to ${app.external}` : 'left out'}`)
}

const builtAt = new Date().toISOString()
writeFileSync(join(out, 'index.html'), renderDashboard({ catalog, results, builtAt, siteRepo: process.env.GITHUB_REPOSITORY }))
writeFileSync(join(out, '404.html'), renderNotFound())
writeFileSync(join(out, '.nojekyll'), '')
const versions = Object.fromEntries(
  catalog.apps.map((a) => {
    const { status, reason, tag, date, asset, bytes, error } = results[a.id] ?? {}
    return [a.id, { status, reason, repo: a.repo, tag, date, asset, bytes, error }]
  }),
)
writeFileSync(join(out, 'versions.json'), JSON.stringify({ builtAt, apps: versions }, null, 2) + '\n')

// Zips of releases no longer current only take cache space.
for (const f of readdirSync(opts.cache)) {
  const p = join(opts.cache, f)
  if (f.endsWith('.zip') && !usedZips.has(p) && !only) rmSync(p, { force: true })
}

// Report.
const files = walk(out)
total = files.reduce((n, f) => n + statSync(f).size, 0)
const big = files.filter((f) => statSync(f).size > FILE_WARN)
const rows = catalog.apps.map((a) => {
  const r = results[a.id] ?? {}
  return `| ${a.name} | ${r.status}${r.reason ? ` (${r.reason})` : ''} | ${r.tag ?? ''} | ${r.bytes ? mb(r.bytes) : ''} | ${(r.error ?? '').replace(/\|/g, '\\|')} |`
})
const summary = [
  `### webCrafts build`,
  '',
  `| App | Status | Release | Size | Note |`,
  `|---|---|---|---|---|`,
  ...rows,
  '',
  `Site total: **${mb(total)}** (budget ${opts['budget-mb']} MB; GitHub Pages allows 1 GB).`,
  ...big.map((f) => `- Warning: ${f} is ${mb(statSync(f).size)}`),
].join('\n')
console.log(`\n${summary}\n`)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n')

if (total > SITE_LIMIT) {
  console.error(`The site is ${mb(total)}, over GitHub Pages' 1 GB limit.`)
  process.exitCode = 1
}
const installed = Object.values(results).filter((r) => r.status === 'ok').length
if (!installed && !only) {
  console.error('No app could be installed.')
  process.exitCode = 1
}
if (opts.strict && failures) process.exitCode = 1
