import type { Player, ScoringType } from '../providers/types'
import { fetchArtifact } from '../supabase/artifacts'
import { matchupScoringFor, resolvePlayerSchedule, type PlayerScheduleView, type ScheduleModel, type ScheduleWeek } from '../intelligence/calculations/matchup'
import { SHARD_INDEX_PATH, normalizedPlayerName, shardPath } from '../intelligence/shards'

export interface HistoricalWeek {
  week: number
  opponent: string
  team: string
  fantasyPoints: number
  fantasyPointsPpr: number
  carries: number
  targets: number
  offenseSnaps: number | null
}

export interface HistoricalSeason {
  season: number
  gamesPlayed: number
  stats: {
    completions: number
    attempts: number
    passingYards: number
    passingTds: number
    interceptions: number
    carries: number
    rushingYards: number
    rushingTds: number
    receptions: number
    targets: number
    receivingYards: number
    receivingTds: number
    fantasyPoints: number
    fantasyPointsPpr: number
  }
  weekly: HistoricalWeek[]
  usage: {
    opportunities: number
    touchShare: number | null
    redZoneOpportunities: number
    redZoneTouchShare: number | null
    offenseSnaps: number
    snapShare: number | null
  }
  durability: {
    gamesMissed: number
    missedWeeks: number[]
    byStatus: Record<string, number>
  }
}

export interface HistoricalPlayerIntelligence {
  seasons: HistoricalSeason[]
  schedule: PlayerScheduleView | null
  scheduleModel: ScheduleModel | null
  source: string
  updatedAt: string
  methodology: Record<string, string>
  message: string | null
  espnId?: string | null
}

interface HistoricalArtifact {
  schemaVersion: number
  generatedAt: string
  attribution: string
  methodology: Record<string, string>
  players: Array<{
    ids: { gsis: string; espn: string | null; sleeper: string | null; pfr: string | null }
    name: string
    team: string
    position: string
    seasons: HistoricalSeason[]
  }>
  schedule?: {
    season: number
    source: string
    updatedAt: string
    teams: Record<string, ScheduleWeek[]>
  }
  matchups?: {
    window: ScheduleModel['window']
    byScoring: ScheduleModel['matchups']
    strengthOfSchedule: ScheduleModel['strengthOfSchedule']
  }
}

type ScheduleSlice = Pick<HistoricalArtifact, 'schedule' | 'matchups' | 'attribution'>
type PlayerRecord = HistoricalArtifact['players'][number]
interface IndexedArtifact {
  raw: HistoricalArtifact
  byGsis: Map<string, PlayerRecord>
  byEspn: Map<string, PlayerRecord>
  bySleeper: Map<string, PlayerRecord>
}

/** The small identity index that maps a player to the bucket holding them. */
interface ShardIndexEntry {
  g: string
  e: string | null
  s: string | null
  n: string
  p: string
  d: number
}
interface ShardIndex {
  attribution: string
  generatedAt: string
  methodology: Record<string, string>
  byGsis: Map<string, ShardIndexEntry>
  byEspn: Map<string, ShardIndexEntry>
  bySleeper: Map<string, ShardIndexEntry>
  byNamePos: Map<string, ShardIndexEntry>
}

let schedulePromise: Promise<ScheduleSlice | null> | null = null
let artifactPromise: Promise<IndexedArtifact> | null = null
let shardIndexPromise: Promise<ShardIndex | null> | null = null
const shardPromises = new Map<number, Promise<Map<string, PlayerRecord>>>()

function scheduleSliceFrom(value: unknown): ScheduleSlice | null {
  if (!value || typeof value !== 'object') return null
  const root = value as Record<string, unknown>
  const schedule = root.schedule && typeof root.schedule === 'object'
    ? root.schedule as HistoricalArtifact['schedule']
    : undefined
  if (!schedule?.teams) return null
  return {
    schedule,
    matchups: root.matchups as HistoricalArtifact['matchups'],
    attribution: typeof root.attribution === 'string' ? root.attribution : '',
  }
}

