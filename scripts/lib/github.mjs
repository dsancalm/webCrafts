import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// GITHUB_API_URL is set on Actions runners (and by the tests, to a local fake).
const API = (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '')
const headers = (auth) => ({
  accept: 'application/vnd.github+json',
  'user-agent': 'webcrafts-build',
  ...(auth && process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// fetch, retried on network errors and 5xx answers.
async function request(url, init = {}, { auth = true } = {}) {
  for (let attempt = 1; ; attempt++) {
    let res
    try {
      res = await fetch(url, { ...init, headers: { ...headers(auth), ...init.headers } })
    } catch (e) {
      if (attempt >= 4) throw e
    }
    if (res && (res.ok || res.status < 500 || attempt >= 4)) return res
    await sleep(attempt * 2000)
  }
}

export async function api(path) {
  const res = await request(`${API}/${path.replace(/^\//, '')}`)
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

export const listReleases = (repo) => api(`repos/${repo}/releases?per_page=50`)

// A release asset into `file`: through its API URL, else its public download link.
export async function downloadAsset(asset, file) {
  let res = await request(asset.url, { headers: { accept: 'application/octet-stream' } })
  if (!res.ok && asset.browser_download_url) {
    await res.body?.cancel()
    res = await request(asset.browser_download_url, {}, { auth: false })
  }
  if (!res.ok) throw new Error(`download ${asset.name}: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file))
}
