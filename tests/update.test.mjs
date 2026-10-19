import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { KEEP, promote, readLock, writeLock } from '../scripts/lib/lock.mjs'
import { fakeGitHub, tempDir } from './helpers.mjs'

const root = join(import.meta.dirname, '..')
const run = promisify(execFile)

test('promote puts the new tag first, keeps 3 and never repeats one', () => {
  const lock = { apps: { a: ['v3', 'v2', 'v1'] } }
  promote(lock, 'a', 'v4')
  assert.deepEqual(lock.apps.a, ['v4', 'v3', 'v2'])
  assert.equal(lock.apps.a.length, KEEP)
  promote(lock, 'a', 'v2')
  assert.deepEqual(lock.apps.a, ['v2', 'v4', 'v3'])
  promote(lock, 'b', 'v1')
  assert.deepEqual(lock.apps.b, ['v1'])
})

test('writeLock writes one app per line in catalog order, and readLock reads it back', () => {
  const file = join(tempDir(), 'versions.lock.json')
  assert.deepEqual(readLock(file), { apps: {} })
  writeLock(file, { apps: { b: ['v2', 'v1'], a: ['v1'] } }, ['a', 'b'])
  const text = readFileSync(file, 'utf8')
  assert.match(text, /\n {4}"a": \["v1"\],\n {4}"b": \["v2","v1"\]\n/)
  assert.deepEqual(readLock(file).apps, { a: ['v1'], b: ['v2', 'v1'] })
})

test('update.mjs moves apps to their newest stable release, and only reports a change when there is one', async () => {
  const release = (tag, date, prerelease = false) => ({ tag_name: tag, published_at: date, prerelease, assets: [{ name: `x-web-${tag}.zip`, state: 'uploaded' }] })
  const gh = await fakeGitHub({
    'o/photo': [release('v4', '2026-10-03T00:00:00Z', true), release('v3', '2026-10-02T00:00:00Z'), release('v2', '2026-09-01T00:00:00Z')],
    'o/word': [release('v1', '2026-09-01T00:00:00Z')],
    'o/lemon': [release('web.9', '2026-10-03T00:00:00Z', true), release('web.8', '2026-09-03T00:00:00Z', true)],
    'o/grid': [release('nightly', '2026-10-03T00:00:00Z', true)],
  })
  const dir = tempDir()
  const catalog = join(dir, 'apps.json')
  const app = (id, name, repo, extra = {}) => ({ id, name, repo, description: { en: id }, ...extra })
  writeFileSync(
    catalog,
    JSON.stringify({
      groups: [
        {
          id: 'g',
          name: { en: 'G' },
          apps: [
            app('photocraft', 'PhotoCraft', 'o/photo'),
            app('wordcraft', 'WordCraft', 'o/word'),
            app('lemon-studio', 'Lemon Studio', 'o/lemon', { prerelease: true }),
            app('gridcraft', 'GridCraft', 'o/grid'),
          ],
        },
      ],
    }),
  )
  const lock = join(dir, 'versions.lock.json')
  writeFileSync(lock, JSON.stringify({ apps: { photocraft: ['v2', 'v1', 'v0'], wordcraft: ['v1'], 'lemon-studio': ['web.8'], gridcraft: ['v1'], removed: ['v1'] } }))
  const output = join(dir, 'output')
  const message = join(dir, 'message.txt')
  const env = { ...process.env, GITHUB_API_URL: gh.url, GITHUB_TOKEN: '', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '' }
  const args = ['scripts/update.mjs', '--catalog', catalog, '--lock', lock, '--message-file', message]
  try {
    writeFileSync(output, '')
    await run(process.execPath, args, { cwd: root, env })
    assert.deepEqual(readLock(lock).apps, {
      photocraft: ['v3', 'v2', 'v1'], // the stable one, not the newer pre-release; 3 kept
      wordcraft: ['v1'], // up to date
      'lemon-studio': ['web.9', 'web.8'], // follows pre-releases
      gridcraft: ['v1'], // no stable release: untouched
    })
    assert.equal(readFileSync(output, 'utf8'), 'changed=true\ncommit=true\n')
    assert.equal(readFileSync(message, 'utf8'), 'Update PhotoCraft v2 → v3, Lemon Studio web.8 → web.9\n')

    // Nothing new: no change, no commit, the file untouched.
    const before = readFileSync(lock, 'utf8')
    writeFileSync(output, '')
    const { stdout } = await run(process.execPath, args, { cwd: root, env })
    assert.match(stdout, /No app has a new release: nothing to deploy\./)
    assert.equal(readFileSync(output, 'utf8'), 'changed=false\ncommit=false\n')
    assert.equal(readFileSync(lock, 'utf8'), before)
  } finally {
    gh.close()
  }
})
