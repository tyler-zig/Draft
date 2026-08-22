/**
 * Downloads the published player-intelligence artifact into `public/` so an
 * incremental rebuild has something to build on.
 *
 * `sync:intelligence` keeps its per-season working state in
 * `data/intelligence/normalized/`, which is gitignored and therefore absent on
 * a fresh CI runner. Rather than depend on a build cache surviving between
 * runs, this reseeds that state from the artifact that is actually live: the
 * script's own legacy path splits `latest.json` back into season slices, so a
 * seeded runner rebuilds only the season asked for instead of all fifteen.
 *
 * A missing artifact is not an error. It means this is the first ever run, and
 * the sync will build every season from scratch.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'

async function loadProjectEnv(file) {
  try {
    const contents = await readFile(resolve(file), 'utf8')
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match || process.env[match[1]] !== undefined) continue
      let value = match[2].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      } else {
        value = value.replace(/\s+#.*$/, '').trim()
      }
      process.env[match[1]] = value
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

await loadProjectEnv('.env.local')
await loadProjectEnv('.env')

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const bucket = process.env.SUPABASE_DATA_BUCKET || process.env.VITE_SUPABASE_DATA_BUCKET || 'draft-data'

if (!url || !serviceKey) {
  throw new Error('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before seeding.')
}

const target = resolve('public/intelligence/latest.json')
// The authenticated object endpoint, so this works whether or not the bucket
// is public.
const objectUrl = `${url.replace(/\/+$/, '')}/storage/v1/object/${bucket}/intelligence/latest.json`

const response = await fetch(objectUrl, {
  headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  signal: AbortSignal.timeout(180_000),
})

if (response.status === 404 || response.status === 400) {
  console.log(`No published artifact at ${bucket}/intelligence/latest.json; the sync will build every season from scratch.`)
  process.exit(0)
}
if (!response.ok) {
  throw new Error(`Could not download the published artifact: HTTP ${response.status}`)
}

const body = Buffer.from(await response.arrayBuffer())
let seasons = []
try {
  const parsed = JSON.parse(body.toString('utf8'))
  if (!Array.isArray(parsed?.players) || !parsed.players.length) {
    throw new Error('artifact carries no player records')
  }
  seasons = [...new Set(parsed.players.flatMap((player) => player.seasons?.map((entry) => entry.season) ?? []))].sort()
} catch (error) {
  throw new Error(`Published artifact is not usable as a seed: ${error instanceof Error ? error.message : String(error)}`)
}

await mkdir(dirname(target), { recursive: true })
await writeFile(target, body)
console.log(JSON.stringify({ seeded: target, bytes: body.byteLength, seasons }, null, 2))
