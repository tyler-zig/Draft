import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

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

// Plain Node scripts do not inherit Vite's dotenv loading. Shell variables
// still win; .env.local is preferred over the optional base .env file.
await loadProjectEnv('.env.local')
await loadProjectEnv('.env')

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const bucket = process.env.SUPABASE_DATA_BUCKET || process.env.VITE_SUPABASE_DATA_BUCKET || 'draft-data'

/**
 * Chained after a collection, this must not fail a machine that has no
 * Supabase credentials -- a local-only checkout still collects perfectly well
 * and reads its artifacts from public/. Run directly, missing credentials are
 * still an error, because then uploading is the whole point of the command.
 */
const optional = process.argv.includes('--if-configured')
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',').map((id) => id.trim()).filter(Boolean) ?? []

if (!url || !serviceKey) {
  const message = 'Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in the shell or .env.local before uploading artifacts.'
  if (!optional) throw new Error(message)
  console.log('Supabase is not configured; collected files stay local and the app will read them from public/.')
  process.exit(0)
}

const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const artifacts = [
  ['rankings-latest', 'public/rankings/latest.json', 'rankings/latest.json'],
  ['rankings-history', 'public/rankings/history.json', 'rankings/history.json'],
  ['experts-ppr', 'public/rankings/experts-ppr.json', 'rankings/experts-ppr.json'],
  ['experts-half', 'public/rankings/experts-half.json', 'rankings/experts-half.json'],
  ['experts-standard', 'public/rankings/experts-standard.json', 'rankings/experts-standard.json'],
  ['adp-latest', 'public/rankings/adp-latest.json', 'rankings/adp-latest.json'],
  ['player-intelligence', 'public/intelligence/latest.json', 'intelligence/latest.json'],
  [null, 'public/intelligence/schedule.json', 'intelligence/schedule.json'],
  ['player-twitter', 'public/players/twitter.json', 'players/twitter.json'],
  ['projections-latest', 'public/projections/latest.json', 'projections/latest.json'],
]

function wanted(kind, objectPath) {
  if (!only.length) return true
  return only.includes(kind) || only.includes(objectPath)
}

function adpHasTrendWindows(payload) {
  const sets = Array.isArray(payload?.sets) ? payload.sets : []
  return sets.some((set) => String(set?.id ?? '').startsWith('fantasypros-rtadp')
    && Array.isArray(set.rows)
    && set.rows.some((row) => row?.adpLastOne != null || row?.adpVsLastOne != null))
}

let uploaded = 0
for (const [kind, source, objectPath] of artifacts) {
  if (!wanted(kind, objectPath)) continue
  const file = resolve(source)
  let body
  let info
  try {
    ;[body, info] = await Promise.all([readFile(file), stat(file)])
  } catch (error) {
    if (error?.code === 'ENOENT') { console.warn(`Skipping missing ${source}`); continue }
    throw error
  }
  const payload = JSON.parse(body.toString('utf8'))
  if (kind === 'adp-latest' && !adpHasTrendWindows(payload)) {
    console.warn(`Skipping ${source}: FantasyPros rows have no Last 1 / Last 7 windows`)
    continue
  }
  const generated = payload.generatedAt ?? payload.fetchedAt ?? info.mtimeMs
  const generatedAt = typeof generated === 'number' ? new Date(generated).toISOString() : new Date(generated).toISOString()
  const schemaVersion = Number(payload.schemaVersion ?? 1)
  const { error: uploadError } = await client.storage.from(bucket).upload(objectPath, body, {
    contentType: 'application/json', cacheControl: '300', upsert: true,
  })
  if (uploadError) throw new Error(`Upload ${objectPath}: ${uploadError.message}`)
  if (kind) {
    const { error: metadataError } = await client.from('data_artifacts').upsert({
      kind, bucket, object_path: objectPath, schema_version: schemaVersion,
      generated_at: generatedAt, byte_size: info.size,
      metadata: { source },
      ...(kind === 'adp-latest' ? { live_adp: payload } : {}),
    })
    if (metadataError) throw new Error(`Metadata ${kind}: ${metadataError.message}`)
  }
  if (kind && (objectPath.startsWith('rankings/') || kind === 'projections-latest')) {
    const { error: snapshotError } = await client.from('ranking_snapshots').upsert({
      kind,
      schema_version: schemaVersion,
      fetched_at: generatedAt,
      payload,
      source: 'manual',
      ...(kind === 'adp-latest' ? { live_adp: payload } : {}),
    })
    if (snapshotError) throw new Error(`Database snapshot ${kind}: ${snapshotError.message}`)
  }
  uploaded += 1
  console.log(`Uploaded ${source} -> ${bucket}/${objectPath}`)
}

/**
 * The sharded player-intelligence read path: an identity index plus one bucket
 * per group of players. These are many small objects rather than one 17 MB
 * one, so they upload with a little concurrency and are reported as a single
 * line instead of 129.
 */
async function uploadPlayerShards() {
  const dir = resolve('public/intelligence/players')
  let names
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      console.warn('Skipping missing public/intelligence/players (run sync:intelligence to build the sharded read path)')
      return 0
    }
    throw error
  }
  if (!names.length) return 0

  let next = 0
  let bytes = 0
  const worker = async () => {
    for (let i = next++; i < names.length; i = next++) {
      const body = await readFile(resolve(dir, names[i]))
      bytes += body.byteLength
      const { error } = await client.storage.from(bucket).upload(`intelligence/players/${names[i]}`, body, {
        contentType: 'application/json', cacheControl: '300', upsert: true,
      })
      if (error) throw new Error(`Upload intelligence/players/${names[i]}: ${error.message}`)
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  console.log(`Uploaded ${names.length} player-intelligence shards (${(bytes / 1e6).toFixed(1)} MB) -> ${bucket}/intelligence/players/`)
  return names.length
}

if (!only.length || only.includes('player-intelligence') || only.includes('intelligence/players')) {
  uploaded += await uploadPlayerShards()
}

if (!uploaded) throw new Error('No generated artifacts were found. Run the ranking/intelligence sync scripts first.')
console.log(`Uploaded ${uploaded} artifact${uploaded === 1 ? '' : 's'}.`)
