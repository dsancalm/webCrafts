import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ASSET, pickRelease } from '../scripts/lib/releases.mjs'

const release = (tag, date, names, extra = {}) => ({
  tag_name: tag,
  published_at: date,
  draft: false,
  prerelease: false,
  assets: names.map((name) => ({ name, state: 'uploaded' })),
  ...extra,
})

test('the default asset pattern matches the web zips of the catalog apps', () => {
  const re = new RegExp(DEFAULT_ASSET, 'i')
  for (const name of ['photocraft-web-0.10.0.zip', 'mailcraft-0.1.1-web.zip', 'lemon-studio-web.zip', 'honeydew-web-0.1.9.zip', 'solidcraft-web-0.16.1.zip', 'solvecraft-v0.1.1-web.zip']) {
    assert.ok(re.test(name), name)
  }
  for (const name of ['photocraft-0.10.0-linux-x86_64.tar.gz', 'honeydew-sounds.zip', 'photocraft-0.10.0-windows-portable.zip', 'webview-1.0.zip', 'photocraft-web-0.10.0.zip.sha256']) {
    assert.ok(!re.test(name), name)
  }
})

test('picks the newest full release that has a web zip', () => {
  const releases = [
    release('v3', '2026-03-01T00:00:00Z', ['app-linux.tar.gz']),
    release('v2', '2026-02-01T00:00:00Z', ['app-web-2.zip']),
    release('v1', '2026-01-01T00:00:00Z', ['app-web-1.zip']),
  ]
  const pick = pickRelease(releases, {})
  assert.equal(pick.release.tag_name, 'v2')
  assert.equal(pick.asset.name, 'app-web-2.zip')
})

test('full releases win over newer pre-releases; drafts never count', () => {
  const releases = [
    release('nightly', '2026-05-01T00:00:00Z', ['app-web-n.zip'], { prerelease: true }),
    release('draft', '2026-06-01T00:00:00Z', ['app-web-d.zip'], { draft: true }),
    release('v1', '2026-01-01T00:00:00Z', ['app-web-1.zip']),
  ]
  assert.equal(pickRelease(releases, {}).release.tag_name, 'v1')
})

test('a repo with only pre-releases gets the newest one', () => {
  const releases = [
    release('web.7', '2026-04-01T00:00:00Z', ['lemon-studio-web.zip'], { prerelease: true }),
    release('web.8', '2026-05-01T00:00:00Z', ['lemon-studio-web.zip'], { prerelease: true }),
  ]
  assert.equal(pickRelease(releases, {}).release.tag_name, 'web.8')
})

test('honors a custom asset pattern and skips half-uploaded assets', () => {
  const releases = [
    release('v2', '2026-02-01T00:00:00Z', ['site.zip'], { assets: [{ name: 'site.zip', state: 'open' }] }),
    release('v1', '2026-01-01T00:00:00Z', ['site.zip', 'app-web-1.zip']),
  ]
  const pick = pickRelease(releases, { asset: '^site\\.zip$' })
  assert.equal(pick.release.tag_name, 'v1')
  assert.equal(pick.asset.name, 'site.zip')
})

test('no web zip anywhere gives null', () => {
  assert.equal(pickRelease([release('v1', '2026-01-01T00:00:00Z', ['app.msi'])], {}), null)
  assert.equal(pickRelease([], {}), null)
})
