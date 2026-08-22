import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { parse } from 'csv-parse'
import { calculateGamesMissed, type RosterWeek } from '../src/intelligence/calculations/durability'
import { calculateOpportunityShares, calculateSnapShares, type OpportunityRow, type RedZoneOpportunity, type SnapRow } from '../src/intelligence/calculations/usage'
import { mergeSeasonSlices, needsBuild, parseSeasonList, resolveSeasons, seasonHasSignal, splitLegacyPlayers, type SeasonSlice } from './lib/intelligence-history'
import { gamesFromCsv, publishedScheduleArtifact, refreshPublishedSchedule } from '../src/intelligence/scheduleRefresh'
import { writePlayerShards } from './lib/intelligence-shards'

type CsvRow = Record<string, string>

const root = resolve(import.meta.dirname, '..')
const rawDir = resolve(root, 'data/intelligence/raw/nflverse')
const normalizedDir = resolve(root, 'data/intelligence/normalized')
const publicFile = resolve(root, 'public/intelligence/latest.json')
const publicScheduleFile = resolve(root, 'public/intelligence/schedule.json')
const refresh = process.argv.includes('--refresh')
const currentYear = new Date().getUTCFullYear()
const requested = parseSeasonList(process.argv.find((value) => value.startsWith('--seasons='))?.slice(10), currentYear)

const urls = (season: number) => ({
  stats: `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`,
  rosters: `https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_${season}.csv`,
  snaps: `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`,
  pbp: `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`,
})
const scheduleUrl = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv'

const seasonFile = (season: number) => resolve(normalizedDir, String(season), 'season.json')
const exists = async (path: string) => { try { await access(path); return true } catch { return false } }

async function readJson<T>(path: string) {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch { return null }
}

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value)}\n`)
  await rename(temporary, path)
}

async function listStoredSeasons() {
  try {
    const years = await readdir(normalizedDir)
    const stored: number[] = []
    for (const year of years) {
      const season = Number(year)
      if (!Number.isInteger(season) || !await exists(seasonFile(season))) continue
      stored.push(season)
    }
    return stored.sort((a, b) => a - b)
  } catch {
    return []
  }
}

async function migrateLegacyArtifact() {
  const stored = await listStoredSeasons()
  if (stored.length) return stored
  const legacy = await readJson<{ seasons?: number[]; players?: PublishedPlayer[] }>(publicFile)
    ?? await readJson<{ seasons?: number[]; players?: PublishedPlayer[] }>(resolve(normalizedDir, String(currentYear - 1), 'players.json'))
  if (!legacy?.players?.length) return []
  const seasons = [...new Set((legacy.seasons?.length ? legacy.seasons : legacy.players.flatMap((player) => player.seasons.map((entry) => entry.season))).filter((season) => Number.isInteger(season)))].sort((a, b) => a - b)
  for (const season of seasons) {
    await atomicJson(seasonFile(season), {
      schemaVersion: 1,
      season,
      generatedAt: new Date().toISOString(),
      sources: [],
      players: splitLegacyPlayers(legacy.players, season),
    } satisfies SeasonSlice)
  }
  return seasons
}

async function download(url: string, target: string, options: { alwaysCheck?: boolean } = {}) {
  const metadataFile = `${target}.metadata.json`
  if (!refresh && !options.alwaysCheck && await exists(target)) return { url, path: target, cached: true }
  let metadata: Record<string, string> = {}
  try { metadata = JSON.parse(await readFile(metadataFile, 'utf8')) as Record<string, string> } catch { /* first download */ }
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(300_000),
        headers: {
          'user-agent': 'DraftAssistant-player-intelligence/1.0',
          ...(metadata.etag ? { 'if-none-match': metadata.etag } : {}),
          ...(metadata.lastModified ? { 'if-modified-since': metadata.lastModified } : {}),
        },
      })
      if (response.status === 304 && await exists(target)) return { url, path: target, cached: true }
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      await mkdir(dirname(target), { recursive: true })
      const temporary = `${target}.${process.pid}.tmp`
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temporary))
      await rename(temporary, target)
      metadata = { url, retrievedAt: new Date().toISOString(), etag: response.headers.get('etag') ?? '', lastModified: response.headers.get('last-modified') ?? '' }
      await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`)
      return { url, path: target, cached: false }
    } catch (error) {
      if (attempt === 3) throw new Error(`Failed to download ${url}: ${error instanceof Error ? error.message : String(error)}`)
      await new Promise((resolveWait) => setTimeout(resolveWait, attempt * 750))
    }
  }
  throw new Error(`Failed to download ${url}`)
}

async function eachCsv(path: string, visit: (row: CsvRow) => void) {
  const input = createReadStream(path)
  const decoded = path.endsWith('.gz') ? input.pipe(createGunzip()) : input
  const parser = decoded.pipe(parse({ columns: true, skip_empty_lines: true, relax_column_count: true }))
  for await (const row of parser) visit(row as CsvRow)
}

const number = (value: string | undefined) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
const fantasyPositions = new Set(['QB', 'RB', 'WR', 'TE', 'K'])

