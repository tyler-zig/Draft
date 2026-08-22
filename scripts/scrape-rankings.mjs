#!/usr/bin/env node
/**
 * Public rankings collector.
 *
 * Collects expert ranking boards from several public sources, enriches them
 * with an ESPN id crosswalk, and writes an immutable timestamped snapshot plus
 * data/rankings/latest.json.
 *
 * Sources are isolated: one failing board never costs the rest of the run, and
 * every failure is recorded in the output rather than swallowed. There is no
 * authentication, paywall bypass, or access-control evasion anywhere in here.
 *
 * Usage:
 *   node scripts/scrape-rankings.mjs [options]
 *
 *   --only=<a,b>      Collect only these source groups (rotowire, fantasypros,
 *                     fantasypros-adp, espn)
 *   --season=<year>   Override the ESPN season (defaults to the current one)
 *   --concurrency=<n> Max in-flight requests per host (default 4)
 *   --out=<dir>       Output directory (default data/rankings)
 *   --no-mirror       Skip the public/rankings copy the app reads
 *   --ignore-robots   Skip robots.txt checks entirely. The real-time ADP
 *                     board is the one source this changes meaningfully:
 *                     the page is allowed, but partners.fantasypros.com
 *                     disallows its API. Everything else is already
 *                     permitted, and for those the flag only drops the
 *                     crawl-delay and the guard that would notice a source's
 *                     terms changing.
 *   --quiet           Only print the final summary
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { setHostConcurrency } from './lib/http.mjs'
import { playerKey } from './lib/text.mjs'
import { rotowireTasks } from './lib/sources/rotowire.mjs'
import { fantasyProsTasks } from './lib/sources/fantasypros.mjs'
import { fantasyProsAdpTasks } from './lib/sources/fantasypros-adp.mjs'
import { draftWizardAdpTasks } from './lib/sources/draftwizard-adp.mjs'
import { buildAdpIndex, joinAdp } from './lib/adp-join.mjs'

const FP_ADP_FORMATS = ['ppr', 'half', 'standard']

async function readExpertArtifact(format) {
  for (const dir of [DATA_DIR, resolve(ROOT, 'public', 'rankings')]) {
    try {
      return JSON.parse(await readFile(resolve(dir, `experts-${format}.json`), 'utf8'))
    } catch {
      // Try the next location; a missing artifact is normal before the expert
      // collector has run.
    }
  }
  return null
}
import { espnTask, buildCrosswalk } from './lib/sources/espn.mjs'
import { compactRankingHistory } from './lib/ranking-history.mjs'

const SCHEMA_VERSION = 2
const ROOT = resolve(import.meta.dirname, '..')

const HOSTS = [
  'https://www.rotowire.com',
  'https://www.fantasypros.com',
  'https://api.fantasypros.com',
  'https://lm-api-reads.fantasy.espn.com',
  'https://draftwizard.fantasypros.com',
]

function parseArgs(argv) {
  const args = { only: null, season: null, concurrency: 4, out: null, ignoreRobots: false, quiet: false, mirror: true }
  for (const arg of argv) {
    if (arg === '--ignore-robots') args.ignoreRobots = true
    else if (arg === '--no-mirror') args.mirror = false
    else if (arg === '--quiet') args.quiet = true
    else if (arg.startsWith('--only=')) args.only = arg.slice(7).split(',').map((s) => s.trim()).filter(Boolean)
    else if (arg.startsWith('--season=')) args.season = Number(arg.slice(9))
    else if (arg.startsWith('--concurrency=')) args.concurrency = Math.max(1, Number(arg.slice(14)) || 4)
    else if (arg.startsWith('--out=')) args.out = arg.slice(6)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const DATA_DIR = resolve(ROOT, args.out ?? 'data/rankings')
const wanted = (group) => !args.only || args.only.includes(group)

const log = (...parts) => {
  if (!args.quiet) console.error(...parts)
}

const options = {
  ignoreRobots: args.ignoreRobots,
  season: Number.isFinite(args.season) ? args.season : undefined,
  onRetry: ({ url, attempt, status, waitMs, error }) => {
    log(`  retry ${attempt} in ${waitMs}ms  ${status ?? error ?? ''}  ${url}`)
  },
}

for (const host of HOSTS) setHostConcurrency(host, args.concurrency)

/** Runs tasks with per-task isolation so one failure cannot end the run. */
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
    // A reused FantasyPros board is both skipped (no new payload) and a set
    // that must stay on adp-latest, or that scoring format disappears.
    if (value.skipped) skipped.push({ source: id, reason: value.skipped })
    if (value.set) sets.push(value.set)
    else if (!value.skipped) sets.push(value)
  })
  return { sets, failures, skipped }
}

