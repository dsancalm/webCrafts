import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const tempDir = (name = 'webcrafts-test-') => mkdtempSync(join(tmpdir(), name))

// A zip of `files` ({ 'path/in/zip': 'contents' }), returned as its path.
export function makeZip(files) {
  const dir = tempDir()
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, 'src', path)), { recursive: true })
    writeFileSync(join(dir, 'src', path), contents)
  }
  const zip = join(dir, 'out.zip')
  execFileSync('zip', ['-q', '-r', zip, '.'], { cwd: join(dir, 'src') })
  return zip
}

// A stand-in for api.github.com: `releases` maps owner/repo to its releases, whose assets carry a `zip`
// (local path) served at the asset's API URL.
export async function fakeGitHub(releases) {
  const assets = new Map()
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/releases$/)
    if (m) {
      const list = releases[m[1]]
      if (!list) return res.writeHead(404, { 'content-type': 'application/json' }).end('{"message":"Not Found"}')
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(list.map(strip)))
    }
    const t = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/releases\/tags\/(.+)$/)
    if (t) {
      const release = releases[t[1]]?.find((r) => r.tag_name === decodeURIComponent(t[2]))
      if (!release) return res.writeHead(404, { 'content-type': 'application/json' }).end('{"message":"Not Found"}')
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(strip(release)))
    }
    const a = url.pathname.match(/^\/assets\/(\d+)$/)
    if (a && assets.has(Number(a[1])) && req.headers.accept === 'application/octet-stream') {
      return res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(readFileSync(assets.get(Number(a[1]))))
    }
    res.writeHead(404).end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  let id = 1
  const strip = (r) => ({
    ...r,
    assets: r.assets.map(({ zip, ...rest }) => rest),
  })
  for (const list of Object.values(releases)) {
    for (const r of list) {
      r.html_url ??= `https://github.com/x/y/releases/tag/${r.tag_name}`
      for (const asset of r.assets) {
        asset.id ??= id++
        asset.url = `${base}/assets/${asset.id}`
        if (asset.zip) {
          assets.set(asset.id, asset.zip)
          asset.size = statSync(asset.zip).size
        }
      }
    }
  }
  return { url: base, close: () => server.close() }
}
