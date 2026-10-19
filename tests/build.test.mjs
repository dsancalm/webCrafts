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
            app('lemon-studio', 'o/lemon', { isolated: true, prerelease: true }),
            app('gridcraft', 'o/notes'),
            app('soundcraft', 'o/sub', { external: 'https://o.github.io/sub/' }),
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
    const args = ['scripts/build.mjs', '--catalog', catalog, '--out', out, '--cache', cache, '--lock', join(dir, 'none.json')]
    const { stdout } = await run(process.execPath, args, { cwd: root, env })
    assert.match(stdout, /photocraft: installed v2\.0\.0/)

    const versions = JSON.parse(readFileSync(join(out, 'versions.json'), 'utf8')).apps
    assert.equal(versions.photocraft.status, 'ok')
    assert.equal(versions.photocraft.tag, 'v2.0.0')
    assert.equal(versions['lemon-studio'].tag, 'v0.0.1-web.8')
    assert.equal(versions.gridcraft.status, 'missing')
    assert.equal(versions.soundcraft.status, 'external')
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

// Over the size budget, the biggest app with a hosted copy is linked to it; without one, it's left out.
test('build.mjs keeps the site within its size budget', async () => {
  const page = '<!doctype html><html><head><meta charset="utf-8"><title>x</title></head><body></body></html>'
  const big = (n) => Buffer.alloc(n * 1024 * 1024, 1)
  const release = (name, files) => [{ tag_name: 'v1', published_at: '2026-10-01T00:00:00Z', prerelease: false, assets: [{ name, state: 'uploaded', zip: makeZip(files) }] }]
  const gh = await fakeGitHub({
    'o/huge': release('huge-web-1.zip', { 'index.html': page, 'data.bin': big(3) }),
    'o/large': release('large-web-1.zip', { 'index.html': page, 'data.bin': big(2) }),
    'o/small': release('small-web-1.zip', { 'index.html': page }),
  })
  const dir = tempDir()
  const catalog = join(dir, 'apps.json')
  const app = (id, repo, extra = {}) => ({ id, name: id, repo, description: { en: id, es: id }, ...extra })
  writeFileSync(
    catalog,
    JSON.stringify({
      groups: [{ id: 'g', name: { en: 'G' }, apps: [app('photocraft', 'o/huge', { external: 'https://example.com/huge/' }), app('wordcraft', 'o/large'), app('gridcraft', 'o/small')] }],
    }),
  )
  const out = join(dir, 'dist')
  try {
    const env = { ...process.env, GITHUB_API_URL: gh.url, GITHUB_TOKEN: '', GITHUB_STEP_SUMMARY: '', GITHUB_ACTIONS: '' }
    // The dashboard and icons are about 0.5 MB: 1.5 MB leaves room for the small app only.
    const { stdout } = await run(process.execPath, ['scripts/build.mjs', '--catalog', catalog, '--out', out, '--cache', join(dir, 'c'), '--lock', join(dir, 'none.json'), '--budget-mb', '1.5'], { cwd: root, env })
    assert.match(stdout, /Warning: photocraft v1 \(3\.0 MB\) doesn't fit .*linking to https:\/\/example\.com\/huge\//)
    const versions = JSON.parse(readFileSync(join(out, 'versions.json'), 'utf8')).apps
    assert.equal(versions.photocraft.status, 'external')
    assert.equal(versions.photocraft.reason, 'size')
    assert.equal(versions.wordcraft.status, 'too-big')
    assert.equal(versions.gridcraft.status, 'ok')
    assert.ok(!existsSync(join(out, 'photocraft')))
    assert.ok(!existsSync(join(out, 'wordcraft')))
    const index = readFileSync(join(out, 'index.html'), 'utf8')
    assert.match(index, /href="https:\/\/example\.com\/huge\/"/)
    assert.match(index, /Too big for GitHub Pages: opens a hosted copy/)
    assert.match(index, /<span class="l-en">Too big for GitHub Pages<\/span>/)
  } finally {
    gh.close()
  }
})

// versions.lock.json decides the version: the pinned one, even with a newer release out; an app missing from it,
// or whose pinned release is gone, gets its newest stable release.
test('build.mjs installs the versions in versions.lock.json', async () => {
  const page = (title) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body></body></html>`
  const release = (tag, date) => ({ tag_name: tag, published_at: date, prerelease: false, assets: [{ name: `app-web-${tag}.zip`, state: 'uploaded', zip: makeZip({ 'index.html': page(tag) }) }] })
  const gh = await fakeGitHub({
    'o/pinned': [release('v2', '2026-10-02T00:00:00Z'), release('v1', '2026-09-01T00:00:00Z')],
    'o/new': [release('v5', '2026-10-02T00:00:00Z')],
    'o/gone': [release('v9', '2026-10-02T00:00:00Z')],
  })
  const dir = tempDir()
  const catalog = join(dir, 'apps.json')
  const app = (id, repo) => ({ id, name: id, repo, description: { en: id } })
  writeFileSync(catalog, JSON.stringify({ groups: [{ id: 'g', name: { en: 'G' }, apps: [app('photocraft', 'o/pinned'), app('wordcraft', 'o/new'), app('gridcraft', 'o/gone')] }] }))
  const lock = join(dir, 'versions.lock.json')
  writeFileSync(lock, JSON.stringify({ apps: { photocraft: ['v1'], gridcraft: ['v8', 'v7'] } }))
  const out = join(dir, 'dist')
  try {
    const env = { ...process.env, GITHUB_API_URL: gh.url, GITHUB_TOKEN: '', GITHUB_STEP_SUMMARY: '', GITHUB_ACTIONS: '' }
    const { stdout } = await run(process.execPath, ['scripts/build.mjs', '--catalog', catalog, '--out', out, '--cache', join(dir, 'c'), '--lock', lock], { cwd: root, env })
    assert.match(stdout, /gridcraft: v8 from .* no longer exists; using its newest release instead/)
    const versions = JSON.parse(readFileSync(join(out, 'versions.json'), 'utf8')).apps
    assert.equal(versions.photocraft.tag, 'v1')
    assert.equal(versions.wordcraft.tag, 'v5')
    assert.equal(versions.gridcraft.tag, 'v9')
    assert.match(readFileSync(join(out, 'photocraft', 'index.html'), 'utf8'), /<title>v1<\/title>/)
  } finally {
    gh.close()
  }
})