function indexArtifact(artifact: HistoricalArtifact): IndexedArtifact {
  const byGsis = new Map<string, PlayerRecord>()
  const byEspn = new Map<string, PlayerRecord>()
  const bySleeper = new Map<string, PlayerRecord>()
  for (const record of artifact.players) {
    if (record.ids.gsis) byGsis.set(record.ids.gsis, record)
    if (record.ids.espn) byEspn.set(record.ids.espn, record)
    if (record.ids.sleeper) bySleeper.set(record.ids.sleeper, record)
  }
  return { raw: artifact, byGsis, byEspn, bySleeper }
}

function loadIndexedArtifact() {
  artifactPromise ??= fetchArtifact('intelligence/latest.json').then(async (response) => {
    if (!response.ok) throw new Error(`Request failed (${response.status})`)
    const artifact = await response.json() as HistoricalArtifact
    if (artifact.schemaVersion !== 1 || !Array.isArray(artifact.players)) throw new Error('Unsupported intelligence schema')
    return indexArtifact(artifact)
  }).catch((error) => {
    artifactPromise = null
    throw error
  })
  return artifactPromise
}

/** Small schedule/matchup file. Falls back to latest.json for older deploys. */
function loadScheduleArtifact() {
  schedulePromise ??= fetchArtifact('intelligence/schedule.json').then(async (response) => {
    if (response.ok) {
      const parsed = scheduleSliceFrom(await response.json())
      if (parsed) return parsed
    }
    return scheduleSliceFrom((await loadIndexedArtifact()).raw)
  }).catch((error) => {
    schedulePromise = null
    throw error
  })
  return schedulePromise
}

export function clearHistoricalArtifactCache() {
  artifactPromise = null
  schedulePromise = null
  shardIndexPromise = null
  shardPromises.clear()
}

/** Current-season team slates. Reads the small schedule artifact, not player history. */
export async function getPublishedSchedule(signal?: AbortSignal): Promise<Record<string, ScheduleWeek[]> | null> {
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const artifact = await loadScheduleArtifact()
    return artifact?.schedule?.teams ?? null
  } catch (error) {
    if (signal?.aborted) throw error
    return null
  }
}

/**
 * Schedules plus per-position FPA ranks from the schedule artifact. Falls
 * back to the full player-history file only when that small file is missing.
 */
export async function getPublishedScheduleModel(signal?: AbortSignal): Promise<ScheduleModel | null> {
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const artifact = await loadScheduleArtifact()
    return artifact ? scheduleModelFromArtifact(artifact) : null
  } catch (error) {
    if (signal?.aborted) throw error
    return null
  }
}

const normalizedName = normalizedPlayerName

/**
 * The sharded read path. Returns null -- not an error -- when the index is
 * absent or is not a shard index, which is the normal state for a deploy whose
 * artifacts predate sharding; callers then fall back to `latest.json`.
 */
function loadShardIndex(): Promise<ShardIndex | null> {
  shardIndexPromise ??= fetchArtifact(SHARD_INDEX_PATH).then(async (response) => {
    if (!response.ok) return null
    const raw = await response.json() as Record<string, unknown>
    // An older deploy serves `latest.json`'s shape here, or a SPA host answers
    // with index.html. Neither carries `shardCount`, so neither is mistaken
    // for a shard index.
    if (typeof raw?.shardCount !== 'number' || !Array.isArray(raw.players)) return null
    const index: ShardIndex = {
      attribution: typeof raw.attribution === 'string' ? raw.attribution : '',
      generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : '',
      methodology: (raw.methodology ?? {}) as Record<string, string>,
      byGsis: new Map(), byEspn: new Map(), bySleeper: new Map(), byNamePos: new Map(),
    }
    for (const entry of raw.players as ShardIndexEntry[]) {
      if (!entry?.g || typeof entry.d !== 'number') continue
      index.byGsis.set(entry.g, entry)
      if (entry.e) index.byEspn.set(entry.e, entry)
      if (entry.s) index.bySleeper.set(entry.s, entry)
      const key = `${entry.n}|${entry.p}`
      if (!index.byNamePos.has(key)) index.byNamePos.set(key, entry)
    }
    return index
  }).catch(() => {
    shardIndexPromise = null
    return null
  })
  return shardIndexPromise
}

