import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'

// Turning a release's web zip into the folder the site serves.

// Cargo's leftovers, found in builds whose site folder doubled as cargo's target folder.
const CARGO_LEFTOVERS = ['build', 'deps', 'incremental', 'examples', '.fingerprint', '.cargo-lock']
// Host configuration for Netlify/Cloudflare/Apache, which GitHub Pages ignores, and archive debris.
const HOST_FILES = new Set(['_headers', '_redirects', '.htaccess', 'nginx.conf', '.DS_Store', '__MACOSX'])

export const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })

export function unzip(zip, dir) {
  mkdirSync(dir, { recursive: true })
  execFileSync('unzip', ['-q', '-o', zip, '-d', dir], { stdio: ['ignore', 'ignore', 'inherit'] })
  // Most archives hold one folder (name-web-1.2.3/) with the site in it.
  const top = readdirSync(dir).filter((f) => !HOST_FILES.has(f))
  if (top.length === 1 && statSync(join(dir, top[0])).isDirectory()) return join(dir, top[0])
  return dir
}

// Removes what the site doesn't need. Returns the paths removed, relative to `root`.
export function clean(root) {
  const removed = []
  const rm = (p) => {
    rmSync(p, { recursive: true, force: true })
    removed.push(relative(root, p))
  }
  if (existsSync(join(root, '.fingerprint')) || existsSync(join(root, '.cargo-lock'))) {
    for (const f of CARGO_LEFTOVERS) if (existsSync(join(root, f))) rm(join(root, f))
  }
  for (const f of readdirSync(root)) if (HOST_FILES.has(f)) rm(join(root, f))
  // Precompressed twins (x.wasm.gz next to x.wasm) are only for servers that send them with
  // Content-Encoding, which Pages doesn't. A .gz with no twin is something the app fetches itself: kept.
  for (const f of walk(root)) {
    const twin = f.replace(/\.(gz|br)$/, '')
    if (twin !== f && existsSync(twin)) rm(f)
  }
  return removed
}

// Puts `snippet` as early in the page as possible: after <meta charset>, else after <head>, else after <html>.
export function injectEarly(html, snippet) {
  for (const re of [/<meta\s+charset[^>]*>/i, /<head(\s[^>]*)?>/i, /<html(\s[^>]*)?>/i]) {
    const m = html.match(re)
    if (m) return html.slice(0, m.index + m[0].length) + snippet + html.slice(m.index + m[0].length)
  }
  return snippet + html
}

// Root-absolute references ("/app.js") to files of the build only work at the root of a domain. Those that name
// one of the build's own top-level files or folders are made relative ("./app.js"), so the app works in its folder.
export function relativize(html, names) {
  return html.replace(/(["'`])\/([^"'`\/?#\s][^"'`?#\s]*)/g, (m, quote, path) => (names.has(path.split('/')[0]) ? `${quote}./${path}` : m))
}

export const hasIcon = (html) => /<link\b[^>]*\brel=["']?(shortcut )?icon\b/i.test(html)

// Apps that need cross-origin isolation (SharedArrayBuffer) get it from a service worker, as Pages can't
// send COOP/COEP headers. Their module scripts are held back (type changed) until the page is isolated,
// so the app doesn't start, and fail, on the visit that installs the worker; coi.js starts them.
export function holdModules(html) {
  return html.replace(/<script\b([^>]*)\btype=(["'])module\2/gi, '<script$1type=$2text/x-webcrafts-module$2')
}

export function patchPage(html, { iconFile, isolated, names = new Set() }) {
  let out = relativize(html, names)
  let head = ''
  if (iconFile && !hasIcon(out)) head += `\n<link rel="icon" href="${iconFile}">`
  if (isolated) {
    out = holdModules(out)
    head += '\n<script src="webcrafts-coi.js"></script>'
  }
  return head ? injectEarly(out, head) : out
}

// Unzips `zip` and installs the app into `dest` (replacing what was there). Returns the install's facts.
export function installZip(zip, dest, { app, iconPath, siteDir }) {
  const tmp = mkdtempSync(join(dirname(dest), `.tmp-${app.id}-`))
  try {
    const root = unzip(zip, join(tmp, 'x'))
    if (!existsSync(join(root, 'index.html'))) throw new Error('the zip has no index.html')
    const removed = clean(root)
    let iconFile
    if (iconPath && existsSync(iconPath)) {
      iconFile = 'webcrafts-icon.png'
      cpSync(iconPath, join(root, iconFile))
    }
    if (app.isolated) {
      cpSync(join(siteDir, 'coi.js'), join(root, 'webcrafts-coi.js'))
      cpSync(join(siteDir, 'coi-sw.js'), join(root, 'webcrafts-coi-sw.js'))
    }
    const page = join(root, 'index.html')
    const names = new Set(readdirSync(root))
    writeFileSync(page, patchPage(readFileSync(page, 'utf8'), { iconFile, isolated: app.isolated, names }))
    rmSync(dest, { recursive: true, force: true })
    renameSync(root, dest)
    const files = walk(dest)
    const sizes = files.map((f) => statSync(f).size)
    return {
      files: files.length,
      bytes: sizes.reduce((a, b) => a + b, 0),
      largest: Math.max(0, ...sizes),
      removed,
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