const failures = []
const skipped = []
const sets = []

// --- ranking boards ------------------------------------------------------
const groups = []

if (wanted('rotowire')) {
  groups.push(
    rotowireTasks(options)
      .then((tasks) => {
        log(`rotowire: ${tasks.length} boards available`)
        return runAll(tasks)
      })
      .catch((error) => ({
        sets: [],
        skipped: [],
        failures: [{ source: 'rotowire', error: error instanceof Error ? error.message : String(error) }],
      })),
  )
}

if (wanted('fantasypros')) {
  const tasks = fantasyProsTasks(options)
  log(`fantasypros: ${tasks.length} boards (crawl-delay applies)`)
  groups.push(runAll(tasks))
}

async function loadPreviousAdpSets() {
  for (const dir of [DATA_DIR, resolve(ROOT, 'public', 'rankings')]) {
    try {
      const raw = JSON.parse(await readFile(resolve(dir, 'adp-latest.json'), 'utf8'))
      if (Array.isArray(raw.sets) && raw.sets.length) return raw.sets
    } catch {
      // Missing or unreadable is a first run; pull every board.
    }
  }
  return []
}

if (wanted('fantasypros-adp')) {
  const previousSets = await loadPreviousAdpSets()
  const tasks = [...fantasyProsAdpTasks({ ...options, previousSets }), ...draftWizardAdpTasks(options)]
  log(`live adp: ${tasks.length} boards (FP RT half/ppr/std/dynasty/rookie + Draft Wizard 8/10/12/14/16 × half/ppr/std/rookie; see --ignore-robots)`)
  if (previousSets.length) log(`live adp: comparing FantasyPros published stamps against ${previousSets.length} stored sets`)
  groups.push(runAll(tasks))
}

// --- ESPN crosswalk ------------------------------------------------------
let crosswalk = new Map()
let crosswalkMeta = null

const crosswalkJob = wanted('espn')
  ? espnTask(options)
      .run()
      .then((result) => {
        crosswalk = buildCrosswalk(result.entries)
        crosswalkMeta = {
          season: result.season,
          sourceUrl: result.sourceUrl,
          fetchedAt: result.fetchedAt,
          players: result.entries.length,
          keys: crosswalk.size,
        }
        log(`espn: ${crosswalk.size} unambiguous ids from ${result.entries.length} players`)
      })
      .catch((error) => {
        failures.push({ source: 'espn-crosswalk', error: error instanceof Error ? error.message : String(error) })
      })
  : Promise.resolve()

const [groupResults] = await Promise.all([Promise.all(groups), crosswalkJob])

for (const group of groupResults) {
  sets.push(...group.sets)
  failures.push(...group.failures)
  skipped.push(...group.skipped)
}

// --- enrich + aggregate --------------------------------------------------

/**
 * FantasyPros ECR boards publish no ADP, so borrow it from the expert artifact
 * for the matching scoring format. See scripts/lib/adp-join.mjs for why this is
 * a join rather than another fetch.
 */
let adpFilled = 0
for (const set of sets) {
  const format = FP_ADP_FORMATS.find((name) => set.id === `fantasypros-${name}`)
  if (!format) continue
  const artifact = await readExpertArtifact(format)
  if (!artifact) {
    log(`fantasypros: no experts-${format} artifact; ECR rows keep an empty ADP`)
    continue
  }
  const joined = joinAdp(set.rows, buildAdpIndex(artifact))
  set.rows = joined.rows
  adpFilled += joined.filled
  log(`fantasypros: ADP joined onto ${joined.filled}/${set.rows.length} ${format} ECR rows`)
}

let enriched = 0
for (const set of sets) {
  for (const row of set.rows) {
    const espnId = crosswalk.get(playerKey(row.name, row.team, row.position))
    if (espnId) {
      row.espnId = espnId
      enriched += 1
    }
  }
}

/**
 * A flat per-player digest across every board, so a consumer can look up ADP,
 * tier and cross-source agreement without replaying the whole set list.
 */