/** One bucket of full records, keyed by gsis id. Memoized per shard. */
function loadShard(shard: number): Promise<Map<string, PlayerRecord>> {
  const existing = shardPromises.get(shard)
  if (existing) return existing
  const pending = fetchArtifact(shardPath(shard)).then(async (response) => {
    if (!response.ok) throw new Error(`Request failed (${response.status})`)
    const raw = await response.json() as { players?: PlayerRecord[] }
    const byGsis = new Map<string, PlayerRecord>()
    for (const record of raw.players ?? []) {
      if (record?.ids?.gsis) byGsis.set(record.ids.gsis, record)
    }
    return byGsis
  }).catch((error) => {
    shardPromises.delete(shard)
    throw error
  })
  shardPromises.set(shard, pending)
  return pending
}

interface RecordLookup {
  record: PlayerRecord | null
  attribution: string
  generatedAt: string
  methodology: Record<string, string>
}

/**
 * Resolves one player without reading the whole dataset when the sharded
 * artifact is published, and reads `latest.json` when it is not.
 */
async function lookupPlayerRecord(player: Player): Promise<RecordLookup> {
  const index = await loadShardIndex()
  if (index) {
    const entry = (player.gsisId ? index.byGsis.get(player.gsisId) : undefined)
      ?? (player.espnId ? index.byEspn.get(player.espnId) : undefined)
      ?? (player.sleeperId ? index.bySleeper.get(player.sleeperId) : undefined)
      ?? index.byNamePos.get(`${normalizedName(player.fullName)}|${player.position}`)
    const meta = { attribution: index.attribution, generatedAt: index.generatedAt, methodology: index.methodology }
    if (!entry) return { record: null, ...meta }
    return { record: (await loadShard(entry.d)).get(entry.g) ?? null, ...meta }
  }

  const indexed = await loadIndexedArtifact()
  const artifact = indexed.raw
  const record = (player.gsisId ? indexed.byGsis.get(player.gsisId) : undefined)
    ?? (player.espnId ? indexed.byEspn.get(player.espnId) : undefined)
    ?? (player.sleeperId ? indexed.bySleeper.get(player.sleeperId) : undefined)
    ?? artifact.players.find((candidate) => normalizedName(candidate.name) === normalizedName(player.fullName) && candidate.position === player.position)
    ?? null
  return { record, attribution: artifact.attribution, generatedAt: artifact.generatedAt, methodology: artifact.methodology }
}

export function scheduleModelFromArtifact(artifact: Pick<HistoricalArtifact, 'schedule' | 'matchups' | 'attribution'>): ScheduleModel | null {
  if (!artifact.schedule?.teams || !artifact.matchups?.byScoring) return null
  return {
    season: artifact.schedule.season,
    source: artifact.schedule.source || artifact.attribution,
    updatedAt: artifact.schedule.updatedAt,
    teams: artifact.schedule.teams,
    window: artifact.matchups.window,
    matchups: artifact.matchups.byScoring,
    strengthOfSchedule: artifact.matchups.strengthOfSchedule,
  }
}

export function playerScheduleFromHistorical(
  historical: Pick<HistoricalPlayerIntelligence, 'scheduleModel'>,
  player: Pick<Player, 'team' | 'position'>,
  scoring: string | null | undefined,
): PlayerScheduleView | null {
  return resolvePlayerSchedule({
    team: player.team,
    position: player.position,
    scoring: matchupScoringFor(scoring),
    model: historical.scheduleModel,
  })
}

function emptyHistorical(source: string, updatedAt = '', methodology: Record<string, string> = {}, message: string | null = null, scheduleModel: ScheduleModel | null = null): HistoricalPlayerIntelligence {
  return { seasons: [], schedule: null, scheduleModel, source, updatedAt, methodology, message, espnId: null }
}

