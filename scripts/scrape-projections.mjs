#!/usr/bin/env node
/**
 * Public season-projection collector.
 *
 * FantasySharks (CSV), CBS Sports (HTML tables), and ESPN (default-league
 * feed). Each board is isolated: one failure is recorded and the rest of the
 * run continues. No login, paywall bypass, or robots evasion.
 *
 * FantasySharks publishes Crawl-delay: 60. Honouring that is several minutes
 * of spacing, which is why the scheduled path is GitHub Actions rather than
 * an Edge Function.
 *
 * Usage:
 *   node scripts/scrape-projections.mjs [options]
 *
 *   --only=<a,b>      fantasysharks, cbs, espn
 *   --season=<year>   Override the fantasy season
 *   --concurrency=<n> Max in-flight requests per host (default 2)
 *   --out=<dir>       Output directory (default data/projections)
 *   --no-mirror       Skip the public/projections copy
 *   --ignore-robots   Skip robots.txt checks
 *   --quiet           Only print the final summary
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { setHostConcurrency } from './lib/http.mjs'
import { attachEspnIds, mergeProjectionSets } from './lib/projection-consensus.mjs'
import { seasonFor } from './lib/projection-stats.mjs'
import { cbsProjectionTasks } from './lib/sources/cbs-projections.mjs'
import { espnProjectionTasks } from './lib/sources/espn-projections.mjs'
import { espnTask, buildCrosswalk } from './lib/sources/espn.mjs'
import { fantasySharksProjectionTasks } from './lib/sources/fantasysharks-projections.mjs'

const SCHEMA_VERSION = 1
const ROOT = resolve(import.meta.dirname, '..')
const GROUPS = new Set(['fantasysharks', 'cbs', 'espn'])

const HOSTS = [
  'https://www.fantasysharks.com',
  'https://www.cbssports.com',
  'https://lm-api-reads.fantasy.espn.com',
]

function parseArgs(argv) {
  const args = { only: null, season: null, concurrency: 2, out: null, ignoreRobots: false, quiet: false, mirror: true }
  for (const arg of argv) {
    if (arg === '--ignore-robots') args.ignoreRobots = true
    else if (arg === '--no-mirror') args.mirror = false
    else if (arg === '--quiet') args.quiet = true
    else if (arg.startsWith('--only=')) {
      args.only = arg.slice(7).split(',').map((s) => s.trim()).filter(Boolean)
    }
    else if (arg.startsWith('--season=')) args.season = Number(arg.slice(9))
    else if (arg.startsWith('--concurrency=')) args.concurrency = Math.max(1, Number(arg.slice(14)) || 2)
    else if (arg.startsWith('--out=')) args.out = arg.slice(6)
  }
  if (args.only) {
    const unknown = args.only.filter((id) => !GROUPS.has(id))
    if (unknown.length) throw new Error(`unknown --only group(s): ${unknown.join(', ')}`)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const DATA_DIR = resolve(ROOT, args.out ?? 'data/projections')
const wanted = (group) => !args.only || args.only.includes(group)
const season = Number.isFinite(args.season) ? args.season : seasonFor()

const log = (...parts) => {
  if (!args.quiet) console.error(...parts)
}

const options = {
  ignoreRobots: args.ignoreRobots,
  season,
  onRetry: ({ url, attempt, status, waitMs, error }) => {
    log(`  retry ${attempt} in ${waitMs}ms  ${status ?? error ?? ''}  ${url}`)
  },
}

for (const host of HOSTS) setHostConcurrency(host, args.concurrency)

async function runAll(tasks) {
  const sets = []
  const failures = []
  const skipped = []
  const settled = await Promise.allSettled(tasks.map((task) => task.run()))
  settled.forEach((result, index) => {
    const id = tasks[index].id
    if (result.status === 'rejected') {
      const error = result.reason
      failures.push({ source: id, error: error instanceof Error ? error.message : String(error) })
      return
    }
    const value = result.value
    if (!value) return
    if (value.skipped) skipped.push({ source: id, reason: value.skipped })
    if (value.rows) sets.push(value)
    else if (value.set?.rows) sets.push(value.set)
  })
  return { sets, failures, skipped }
}

const groups = []
if (wanted('fantasysharks')) {
  const tasks = fantasySharksProjectionTasks(options)
  log(`fantasysharks: ${tasks.length} position CSVs (60s crawl-delay applies)`)
  groups.push(runAll(tasks))
}
if (wanted('cbs')) {
  const tasks = cbsProjectionTasks(options)
  log(`cbs: ${tasks.length} position tables`)
  groups.push(runAll(tasks))
}
if (wanted('espn')) {
  const tasks = espnProjectionTasks(options)
  log(`espn: default-league season projections for ${season}`)
  groups.push(runAll(tasks))
}

let crosswalk = new Map()
const crosswalkJob = espnTask(options)
  .run()
  .then((result) => {
    crosswalk = buildCrosswalk(result.entries)
    log(`espn crosswalk: ${crosswalk.size} unambiguous ids`)
  })
  .catch((error) => {
    log(`espn crosswalk failed: ${error instanceof Error ? error.message : error}`)
  })

const [groupResults] = await Promise.all([Promise.all(groups), crosswalkJob])

const sets = []
const failures = []
const skipped = []
for (const group of groupResults) {
  sets.push(...group.sets)
  failures.push(...group.failures)
  skipped.push(...group.skipped)
}

const { attached } = attachEspnIds(sets, crosswalk)
const players = mergeProjectionSets(sets)
const sourceRows = sets.reduce((sum, set) => sum + set.rows.length, 0)

if (players.length === 0) {
  console.error(JSON.stringify({ error: 'no sources produced projection rows', failures, skipped }, null, 2))
  process.exit(1)
}

const payload = {
  schemaVersion: SCHEMA_VERSION,
  fetchedAt: Date.now(),
  season: String(season),
  stats: {
    sources: new Set(sets.map((set) => set.sourceId)).size,
    boards: sets.length,
    sourceRows,
    players: players.length,
    espnIdsAttached: players.filter((player) => player.espnId).length,
    crosswalkFilled: attached,
    failures: failures.length,
    skipped: skipped.length,
  },
  sources: sets.map((set) => ({
    id: set.id,
    sourceId: set.sourceId,
    label: set.label,
    sourceUrl: set.sourceUrl,
    fetchedAt: set.fetchedAt,
    rows: set.rows.length,
  })),
  players,
  failures,
  skipped,
}

await mkdir(DATA_DIR, { recursive: true })
const body = `${JSON.stringify(payload)}\n`
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
await writeFile(resolve(DATA_DIR, `${stamp}.json`), body)
await writeFile(resolve(DATA_DIR, 'latest.json'), body)

let mirror = null
if (args.mirror) {
  const mirrorDir = resolve(ROOT, 'public', 'projections')
  await mkdir(mirrorDir, { recursive: true })
  mirror = resolve(mirrorDir, 'latest.json')
  await writeFile(mirror, body)
}

console.log(JSON.stringify(
  { ...payload.stats, season, latest: resolve(DATA_DIR, 'latest.json'), mirror, failures, skipped },
  null,
  2,
))
