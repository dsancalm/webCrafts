import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadCatalog, parseCatalog } from '../scripts/lib/catalog.mjs'

const root = join(import.meta.dirname, '..')

test('apps.json is valid and every app has an icon and both descriptions', () => {
  const { apps } = loadCatalog(join(root, 'apps.json'))
  assert.ok(apps.length >= 20)
  for (const app of apps) {
    assert.ok(existsSync(join(root, 'icons', `${app.id}.png`)), `icons/${app.id}.png`)
    assert.ok(app.description.es, `${app.id}: description.es`)
    assert.match(app.accent ?? '#000000', /^#[0-9a-f]{6}$/i, `${app.id}: accent`)
  }
})

test('rejects duplicate ids, bad ids and bad repos', () => {
  const group = (apps) => ({ groups: [{ id: 'g', name: { en: 'G' }, apps }] })
  const app = (extra) => ({ id: 'a', name: 'A', repo: 'o/a', description: { en: 'A' }, ...extra })
  assert.throws(() => parseCatalog(group([app(), app()])), /duplicate/)
  assert.throws(() => parseCatalog(group([app({ id: 'Bad Id' })])), /lowercase/)
  assert.throws(() => parseCatalog(group([app({ repo: 'nope' })])), /owner\/name/)
  assert.throws(() => parseCatalog(group([app({ asset: '(' })])), /Invalid regular expression/)
})
