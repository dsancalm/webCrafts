import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// versions.lock.json: the release tags each app has been on, newest (the deployed one) first, at most KEEP.
// scripts/update.mjs moves it forward; scripts/build.mjs installs the first tag of each app.
export const KEEP = 3

export function readLock(file) {
  if (!existsSync(file)) return { apps: {} }
  const lock = JSON.parse(readFileSync(file, 'utf8'))
  return { ...lock, apps: lock.apps ?? {} }
}

export const lockedTag = (lock, id) => lock.apps[id]?.[0]

// Puts `tag` first in the app's list, keeping the KEEP most recent tags.
export function promote(lock, id, tag) {
  lock.apps[id] = [tag, ...(lock.apps[id] ?? []).filter((t) => t !== tag)].slice(0, KEEP)
}

// One app per line, in catalog order, so the file reads well and diffs show one line per update.
export function writeLock(file, lock, order) {
  const ids = [...order.filter((id) => lock.apps[id]), ...Object.keys(lock.apps).filter((id) => !order.includes(id))]
  const lines = ids.map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(lock.apps[id])}`)
  const comment = 'Release tag of each app, newest (the deployed one) first, at most 3. Updated daily by .github/workflows/update.yml; edit the first tag to pin a version.'
  writeFileSync(file, `{\n  "$comment": ${JSON.stringify(comment)},\n  "apps": {\n${lines.join(',\n')}\n  }\n}\n`)
}