interface Profile {
  gsisId: string
  espnId: string | null
  sleeperId: string | null
  pfrId: string | null
  name: string
  team: string
  position: string
}

interface Stat extends OpportunityRow {
  season: number
  week: number
  gameId: string
  name: string
  position: string
  opponent: string
  completions: number
  attempts: number
  passingYards: number
  passingTds: number
  interceptions: number
  rushingYards: number
  rushingTds: number
  receptions: number
  receivingYards: number
  receivingTds: number
  fantasyPoints: number
  fantasyPointsPpr: number
}

const stored = await migrateLegacyArtifact()
const { all: seasons, rebuild } = resolveSeasons({ requested, stored, currentYear, refresh })
if (!seasons.length) throw new Error('No valid seasons. Use --seasons=2021,2022,2023 to add frozen history.')
const toBuild = seasons.filter((season) => needsBuild(season, stored, rebuild))

async function buildSeason(season: number): Promise<SeasonSlice> {
  const seasonUrls = urls(season)
  const sourceMetadata: SeasonSlice['sources'] = []
  const files = Object.fromEntries(await Promise.all(Object.entries(seasonUrls).map(async ([kind, url]) => {
    const path = resolve(rawDir, basename(url))
    const result = await download(url, path)
    sourceMetadata.push({ season, kind, url, cached: result.cached })
    return [kind, path]
  }))) as Record<keyof ReturnType<typeof urls>, string>

  const profiles = new Map<string, Profile>()
  const pfrToGsis = new Map<string, string>()
  const roster: RosterWeek[] = []
  const stats: Stat[] = []
  const snaps: SnapRow[] = []
  const redZone: RedZoneOpportunity[] = []
  const teamGames = new Set<string>()
  const participated = new Set<string>()
  const appeared = new Set<string>()

  await eachCsv(files.rosters, (row) => {
    if (row.game_type !== 'REG' || !fantasyPositions.has(row.position) || !row.gsis_id) return
    const week = number(row.week)
    profiles.set(row.gsis_id, { gsisId: row.gsis_id, espnId: row.espn_id || null, sleeperId: row.sleeper_id || null, pfrId: row.pfr_id || null, name: row.full_name, team: row.team, position: row.position })
    if (row.pfr_id) pfrToGsis.set(row.pfr_id, row.gsis_id)
    roster.push({ playerId: row.gsis_id, team: row.team, week, status: row.status })
    appeared.add(row.gsis_id)
  })

  await eachCsv(files.stats, (row) => {
    if (row.season_type !== 'REG' || !row.player_id || !fantasyPositions.has(row.position)) return
    const week = number(row.week)
    stats.push({
      playerId: row.player_id, season, week, gameId: row.game_id, name: row.player_display_name, position: row.position,
      team: row.team, opponent: row.opponent_team, carries: number(row.carries), targets: number(row.targets), completions: number(row.completions), attempts: number(row.attempts),
      passingYards: number(row.passing_yards), passingTds: number(row.passing_tds), interceptions: number(row.passing_interceptions), rushingYards: number(row.rushing_yards), rushingTds: number(row.rushing_tds),
      receptions: number(row.receptions), receivingYards: number(row.receiving_yards), receivingTds: number(row.receiving_tds), fantasyPoints: number(row.fantasy_points), fantasyPointsPpr: number(row.fantasy_points_ppr),
    })
    teamGames.add(`${row.team}|${week}`)
    participated.add(`${row.player_id}|${row.team}|${week}`)
    appeared.add(row.player_id)
    if (!profiles.has(row.player_id)) profiles.set(row.player_id, { gsisId: row.player_id, espnId: null, sleeperId: null, pfrId: null, name: row.player_display_name, team: row.team, position: row.position })
  })

  await eachCsv(files.snaps, (row) => {
    if (row.game_type !== 'REG') return
    const playerId = pfrToGsis.get(row.pfr_player_id)
    if (!playerId) return
    const week = number(row.week)
    snaps.push({ playerId, team: row.team, gameId: row.game_id, offenseSnaps: number(row.offense_snaps) })
    teamGames.add(`${row.team}|${week}`)
    appeared.add(playerId)
    if (number(row.offense_snaps) + number(row.st_snaps) > 0) participated.add(`${playerId}|${row.team}|${week}`)
  })

  await eachCsv(files.pbp, (row) => {
    if (row.season_type !== 'REG' || number(row.yardline_100) <= 0 || number(row.yardline_100) > 20 || !row.posteam) return
    const week = number(row.week)
    if (number(row.rush_attempt) === 1 && number(row.qb_kneel) !== 1 && row.rusher_player_id) redZone.push({ playerId: row.rusher_player_id, team: row.posteam, kind: 'carry', week })
    if (number(row.pass_attempt) === 1 && row.receiver_player_id) redZone.push({ playerId: row.receiver_player_id, team: row.posteam, kind: 'target', week })
  })

  const usageByPlayer = calculateOpportunityShares(stats, redZone)
  const snapsByPlayer = calculateSnapShares(snaps)
  const sum = (rows: Stat[], field: keyof Stat) => rows.reduce((total, row) => total + Number(row[field] ?? 0), 0)

  const players = [...appeared].flatMap((gsisId) => {
    const profile = profiles.get(gsisId)
    if (!profile) return []
    const rows = stats.filter((row) => row.playerId === gsisId)
    const usage = usageByPlayer.get(gsisId)
    const snap = snapsByPlayer.get(gsisId)
    const historical = {
      season,
      gamesPlayed: new Set(rows.map((row) => row.gameId)).size,
      stats: {
        completions: sum(rows, 'completions'), attempts: sum(rows, 'attempts'), passingYards: sum(rows, 'passingYards'), passingTds: sum(rows, 'passingTds'), interceptions: sum(rows, 'interceptions'),
        carries: sum(rows, 'carries'), rushingYards: sum(rows, 'rushingYards'), rushingTds: sum(rows, 'rushingTds'), receptions: sum(rows, 'receptions'), targets: sum(rows, 'targets'), receivingYards: sum(rows, 'receivingYards'), receivingTds: sum(rows, 'receivingTds'),
        fantasyPoints: sum(rows, 'fantasyPoints'), fantasyPointsPpr: sum(rows, 'fantasyPointsPpr'),
      },
      weekly: rows.map((row) => ({ week: row.week, opponent: row.opponent, team: row.team, fantasyPoints: row.fantasyPoints, fantasyPointsPpr: row.fantasyPointsPpr, carries: row.carries, targets: row.targets, offenseSnaps: snaps.find((entry) => entry.playerId === gsisId && entry.gameId === row.gameId)?.offenseSnaps ?? null })).sort((a, b) => a.week - b.week),
      usage: { opportunities: usage?.opportunities ?? 0, touchShare: usage?.touchShare ?? null, redZoneOpportunities: usage?.redZoneOpportunities ?? 0, redZoneTouchShare: usage?.redZoneTouchShare ?? null, offenseSnaps: snap?.offenseSnaps ?? 0, snapShare: snap?.snapShare ?? null },
      durability: calculateGamesMissed(roster.filter((row) => row.playerId === gsisId), teamGames, participated),
    }
    if (!seasonHasSignal(historical)) return []
    return [{ ids: { gsis: profile.gsisId, espn: profile.espnId, sleeper: profile.sleeperId, pfr: profile.pfrId }, name: profile.name, team: profile.team, position: profile.position, season: historical }]
  }).sort((a, b) => a.name.localeCompare(b.name))

  const slice: SeasonSlice = { schemaVersion: 1, season, generatedAt: new Date().toISOString(), sources: sourceMetadata, players }
  await atomicJson(seasonFile(season), slice)
  return slice
}

