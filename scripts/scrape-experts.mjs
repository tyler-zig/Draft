#!/usr/bin/env node
/**
 * Collects every FantasyPros expert's own draft board, per scoring format.
 *
 * 87 experts x 3 formats is 261 pages against a source that asks for a
 * five-second crawl delay, so a cold sweep takes roughly 22 minutes. Runs are
 * therefore incremental: any board already collected inside --max-age is
 * carried over from the previous snapshot, which makes a refresh cheap and
 * makes an interrupted run resumable by simply running it again.
 *
 * Output is one file per scoring format so the app loads only the one matching
 * the league it is connected to. Rows are stored as [playerKey, rank] pairs
 * against a shared player dictionary -- the same board written naively is
 * roughly ten times larger.
 *
 * Usage:
 *   node scripts/scrape-experts.mjs [options]
 *
 *   --scoring=<a,b>   ppr, half, standard (default: all three)
 *   --max-age=<hours> Reuse boards collected within this window (default 24)
 *   --force           Refetch everything, ignoring --max-age
 *   --limit=<n>       Only the first n experts (for a quick check)
 *   --out=<dir>       Output directory (default data/rankings)
 *   --no-mirror       Skip the public/rankings copy the app reads
 *   --ignore-robots   Skip robots.txt checks (also drops the crawl delay)
 *   --quiet           Only print the final summary
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { fetchExpertDirectory, collectExpert, SCORING } from './lib/sources/fantasypros-experts.mjs'

const SCHEMA_VERSION = 1
const ROOT = resolve(import.meta.dirname, '..')

function parseArgs(argv) {
  const args = {
    scoring: Object.keys(SCORING),
    maxAgeMs: 24 * 60 * 60 * 1000,
    force: false,
    limit: null,
    out: null,
    mirror: true,
    ignoreRobots: false,
    quiet: false,
  }
  for (const arg of argv) {
    if (arg === '--force') args.force = true
    else if (arg === '--no-mirror') args.mirror = false
    else if (arg === '--ignore-robots') args.ignoreRobots = true
    else if (arg === '--quiet') args.quiet = true
    else if (arg.startsWith('--scoring=')) {
      args.scoring = arg.slice(10).split(',').map((s) => s.trim()).filter((s) => SCORING[s])
    } else if (arg.startsWith('--max-age=')) {
      const hours = Number(arg.slice(10))
      if (Number.isFinite(hours)) args.maxAgeMs = hours * 60 * 60 * 1000
    } else if (arg.startsWith('--limit=')) args.limit = Math.max(1, Number(arg.slice(8)) || 1)
    else if (arg.startsWith('--out=')) args.out = arg.slice(6)
  }
  if (args.scoring.length === 0) args.scoring = Object.keys(SCORING)
  return args
}

const args = parseArgs(process.argv.slice(2))
const DATA_DIR = resolve(ROOT, args.out ?? 'data/rankings')
const MIRROR_DIR = resolve(ROOT, 'public', 'rankings')

const log = (...parts) => {
  if (!args.quiet) console.error(...parts)
}

const options = {
  ignoreRobots: args.ignoreRobots,
  onRetry: ({ url, attempt, status, waitMs, error }) => {
    log(`  retry ${attempt} in ${waitMs}ms  ${status ?? error ?? ''}  ${url}`)
  },
}

const fileFor = (dir, scoring) => resolve(dir, `experts-${scoring}.json`)

async function readPrevious(scoring) {
  try {
    const raw = await readFile(fileFor(DATA_DIR, scoring), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed?.schemaVersion !== SCHEMA_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Team defenses have no player link, so they key on team instead of an id --
 * matching how playerKey treats them elsewhere.
 */
function keyFor(row) {
  if (row.fantasyProsId) return row.fantasyProsId
  const team = row.team ?? row.name.toUpperCase().slice(0, 3)
  return `T:${team}:${row.position ?? ''}`
}

