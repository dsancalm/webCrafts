import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { clean, hasIcon, holdModules, injectEarly, installZip, patchPage } from '../scripts/lib/install.mjs'
import { makeZip, tempDir } from './helpers.mjs'

test('injectEarly goes after <meta charset>, else <head>, else <html>', () => {
  assert.equal(injectEarly('<html><head><meta charset="utf-8"><title>x</title>', '<i>'), '<html><head><meta charset="utf-8"><i><title>x</title>')
  assert.equal(injectEarly('<html lang="en"><head lang="x"><title>x</title>', '<i>'), '<html lang="en"><head lang="x"><i><title>x</title>')
  assert.equal(injectEarly('<!doctype html><html lang="en"><title>x</title>', '<i>'), '<!doctype html><html lang="en"><i><title>x</title>')
  assert.equal(injectEarly('<title>x</title>', '<i>'), '<i><title>x</title>')
  // <header> isn't <head>
  assert.equal(injectEarly('<html><header>', '<i>'), '<html><i><header>')
})

test('hasIcon finds icon links', () => {
  assert.ok(hasIcon('<link rel="icon" href="a.png">'))
  assert.ok(hasIcon("<link href=a.png rel='shortcut icon'>"))
  assert.ok(!hasIcon('<link rel="stylesheet" href="a.css"><link rel="apple-touch-icon" href="a.png">'))
})

test('holdModules defers module scripts only', () => {
  const html = '<script type="module" src="./bootstrap.mjs"></script><script src="x.js"></script><script defer type=\'module\'>go()</script>'
  assert.equal(
    holdModules(html),
    '<script type="text/x-webcrafts-module" src="./bootstrap.mjs"></script><script src="x.js"></script><script defer type=\'text/x-webcrafts-module\'>go()</script>',
  )
})

test('patchPage adds an icon only when missing, and the isolation script for isolated apps', () => {
  const plain = '<html><head><meta charset="utf-8"></head><body><script type="module" src="a.js"></script></body></html>'
  const out = patchPage(plain, { iconFile: 'webcrafts-icon.png' })
  assert.match(out, /<meta charset="utf-8">\n<link rel="icon" href="webcrafts-icon.png">/)
  assert.match(out, /type="module"/)
  const withIcon = '<head><link rel="icon" href="own.svg"></head>'
  assert.equal(patchPage(withIcon, { iconFile: 'webcrafts-icon.png' }), withIcon)
  const iso = patchPage(plain, { isolated: true })
  assert.match(iso, /<script src="webcrafts-coi.js"><\/script>/)
  assert.match(iso, /type="text\/x-webcrafts-module" src="a.js"/)
  assert.ok(iso.indexOf('webcrafts-coi.js') < iso.indexOf('a.js'))
})

test('clean drops host files, compressed twins and cargo leftovers', () => {
  const root = tempDir()
  const files = ['index.html', '_headers', '.htaccess', 'app.wasm', 'app.wasm.gz', 'app.js.br', 'app.js', 'pack.bin.gz', 'build/x.js']
  for (const f of files) {
    mkdirSync(join(root, f, '..'), { recursive: true })
    writeFileSync(join(root, f), f)
  }
  // build/ is the app's own here: no cargo marker.
  const removed = clean(root).sort()
  assert.deepEqual(removed, ['.htaccess', '_headers', 'app.js.br', 'app.wasm.gz'])
  assert.ok(existsSync(join(root, 'pack.bin.gz')), 'a .gz without twin is kept')
  assert.ok(existsSync(join(root, 'build/x.js')))

  writeFileSync(join(root, '.cargo-lock'), '')
  mkdirSync(join(root, 'deps'))
  assert.deepEqual(clean(root).sort(), ['.cargo-lock', 'build', 'deps'])
})

test('installZip flattens the top folder, patches the page and reports sizes', () => {
  const zip = makeZip({
    'app-web-1.0/index.html': '<!doctype html><html><head><meta charset="utf-8"><title>App</title></head><body></body></html>',
    'app-web-1.0/app_bg.wasm': 'wasm',
    'app-web-1.0/_headers': '/*',
    'app-web-1.0/LICENSE-MIT': 'MIT',
  })
  const out = tempDir()
  const icon = join(out, 'icon.png')
  writeFileSync(icon, 'png')
  const site = join(import.meta.dirname, '..', 'site')
  const facts = installZip(zip, join(out, 'app'), { app: { id: 'app' }, iconPath: icon, siteDir: site })
  assert.equal(facts.files, 4) // index.html, wasm, license, icon
  assert.deepEqual(facts.removed, ['_headers'])
  assert.ok(existsSync(join(out, 'app', 'LICENSE-MIT')))
  assert.match(readFileSync(join(out, 'app', 'index.html'), 'utf8'), /webcrafts-icon\.png/)
  assert.ok(!existsSync(join(out, 'app', 'webcrafts-coi.js')))
})

test('installZip sets up isolation files for isolated apps and rejects zips without a page', () => {
  const site = join(import.meta.dirname, '..', 'site')
  const out = tempDir()
  const zip = makeZip({ 'index.html': '<html><meta charset="utf-8"><script type="module" src="./b.mjs"></script></html>', 'b.mjs': '' })
  installZip(zip, join(out, 'iso'), { app: { id: 'iso', isolated: true }, siteDir: site })
  assert.ok(existsSync(join(out, 'iso', 'webcrafts-coi.js')))
  assert.ok(existsSync(join(out, 'iso', 'webcrafts-coi-sw.js')))
  assert.throws(() => installZip(makeZip({ 'readme.txt': 'x' }), join(out, 'bad'), { app: { id: 'bad' }, siteDir: site }), /no index\.html/)
  assert.ok(!existsSync(join(out, 'bad')))
})