export async function getPlayerHistoricalIntelligence(player: Player, signal?: AbortSignal, scoring?: string): Promise<HistoricalPlayerIntelligence> {
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    // The schedule/matchup model comes from the small schedule artifact, not
    // from player history -- reading it off the monolith was what pulled the
    // whole dataset in before a single record was even needed.
    const slice = await loadScheduleArtifact()
    const scheduleModel = slice ? scheduleModelFromArtifact(slice) : null
    const schedule = resolvePlayerSchedule({ team: player.team, position: player.position, scoring: matchupScoringFor(scoring), model: scheduleModel })
    const { record, attribution, generatedAt, methodology } = await lookupPlayerRecord(player)
    if (!record) return { ...emptyHistorical(attribution, generatedAt, methodology, 'No nflverse historical record matches this player.', scheduleModel), schedule }
    return { seasons: record.seasons, schedule, scheduleModel, source: attribution, updatedAt: generatedAt, methodology, message: null, espnId: record.ids.espn || null }
  } catch (error) {
    if (signal?.aborted) throw error
    return emptyHistorical('Data: nflverse (CC-BY-4.0)', '', {}, 'Historical usage data is temporarily unavailable.')
  }
}

export interface ProjectedPointsEntry {
  gsisId: string | null
  espnId: string | null
  sleeperId: string | null
  name: string
  position: string
  points: number
  breakdown?: import('./collectedProjections').ProjectionSourceLine[]
}

function pointsForScoring(stats: HistoricalSeason['stats'], scoring: ScoringType): number {
  if (scoring === 'std') return stats.fantasyPoints
  if (scoring === 'ppr') return stats.fantasyPointsPpr
  // half_ppr and unknown both split the difference -- unknown scoring is more
  // often half-PPR-ish than either pure format in practice.
  return (stats.fantasyPoints + stats.fantasyPointsPpr) / 2
}

/**
 * Sleeper's per-stat scoring settings keys that this app can actually apply,
 * mapped to the matching `HistoricalSeason['stats']` field. Sleeper publishes
 * more categories than this (fumbles, two-point conversions, bonus yardage
 * thresholds, IDP...) but the nflverse-derived historical dataset only carries
 * these, so a league using the others still gets a slightly approximate
 * number -- the same honest limitation as the format-based fallback, just
 * narrower.
 */
const SETTINGS_STAT_MAP: Array<[key: string, stat: keyof HistoricalSeason['stats']]> = [
  ['pass_yd', 'passingYards'],
  ['pass_td', 'passingTds'],
  ['pass_int', 'interceptions'],
  ['rush_yd', 'rushingYards'],
  ['rush_td', 'rushingTds'],
  ['rec', 'receptions'],
  ['rec_yd', 'receivingYards'],
  ['rec_td', 'receivingTds'],
]

/**
 * Points from the league's actual per-stat scoring settings, when we have a
 * usable set. Returns null when the settings don't cover anything we can
 * compute (missing, or an ESPN-style numeric-id map we can't interpret), so
 * the caller can fall back to `pointsForScoring`.
 */
function pointsFromSettings(
  stats: HistoricalSeason['stats'],
  settings: Record<string, number> | null | undefined,
): number | null {
  if (!settings) return null
  let total = 0
  let matched = false
  for (const [key, stat] of SETTINGS_STAT_MAP) {
    const rate = settings[key]
    if (typeof rate !== 'number') continue
    matched = true
    total += stats[stat] * rate
  }
  return matched ? total : null
}

/**
 * Every player's points proxy from their most recent completed season, scored
 * to the given format. Draft-room VORP no longer uses this -- it reads Sleeper
 * season projections instead -- but the helper remains for historical scoring
 * checks. Last year's actuals are not a forward projection.
 */
export async function getProjectedPointsPool(
  scoring: ScoringType,
  scoringSettings?: Record<string, number> | null,
): Promise<ProjectedPointsEntry[]> {
  const artifact = (await loadIndexedArtifact()).raw
  if (artifact.schemaVersion !== 1 || !Array.isArray(artifact.players)) return []
  const entries: ProjectedPointsEntry[] = []
  for (const record of artifact.players) {
    const latest = [...record.seasons].sort((a, b) => b.season - a.season)[0]
    if (!latest || latest.gamesPlayed <= 0) continue
    const points = pointsFromSettings(latest.stats, scoringSettings) ?? pointsForScoring(latest.stats, scoring)
    entries.push({
      gsisId: record.ids.gsis || null,
      espnId: record.ids.espn || null,
      sleeperId: record.ids.sleeper || null,
      name: record.name,
      position: record.position,
      points,
    })
  }
  return entries
}
