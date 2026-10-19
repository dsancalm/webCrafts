import { readFileSync } from 'node:fs'

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
const REPO = /^[\w.-]+\/[\w.-]+$/

// apps.json, checked, with each app knowing its group.
export function loadCatalog(file = 'apps.json') {
  return parseCatalog(JSON.parse(readFileSync(file, 'utf8')))
}

export function parseCatalog(data) {
  const seen = new Set()
  const groups = data.groups.map((g) => {
    if (!g.id || !g.name?.en) throw new Error(`group ${JSON.stringify(g.id)} needs an id and name.en`)
    return {
      ...g,
      apps: g.apps.map((app) => {
        if (!ID.test(app.id ?? '')) throw new Error(`app ${JSON.stringify(app.id)}: id must be lowercase-with-dashes`)
        if (seen.has(app.id)) throw new Error(`app ${app.id}: duplicate id`)
        seen.add(app.id)
        if (!REPO.test(app.repo ?? '')) throw new Error(`app ${app.id}: repo must be owner/name`)
        if (!app.name || !app.description?.en) throw new Error(`app ${app.id}: needs a name and description.en`)
        if (app.asset) new RegExp(app.asset) // throws on a bad pattern
        if (app.prerelease !== undefined && typeof app.prerelease !== 'boolean') throw new Error(`app ${app.id}: prerelease must be true or false`)
        if (app.skipTags && !(Array.isArray(app.skipTags) && app.skipTags.every((t) => typeof t === 'string'))) {
          throw new Error(`app ${app.id}: skipTags must be a list of tags`)
        }
        return { ...app, group: g.id }
      }),
    }
  })
  return { groups, apps: groups.flatMap((g) => g.apps) }
}