async function collectScoring(scoring, directory) {
  const previous = await readPrevious(scoring)
  const priorExperts = new Map((previous?.experts ?? []).map((e) => [e.slug, e]))
  const players = { ...(previous?.players ?? {}) }

  const experts = []
  const failures = []
  const notPublished = []
  let fetched = 0
  let reused = 0

  const targets = args.limit ? directory.slice(0, args.limit) : directory

  for (const [index, entry] of targets.entries()) {
    const prior = priorExperts.get(entry.slug)
    const fresh = prior && !args.force && Date.now() - prior.fetchedAt < args.maxAgeMs
    if (fresh) {
      experts.push(prior)
      reused += 1
      continue
    }

    try {
      const board = await collectExpert(entry.slug, scoring, options)
      if (board.notPublished) {
        notPublished.push(entry.slug)
        log(`  [${scoring}] ${index + 1}/${targets.length} ${entry.slug} — no board for this format`)
        continue
      }
      const ranks = []
      for (const row of board.rows) {
        const key = keyFor(row)
        // The dictionary is shared across every expert in this file. Later
        // boards refresh a value, but a board that leaves ECR or ADP blank must
        // not erase what an earlier one reported -- plain last-write-wins let a
        // single expert with an empty ADP column blank the field league-wide.
        const previous = players[key]
        players[key] = {
          n: row.name,
          t: row.team,
          p: row.position,
          b: row.byeWeek ?? previous?.b ?? null,
          ecr: row.ecr ?? previous?.ecr ?? null,
          adp: row.adp ?? previous?.adp ?? null,
        }
        ranks.push([key, row.overall])
      }
      experts.push({
        slug: board.slug,
        name: board.name,
        outlet: board.outlet,
        fetchedAt: board.fetchedAt,
        count: ranks.length,
        ranks,
      })
      fetched += 1
      log(`  [${scoring}] ${index + 1}/${targets.length} ${board.name} — ${ranks.length} rows`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ expert: entry.slug, error: message })
      // A board that fails keeps its previous copy rather than vanishing.
      if (prior) experts.push(prior)
      log(`  [${scoring}] ${index + 1}/${targets.length} ${entry.slug} FAILED: ${message}`)
    }
  }

  // Drop dictionary entries no surviving board references any more.
  const referenced = new Set(experts.flatMap((e) => e.ranks.map(([key]) => key)))
  for (const key of Object.keys(players)) {
    if (!referenced.has(key)) delete players[key]
  }

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    scoring,
    fetchedAt: Date.now(),
    expertCount: experts.length,
    playerCount: Object.keys(players).length,
    experts: experts.sort((a, b) => a.name.localeCompare(b.name)),
    players,
    failures,
    notPublished,
  }

  const body = `${JSON.stringify(payload)}\n`
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(fileFor(DATA_DIR, scoring), body)
  if (args.mirror) {
    await mkdir(MIRROR_DIR, { recursive: true })
    await writeFile(fileFor(MIRROR_DIR, scoring), body)
  }

  return {
    scoring,
    experts: experts.length,
    players: payload.playerCount,
    fetched,
    reused,
    notPublished: notPublished.length,
    failures: failures.length,
    sizeKB: Math.round(Buffer.byteLength(body) / 1024),
  }
}

const started = Date.now()
const directory = await fetchExpertDirectory(options)
log(`directory: ${directory.length} experts publishing their own board`)
log(`plan: ${directory.length * args.scoring.length} boards across ${args.scoring.join(', ')}`)

const summary = []
for (const scoring of args.scoring) {
  summary.push(await collectScoring(scoring, directory))
}

console.log(JSON.stringify(
  {
    elapsedMin: +((Date.now() - started) / 60000).toFixed(1),
    formats: summary,
    files: args.scoring.map((s) => fileFor(DATA_DIR, s)),
  },
  null,
  2,
))
