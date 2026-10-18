// Picking the release (and its web zip) an app is installed from.

// "<name>-web.zip", "<name>-<version>-web.zip", "<name>-web-<version>.zip"
export const DEFAULT_ASSET = '-web([-.][^/]*)?\\.zip$'

export const assetPattern = (app) => new RegExp(app.asset ?? DEFAULT_ASSET, 'i')

// The newest published release with a matching asset. Full releases win over pre-releases; a repo that
// has only pre-releases with web builds (nightly-only projects) gets its newest pre-release. Tags in the
// app's `skipTags` (releases whose web build is known to be broken) are passed over.
export function pickRelease(releases, app) {
  const pattern = assetPattern(app)
  const skip = new Set(app.skipTags ?? [])
  const candidates = releases
    .filter((r) => !r.draft && !skip.has(r.tag_name))
    .map((r) => ({ release: r, asset: r.assets.find((a) => pattern.test(a.name) && (a.state ?? 'uploaded') === 'uploaded') }))
    .filter((c) => c.asset)
    .sort((a, b) => (b.release.published_at ?? '').localeCompare(a.release.published_at ?? ''))
  return candidates.find((c) => !c.release.prerelease) ?? candidates[0] ?? null
}
