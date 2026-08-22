import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parse } from 'csv-parse/sync'

const dynastyUrl = 'https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv'
const outputFile = resolve(import.meta.dirname, '../public/players/twitter.json')
const userAgent = 'draft-assistant/player-twitter (local sync)'

function normalize(value: string | null | undefined) {
  if (!value) return null
  let handle = value.trim()
  if (!handle || /^n\/?a$/i.test(handle)) return null
  handle = handle.replace(/^https?:\/\/(?:www\.)?(?:twitter|x)\.com\//i, '')
  handle = handle.replace(/^@/, '').split(/[/?#]/)[0] ?? ''
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null
}

function cell(row: Record<string, string>, key: string) {
  const value = row[key]?.trim()
  return value && value !== 'NA' ? value : ''
}

function pfrKey(value: string) {
  return value.trim().replace(/^.*\//, '').replace(/\.htm$/i, '')
}

function setHandle(map: Record<string, string>, id: string, handle: string) {
  if (id && !map[id]) map[id] = handle
}

async function wikidataHandles() {
  const query = `SELECT ?twitter ?espn ?pfr WHERE {
    ?player wdt:P31 wd:Q5;
            wdt:P106 wd:Q19204627;
            wdt:P2002 ?twitter.
    OPTIONAL { ?player wdt:P3532 ?espn }
    OPTIONAL { ?player wdt:P3561 ?pfr }
  }`
  const response = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/sparql-results+json', 'user-agent': userAgent },
  })
  if (!response.ok) throw new Error(`Wikidata SPARQL failed (${response.status})`)
  const json = await response.json() as { results?: { bindings?: Array<Record<string, { value?: string }>> } }
  const byEspn: Record<string, string> = {}
  const byPfr: Record<string, string> = {}
  for (const row of json.results?.bindings ?? []) {
    const handle = normalize(row.twitter?.value)
    if (!handle) continue
    const espn = row.espn?.value?.trim()
    const pfr = row.pfr?.value ? pfrKey(row.pfr.value) : ''
    if (espn) setHandle(byEspn, espn, handle)
    if (pfr) setHandle(byPfr, pfr, handle)
  }
  return { byEspn, byPfr }
}

const dynastyResponse = await fetch(dynastyUrl, { headers: { 'user-agent': userAgent } })
if (!dynastyResponse.ok) throw new Error(`DynastyProcess player IDs failed (${dynastyResponse.status})`)
const rows = parse(await dynastyResponse.text(), { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[]

let wiki = { byEspn: {} as Record<string, string>, byPfr: {} as Record<string, string> }
try {
  wiki = await wikidataHandles()
} catch (error) {
  console.warn(`Wikidata supplement skipped: ${error instanceof Error ? error.message : error}`)
}

const bySleeper: Record<string, string> = {}
const byEspn: Record<string, string> = {}
const byGsis: Record<string, string> = {}
for (const row of rows) {
  const handle = normalize(row.twitter_username)
    ?? (cell(row, 'pfr_id') ? wiki.byPfr[pfrKey(cell(row, 'pfr_id'))] : undefined)
    ?? (cell(row, 'espn_id') ? wiki.byEspn[cell(row, 'espn_id')] : undefined)
    ?? null
  if (!handle) continue
  setHandle(bySleeper, cell(row, 'sleeper_id'), handle)
  setHandle(byEspn, cell(row, 'espn_id'), handle)
  setHandle(byGsis, cell(row, 'gsis_id'), handle)
}

const catalog = {
  schemaVersion: 1,
  source: 'DynastyProcess player IDs; Wikidata P2002',
  sourceUrl: dynastyUrl,
  updatedAt: new Date().toISOString(),
  count: new Set([...Object.values(bySleeper), ...Object.values(byEspn), ...Object.values(byGsis)]).size,
  bySleeper,
  byEspn,
  byGsis,
}

await mkdir(dirname(outputFile), { recursive: true })
const temporary = `${outputFile}.${process.pid}.tmp`
await writeFile(temporary, `${JSON.stringify(catalog)}\n`)
await rename(temporary, outputFile)
console.log(`Wrote ${catalog.count} X handles (${Object.keys(bySleeper).length} Sleeper, ${Object.keys(byEspn).length} ESPN) to public/players/twitter.json`)
