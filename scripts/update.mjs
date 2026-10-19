#!/usr/bin/env node
// The daily check (.github/workflows/update.yml): moves each app in versions.lock.json to its newest stable
// release with a web zip (an app with `prerelease: true` in apps.json: its newest release of any kind). An
// app without one stays on the version it has. Each app keeps its last 3 tags.
//
//   node scripts/update.mjs [--catalog apps.json] [--lock versions.lock.json] [--message-file path]
//
// On GitHub Actions (GITHUB_OUTPUT set) it reports `changed` (an app moved: deploy) and `commit` (the file
// changed: commit it); --message-file gets the commit message.
import { appendFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { loadCatalog } from './lib/catalog.mjs'
import { listReleases } from './lib/github.mjs'
import { lockedTag, promote, readLock, writeLock } from './lib/lock.mjs'
import { pickRelease } from './lib/releases.mjs'

const { values: opts } = parseArgs({
  options: {
    catalog: { type: 'string', default: 'apps.json' },
    lock: { type: 'string', default: 'versions.lock.json' },
    'message-file': { type: 'string' },
  },
})

const catalog = loadCatalog(opts.catalog)
const lock = readLock(opts.lock)
const updates = []
let failures = 0

for (const app of catalog.apps) {
  const current = lockedTag(lock, app.id)
  try {
    const pick = pickRelease(await listReleases(app.repo), app)
    if (!pick) {
      console.log(`${app.id}: no ${app.prerelease ? '' : 'stable '}release with a web zip; stays on ${current ?? 'nothing'}`)
      continue
    }
    const tag = pick.release.tag_name
    if (tag === current) {
      console.log(`${app.id}: ${tag}, up to date`)
      continue
    }
    promote(lock, app.id, tag)
    updates.push(`${app.name} ${current ? `${current} → ` : ''}${tag}`)
    console.log(`${app.id}: ${current ?? 'nothing'} → ${tag}`)
  } catch (e) {
    failures++
    console.error(`${app.id}: ${e.message}; stays on ${current ?? 'nothing'}`)
  }
}

// Apps no longer in the catalog leave the file too. That alone needs no deploy: their removal shipped with it.
const ids = new Set(catalog.apps.map((a) => a.id))
const dropped = Object.keys(lock.apps).filter((id) => !ids.has(id))
for (const id of dropped) delete lock.apps[id]

const changed = updates.length > 0
const commit = changed || dropped.length > 0
if (commit) writeLock(opts.lock, lock, catalog.apps.map((a) => a.id))
const message = changed ? `Update ${updates.join(', ')}` : `Drop ${dropped.join(', ')} from versions.lock.json`
console.log(changed ? `\n${message}` : '\nNo app has a new release: nothing to deploy.')

if (opts['message-file'] && commit) writeFileSync(opts['message-file'], `${message}\n`)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\ncommit=${commit}\n`)
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = changed ? ['### New releases', '', ...updates.map((u) => `- ${u}`)] : ['No app has a new release: nothing to deploy.']
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
}
// Every lookup failing means GitHub's API is down or refusing us: worth a red run.
if (failures === catalog.apps.length) process.exitCode = 1
