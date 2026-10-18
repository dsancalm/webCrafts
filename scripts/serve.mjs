#!/usr/bin/env node
// Serves dist/ the way GitHub Pages serves a project site: under /<repo>/, folders redirect to their
// trailing slash and answer with their index.html, unknown paths get 404.html.
//
//   node scripts/serve.mjs [--dir dist] [--base /webCrafts/] [--port 8080]
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.gz': 'application/gzip',
  '.zip': 'application/zip',
}

export const defaultBase = () => `/${(process.env.GITHUB_REPOSITORY ?? '/webCrafts').split('/')[1]}/`

export function serve({ dir = 'dist', base = defaultBase(), port = 8080, host = '127.0.0.1' } = {}) {
  const prefix = base.endsWith('/') ? base : `${base}/`
  const send = (res, status, file) => {
    res.writeHead(status, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': statSync(file).size })
    createReadStream(file).pipe(res)
  }
  const notFound = (res) => {
    const page = join(dir, '404.html')
    if (existsSync(page)) return send(res, 404, page)
    res.writeHead(404).end('not found')
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    let path = decodeURIComponent(url.pathname)
    if (path === prefix.slice(0, -1)) return res.writeHead(301, { location: prefix + url.search }).end()
    if (!path.startsWith(prefix)) return notFound(res)
    const rel = normalize(path.slice(prefix.length))
    if (rel.startsWith('..') || rel.split(sep).some((p) => p.startsWith('..'))) return notFound(res)
    let file = join(dir, rel)
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!path.endsWith('/')) return res.writeHead(301, { location: `${path}/${url.search}` }).end()
      file = join(file, 'index.html')
    }
    if (!existsSync(file) || !statSync(file).isFile()) return notFound(res)
    send(res, 200, file)
  })
  return new Promise((resolve) => server.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}${prefix}` })))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { dir: { type: 'string', default: 'dist' }, base: { type: 'string' }, port: { type: 'string', default: '8080' } } })
  const { url } = await serve({ dir: values.dir, base: values.base ?? defaultBase(), port: Number(values.port) })
  console.log(`Serving ${values.dir} at ${url}`)
}
