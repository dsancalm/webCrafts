import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fakeGitHub, makeZip, tempDir } from './helpers.mjs'

const root = join(import.meta.dirname, '..')
const run = promisify(execFile)

// The whole build against a fake GitHub: one app installed, one isolated, one without a web release, one
// hosted upstream, one whose repo is gone.
test('build.mjs installs releases and renders the dashboard', async () => {
  const page = (title) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><script type="module" src="./main.js"></script></body></html>`
  const gh = await fakeGitHub({
    'o/photo': [
      { tag_name: 'v2.0.0', published_at: '2026-10-02T00:00:00Z', prerelease: false, assets: [{ name: 'photo-web-2.0.0.zip', state: 'uploaded', zip: makeZip({ 'photo-web-2.0.0/index.html': page('Photo'), 'photo-web-2.0.0/main.js': '', 'photo-web-2.0.0/main_bg.wasm': 'w', 'photo-web-2.0.0/main_bg.wasm.gz': 'g' }) }] },
      { tag_name: 'v1.0.0', published_at: '2026-09-01T00:00:00Z', prerelease: false, assets: [{ name: 'photo-web-1.0.0.zip', state: 'uploaded', zip: makeZip({ 'index.html': page('Old') }) }] },
    ],
    'o/lemon': [
      { tag_name: 'v0.0.1-web.8', published_at: '2026-10-03T00:00:00Z', prerelease: true, assets: [{ name: 'lemon-studio-web.zip', state: 'uploaded', zip: makeZip({ 'index.html': page('Lemon'), 'main.js': '' }) }] },
    ],
    'o/notes': [{ tag_name: 'v1', published_at: '2026-10-03T00:00:00Z', prerelease: false, assets: [{ name: 'notes-linux.tar.gz', state: 'uploaded' }] }],
    'o/sub': [],
  })
  const dir = tempDir()
  const catalog = join(dir, 'apps.json')
  const app = (id, repo, extra = {}) => ({ id, name: id, repo, description: { en: id, es: id }, ...extra })
  writeFileSync(
    catalog,
    JSON.stringify({
      groups: [
        {
          id: 'g',
          name: { en: 'G', es: 'G' },
          apps: [
            app('photocraft', 'o/photo'),
            app('lemon-studio', 'o/lemon', { isolated: true }),
            app('notecraft', 'o/notes'),
            app('subcraft', 'o/sub', { external: 'https://o.github.io/sub/' }),
            app('figcraft', 'o/gone'),
          ],
        },
      ],
    }),
  )
  const out = join(dir, 'dist')
  const cache = join(dir, 'cache')
  try {
    const env = { ...process.env, GITHUB_API_URL: gh.url, GITHUB_TOKEN: '', GITHUB_STEP_SUMMARY: '', GITHUB_REPOSITORY: 'me/webCrafts' }
    const args = ['scripts/build.mjs', '--catalog', catalog, '--out', out, '--cache', cache]
    const { stdout } = await run(process.execPath, args, { cwd: root, env })
    assert.match(stdout, /photocraft: installed v2\.0\.0/)

    const versions = JSON.parse(readFileSync(join(out, 'versions.json'), 'utf8')).apps
    assert.equal(versions.photocraft.status, 'ok')
    assert.equal(versions.photocraft.tag, 'v2.0.0')
    assert.equal(versions['lemon-studio'].tag, 'v0.0.1-web.8')
    assert.equal(versions.notecraft.status, 'missing')
    assert.equal(versions.subcraft.status, 'external')
    assert.equal(versions.figcraft.status, 'failed')
    assert.match(versions.figcraft.error, /404/)

    assert.ok(existsSync(join(out, 'photocraft', 'main_bg.wasm')))
    assert.ok(!existsSync(join(out, 'photocraft', 'main_bg.wasm.gz')))
    assert.ok(existsSync(join(out, 'icons', 'photocraft.png')))
    assert.ok(existsSync(join(out, 'assets', 'style.css')))
    assert.ok(existsSync(join(out, '404.html')))
    assert.match(readFileSync(join(out, 'lemon-studio', 'index.html'), 'utf8'), /webcrafts-coi\.js/)
    const index = readFileSync(join(out, 'index.html'), 'utf8')
    assert.match(index, /href="photocraft\/"/)
    assert.match(index, /href="https:\/\/github.com\/me\/webCrafts"/)

    // A second build reuses the downloaded zips.
    const again = await run(process.execPath, args, { cwd: root, env })
    assert.match(again.stdout, /photocraft: photo-web-2\.0\.0\.zip \(cached\)/)

    // --strict turns the failed app into an error.
    await assert.rejects(run(process.execPath, [...args, '--strict'], { cwd: root, env }))
  } finally {
    gh.close()
  }
})