function aggregate(allSets) {
  const players = new Map()
  for (const set of allSets) {
    for (const row of set.rows) {
      const key = playerKey(row.name, row.team, row.position)
      let entry = players.get(key)
      if (!entry) {
        entry = {
          name: row.name,
          team: row.team,
          position: row.position,
          espnId: row.espnId,
          ranks: [],
          adp: null,
          tier: null,
          byeWeek: null,
          sources: [],
        }
        players.set(key, entry)
      }
      entry.espnId ??= row.espnId
      if (typeof row.overall === 'number') entry.ranks.push(row.overall)
      // Zero is a blank cell, not a first-overall pick; it must not win the min.
      if (row.adp != null && row.adp > 0) entry.adp = entry.adp == null ? row.adp : Math.min(entry.adp, row.adp)
      if (row.tier != null) entry.tier ??= row.tier
      if (row.byeWeek != null) entry.byeWeek ??= row.byeWeek
      if (!entry.sources.includes(set.id)) entry.sources.push(set.id)
    }
  }

  return [...players.values()]
    .map((entry) => {
      const sorted = [...entry.ranks].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      const median = sorted.length === 0
        ? null
        : sorted.length % 2 === 1
          ? sorted[mid]
          : (sorted[mid - 1] + sorted[mid]) / 2
      // `ranks` is the raw sample; the digest exposes its summary instead.
      const { ranks: _ranks, ...rest } = entry
      return {
        ...rest,
        best: sorted[0] ?? null,
        worst: sorted.at(-1) ?? null,
        median,
        sampleCount: sorted.length,
      }
    })
    .sort((a, b) => (a.median ?? Infinity) - (b.median ?? Infinity))
}

const players = aggregate(sets)
const totalRows = sets.reduce((sum, set) => sum + set.rows.length, 0)

// --- write ---------------------------------------------------------------
if (sets.length === 0) {
  console.error(JSON.stringify({ error: 'no sources produced rows', failures, skipped }, null, 2))
  process.exit(1)
}

await mkdir(DATA_DIR, { recursive: true })

const payload = {
  schemaVersion: SCHEMA_VERSION,
  fetchedAt: Date.now(),
  stats: {
    sets: sets.length,
    rows: totalRows,
    players: players.length,
    espnIdsAttached: enriched,
    adpJoined: adpFilled,
    failures: failures.length,
    skipped: skipped.length,
  },
  crosswalk: crosswalkMeta,
  sets,
  players,
  failures,
  skipped,
}

const body = `${JSON.stringify(payload, null, 2)}\n`
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
await writeFile(resolve(DATA_DIR, `${stamp}.json`), body)
await writeFile(resolve(DATA_DIR, 'latest.json'), body)

// Live ADP gets its own artifact so the hosted 15-minute job and the broad
// snapshot can move independently; upload:supabase carries it into the
// live_adp fields.
const adpSets = sets.filter((set) => String(set.id).startsWith('fantasypros-rtadp') || String(set.id).startsWith('draftwizard-adp-'))
let adpBody = null
if (adpSets.length) {
  const digestSets = adpSets.filter((set) => set.id === 'fantasypros-rtadp' || set.id === 'draftwizard-adp-12')
  const adpPlayers = aggregate(digestSets.length ? digestSets : adpSets)
  adpBody = `${JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    fetchedAt: payload.fetchedAt,
    stats: {
      sets: adpSets.length,
      rows: adpSets.reduce((sum, set) => sum + set.rows.length, 0),
      players: adpPlayers.length,
      espnIdsAttached: adpSets.reduce((sum, set) => sum + set.rows.filter((row) => row.espnId).length, 0),
      failures: 0,
      skipped: skipped.filter((item) => String(item.source).startsWith('fantasypros-rtadp')).length,
    },
    sets: adpSets,
    players: adpPlayers,
    failures: [],
    skipped: [],
  }, null, 2)}\n`
  await writeFile(resolve(DATA_DIR, 'adp-latest.json'), adpBody)
}

// The snapshot directory is history and is gitignored; the app reads a single
// current copy from public/ so Vite serves it as a static asset.
let mirror = null
if (args.mirror) {
  const mirrorDir = resolve(ROOT, 'public', 'rankings')
  await mkdir(mirrorDir, { recursive: true })
  mirror = resolve(mirrorDir, 'latest.json')
  await writeFile(mirror, body)
  if (adpBody) await writeFile(resolve(mirrorDir, 'adp-latest.json'), adpBody)
  await compactRankingHistory({ inputDir: DATA_DIR, outputFile: resolve(mirrorDir, 'history.json') })
}

console.log(JSON.stringify(
  { ...payload.stats, latest: resolve(DATA_DIR, 'latest.json'), mirror, failures, skipped },
  null,
  2,
))