const slices: SeasonSlice[] = []
for (const season of seasons) {
  if (!toBuild.includes(season)) {
    const kept = await readJson<SeasonSlice>(seasonFile(season))
    if (!kept) throw new Error(`Missing frozen season ${season}. Re-run with --seasons=${season}.`)
    slices.push(kept)
    continue
  }
  slices.push(await buildSeason(season))
}

async function refreshSchedule(generatedAt: string, artifact: Parameters<typeof refreshPublishedSchedule>[0]['artifact']) {
  const path = resolve(rawDir, 'games.csv')
  const downloaded = await download(scheduleUrl, path, { alwaysCheck: true })
  const refreshed = refreshPublishedSchedule({
    artifact,
    games: gamesFromCsv(await readFile(path, 'utf8')),
    currentYear,
    generatedAt,
  })
  await atomicJson(resolve(normalizedDir, `${refreshed.model.season}/schedule.json`), {
    schemaVersion: 1,
    generatedAt,
    source: downloaded.url,
    cached: downloaded.cached,
    season: refreshed.model.season,
    window: refreshed.model.window,
    teams: refreshed.model.teams,
    matchups: refreshed.model.matchups,
    strengthOfSchedule: refreshed.model.strengthOfSchedule,
  })
  return refreshed
}

const generatedAt = new Date().toISOString()
const payload = mergeSeasonSlices(slices, generatedAt)
if (!payload.players.length) throw new Error('Output has no player records.')
for (const player of payload.players) {
  if (!player.ids.gsis || !player.name || !player.seasons.length) throw new Error(`Invalid player record: ${player.name || player.ids.gsis}`)
  for (const season of player.seasons) {
    for (const metric of [season.usage.touchShare, season.usage.redZoneTouchShare, season.usage.snapShare]) {
      if (metric != null && (metric < 0 || metric > 1.001)) throw new Error(`Invalid share for ${player.name}: ${metric}`)
    }
  }
}

const { artifact: published } = await refreshSchedule(generatedAt, payload)
await atomicJson(resolve(normalizedDir, `${seasons.at(-1)}/players.json`), published)
await atomicJson(publicFile, published)
await atomicJson(publicScheduleFile, publishedScheduleArtifact(published))
const shards = await writePlayerShards(published, resolve(root, 'public'))
console.log(JSON.stringify({ output: publicFile, schedule: publicScheduleFile, shards, ...published.summary, kept: seasons.filter((season) => !toBuild.includes(season)), built: toBuild }, null, 2))
