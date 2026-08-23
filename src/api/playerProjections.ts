import type { Player, ScoringType } from '../providers/types'
import { readRankingArtifact } from '../supabase/artifacts'
import { mergeCollectedProjections, parseCollectedProjections, type ProjectionSourceLine } from './collectedProjections'
import type { ProjectedPointsEntry } from './playerHistorical'

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
const VOLUME_KEYS = ['pts_ppr', 'pts_half_ppr', 'pts_std', 'pass_att', 'rush_att', 'rec', 'rec_tgt', 'fgm', 'xpm', 'sack'] as const

const cache = new Map<string, Map<string, PlayerProjection>>()

export interface PlayerProjection {
  sleeperId: string
  season: string
  name: string
  team: string | null
  position: string | null
  espnId?: string | null
  games: number | null
  stats: Record<string, number>
  pointsPpr: number | null
  pointsHalf: number | null
  pointsStd: number | null
  adp: number | null
  adpPpr: number | null
  adpHalf: number | null
  adpStd: number | null
  source: string
  breakdown?: ProjectionSourceLine[]
  updatedAt: number | null
}

export interface PlayerProjectionView {
  points: number | null
  ppg: number | null
  passAttempts: number | null
  rushAttempts: number | null
  receptions: number | null
  targets: number | null
  source: string
  updatedAt: number | null
  season: string
  breakdown: ProjectionSourceLine[]
}

export function projectionSeason(explicit?: string | null): string {
  const year = Number(explicit)
  if (Number.isInteger(year) && year >= 2020 && year <= 2100) return String(year)
  return String(new Date().getUTCFullYear())
}

export function clearNflProjectionsCache() {
  cache.clear()
}

export async function getNflProjections(season: string, signal?: AbortSignal): Promise<Map<string, PlayerProjection>> {
  const key = projectionSeason(season)
  const hit = cache.get(key)
  if (hit) return hit
  const data = await loadProjections(key, signal)
  cache.set(key, data)
  return data
}

export function volumeFormatPoints(stats: Record<string, number>): Pick<PlayerProjection, 'pointsPpr' | 'pointsHalf' | 'pointsStd'> {
  return {
    pointsPpr: volumePoints(stats, 1),
    pointsHalf: volumePoints(stats, 0.5),
    pointsStd: volumePoints(stats, 0),
  }
}

const SCORING_STAT_KEYS = [
  'pass_yd', 'pass_td', 'pass_int', 'pass_2pt',
  'rush_yd', 'rush_td', 'rush_2pt',
  'rec', 'rec_yd', 'rec_td', 'rec_2pt',
  'fum_lost',
  'bonus_rec_te', 'bonus_rec_wr', 'bonus_rec_rb',
] as const

const DEFAULT_RATES: Record<string, number> = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -1,
  rush_yd: 0.1,
  rush_td: 6,
  rec_yd: 0.1,
  rec_td: 6,
}

export function projectedPointsFor(
  projection: PlayerProjection,
  scoring: ScoringType,
  settings?: Record<string, number> | null,
  receptionOverride?: number | null,
): number | null {
  const custom = settings && isCustomScoring(settings, scoring) && canRecomputeFromSettings(settings)
    ? pointsFromSettings(projection.stats, settings)
    : null
  if (custom != null) return custom
  if (receptionOverride != null && projection.pointsStd != null && projection.stats.rec != null) {
    return projection.pointsStd + projection.stats.rec * receptionOverride
  }
  return formatPoints(projection, scoring)
}

export function lookupPlayerProjection(
  player: Pick<Player, 'id' | 'sleeperId' | 'espnId'>,
  projections: Map<string, PlayerProjection> | undefined,
): PlayerProjection | null {
  if (!projections?.size) return null
  return (player.sleeperId ? projections.get(player.sleeperId) : undefined)
    ?? (player.espnId ? projections.get(player.espnId) : undefined)
    ?? projections.get(player.id)
    ?? null
}

export function projectionAdp(projection: PlayerProjection, scoring: ScoringType): number | null {
  const preferred =
    scoring === 'ppr' ? projection.adpPpr
      : scoring === 'half_ppr' ? projection.adpHalf
        : scoring === 'std' ? projection.adpStd
          : null
  const value = preferred ?? projection.adp ?? projection.adpPpr ?? projection.adpHalf ?? projection.adpStd
  return value != null && value > 0 ? value : null
}

/** Fills blank ADP from Sleeper's format-specific projection ADP. Ranking-set ADP wins. */
export function attachProjectedAdp(
  players: Player[],
  projections: Map<string, PlayerProjection> | undefined,
  scoring: ScoringType,
): Player[] {
  if (!projections?.size) return players
  return players.map((player) => {
    if (player.adp != null && player.adp > 0) return player
    const projection = lookupPlayerProjection(player, projections)
    const adp = projection ? projectionAdp(projection, scoring) : null
    return adp == null ? player : { ...player, adp }
  })
}

export function viewPlayerProjection(
  player: Pick<Player, 'id' | 'sleeperId'>,
  projections: Map<string, PlayerProjection> | undefined,
  scoring: ScoringType,
  options?: { scoringSettings?: Record<string, number> | null; receptionOverride?: number | null },
): PlayerProjectionView | null {
  const projection = lookupPlayerProjection(player, projections)
  if (!projection || !hasVolume(projection.stats)) return null
  const points = projectedPointsFor(projection, scoring, options?.scoringSettings, options?.receptionOverride)
  const games = projection.games
  return {
    points,
    ppg: points != null && games != null && games > 0 ? points / games : null,
    passAttempts: projection.stats.pass_att ?? null,
    rushAttempts: projection.stats.rush_att ?? null,
    receptions: projection.stats.rec ?? null,
    targets: projection.stats.rec_tgt ?? null,
    source: projection.source,
    updatedAt: projection.updatedAt,
    season: projection.season,
    breakdown: scoreBreakdown(projection, scoring, options?.scoringSettings, options?.receptionOverride),
  }
}

export function projectionPointsPool(
  projections: Map<string, PlayerProjection> | undefined,
  scoring: ScoringType,
  settings?: Record<string, number> | null,
): ProjectedPointsEntry[] {
  if (!projections?.size) return []
  const entries: ProjectedPointsEntry[] = []
  for (const projection of projections.values()) {
    const points = projectedPointsFor(projection, scoring, settings)
    if (points == null) continue
    const breakdown = scoreBreakdown(projection, scoring, settings)
    entries.push({
      gsisId: null,
      espnId: projection.espnId ?? null,
      sleeperId: projection.sleeperId,
      name: projection.name ?? '',
      position: projection.position ?? '',
      points,
      ...(breakdown.length ? { breakdown } : {}),
    })
  }
  return entries
}

export function scoreBreakdown(
  projection: PlayerProjection,
  scoring: ScoringType,
  settings?: Record<string, number> | null,
  receptionOverride?: number | null,
): ProjectionSourceLine[] {
  const lines = projection.breakdown ?? []
  if (!lines.length) return []
  return lines.map((line) => ({
    ...line,
    points: projectedPointsFor({ ...projection, stats: line.stats, ...volumeFormatPoints(line.stats) }, scoring, settings, receptionOverride),
  }))
}

async function loadProjections(season: string, signal?: AbortSignal): Promise<Map<string, PlayerProjection>> {
  // One request per position, no `position[]`. Vercel's external rewrite
  // forwards `position=QB` and each board stays under ~1 MB. The old
  // `position[]=QB&position[]=RB…` query is dropped on the way through, and
  // the unfiltered season dump is 8.6 MB — over Vercel's proxy cap — so
  // production got an empty map and VORP stayed blank.
  const [payloads, collected] = await Promise.all([
    Promise.all(POSITIONS.map(async (position) => {
      const params = new URLSearchParams({ season_type: 'regular', position })
      const response = await fetch(`/sleeper/projections/nfl/${encodeURIComponent(season)}?${params}`, { signal })
      if (!response.ok) throw new Error(`Sleeper projections failed (${response.status})`)
      const payload = await response.json() as unknown
      return Array.isArray(payload) ? payload : []
    })),
    loadCollectedProjections(signal),
  ])
  const sleeper = parseSleeperProjections(payloads.flat(), season)
  return mergeCollectedProjections(sleeper, collected, season, volumeFormatPoints)
}

async function loadCollectedProjections(signal?: AbortSignal) {
  try {
    const payload = await readRankingArtifact('projections-latest', 'projections/latest.json', { signal })
    return parseCollectedProjections(payload)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return []
  }
}

export function parseSleeperProjections(payload: unknown, season: string): Map<string, PlayerProjection> {
  const rows = Array.isArray(payload) ? payload : []
  const byId = new Map<string, PlayerProjection>()
  for (const row of rows) {
    const parsed = parseRow(row, season)
    if (!parsed) continue
    const existing = byId.get(parsed.sleeperId)
    if (!existing || (parsed.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) byId.set(parsed.sleeperId, parsed)
  }
  // Sleeper often puts ADP on a separate row from the RotoWire volume line.
  // Merge those numbers onto the projection, or keep a stub so ADP still attaches.
  for (const row of rows) {
    const parsed = record(row)
    if (!parsed || typeof parsed.week === 'number') continue
    const sleeperId = text(parsed.player_id)
    if (!sleeperId) continue
    const fields = adpFields(numericStats(parsed.stats))
    if (!hasAdp(fields)) continue
    const existing = byId.get(sleeperId)
    byId.set(sleeperId, existing ? mergeAdp(existing, fields) : adpStub(sleeperId, season, parsed, fields))
  }
  return byId
}

function parseRow(value: unknown, season: string): PlayerProjection | null {
  const row = record(value)
  if (!row) return null
  if (typeof row.week === 'number') return null
  const sleeperId = text(row.player_id)
  if (!sleeperId) return null
  const stats = numericStats(row.stats)
  if (!hasVolume(stats)) return null
  const fields = adpFields(stats)
  const identity = playerIdentity(row)
  return {
    sleeperId,
    season: text(row.season) ?? season,
    ...identity,
    games: stats.gp ?? null,
    stats,
    pointsPpr: stats.pts_ppr ?? null,
    pointsHalf: stats.pts_half_ppr ?? null,
    pointsStd: stats.pts_std ?? null,
    ...fields,
    source: sourceLabel(text(row.company)),
    updatedAt: timestamp(row.last_modified) ?? timestamp(row.updated_at),
  }
}

function playerIdentity(row: Record<string, unknown>): { name: string; team: string | null; position: string | null } {
  const player = record(row.player)
  const first = text(player?.first_name)
  const last = text(player?.last_name)
  const combined = [first, last].filter(Boolean).join(' ')
  return {
    name: combined || text(player?.full_name) || text(row.full_name) || '',
    team: text(player?.team) ?? text(row.team),
    position: text(player?.position) ?? text(row.position),
  }
}

function hasVolume(stats: Record<string, number>) {
  return VOLUME_KEYS.some((key) => stats[key] != null)
}

interface AdpFields {
  adp: number | null
  adpPpr: number | null
  adpHalf: number | null
  adpStd: number | null
}

function adpFields(stats: Record<string, number>): AdpFields {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = stats[key]
      if (typeof value === 'number' && value > 0) return value
    }
    return null
  }
  return {
    adp: pick('adp'),
    adpPpr: pick('adp_ppr'),
    adpHalf: pick('adp_half_ppr', 'adp_half'),
    adpStd: pick('adp_std', 'adp_standard'),
  }
}

function hasAdp(fields: AdpFields) {
  return fields.adp != null || fields.adpPpr != null || fields.adpHalf != null || fields.adpStd != null
}

function mergeAdp(existing: PlayerProjection, incoming: AdpFields): PlayerProjection {
  return {
    ...existing,
    adp: existing.adp ?? incoming.adp,
    adpPpr: existing.adpPpr ?? incoming.adpPpr,
    adpHalf: existing.adpHalf ?? incoming.adpHalf,
    adpStd: existing.adpStd ?? incoming.adpStd,
  }
}

function adpStub(sleeperId: string, season: string, row: Record<string, unknown>, fields: AdpFields): PlayerProjection {
  return {
    sleeperId,
    season: text(row.season) ?? season,
    ...playerIdentity(row),
    games: null,
    stats: {},
    pointsPpr: null,
    pointsHalf: null,
    pointsStd: null,
    ...fields,
    source: 'Sleeper ADP',
    updatedAt: timestamp(row.last_modified) ?? timestamp(row.updated_at),
  }
}

function volumePoints(stats: Record<string, number>, receptionRate: number): number | null {
  let total = 0
  let matched = false
  for (const [key, rate] of Object.entries({ ...DEFAULT_RATES, fum_lost: -2, pass_2pt: 2, rush_2pt: 2, rec_2pt: 2, fgm: 3, xpm: 1 })) {
    const amount = stats[key]
    if (typeof amount !== 'number') continue
    matched = true
    total += amount * rate
  }
  if (typeof stats.rec === 'number') {
    matched = true
    total += stats.rec * receptionRate
  }
  return matched ? total : null
}

function formatPoints(projection: PlayerProjection, scoring: ScoringType): number | null {
  if (scoring === 'std') return projection.pointsStd
  if (scoring === 'ppr') return projection.pointsPpr
  if (scoring === 'half_ppr') {
    if (projection.pointsHalf != null) return projection.pointsHalf
    if (projection.pointsStd != null && projection.stats.rec != null) return projection.pointsStd + projection.stats.rec * 0.5
  }
  return projection.pointsHalf ?? average(projection.pointsStd, projection.pointsPpr)
}

function expectedReceptionRate(scoring: ScoringType): number | null {
  if (scoring === 'ppr') return 1
  if (scoring === 'half_ppr') return 0.5
  if (scoring === 'std') return 0
  return null
}

function rateMatches(settings: Record<string, number>, key: string, expected: number) {
  const rate = settings[key]
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return true
  return Math.abs(rate - expected) < 0.011
}

function isCustomScoring(settings: Record<string, number>, scoring: ScoringType): boolean {
  const recExpected = expectedReceptionRate(scoring)
  if (recExpected != null && !rateMatches(settings, 'rec', recExpected)) return true
  for (const [key, expected] of Object.entries(DEFAULT_RATES)) {
    if (!rateMatches(settings, key, expected)) return true
  }
  if ((settings.bonus_rec_te ?? 0) !== 0 || (settings.bonus_rec_wr ?? 0) !== 0 || (settings.bonus_rec_rb ?? 0) !== 0) return true
  return false
}

function canRecomputeFromSettings(settings: Record<string, number>): boolean {
  return typeof settings.rec_yd === 'number' || typeof settings.rush_yd === 'number' || typeof settings.pass_yd === 'number'
}

function pointsFromSettings(stats: Record<string, number>, settings: Record<string, number>): number | null {
  let total = 0
  let matched = false
  for (const key of SCORING_STAT_KEYS) {
    const rate = settings[key]
    if (typeof rate !== 'number' || !Number.isFinite(rate)) continue
    const stat = stats[key]
    if (typeof stat !== 'number' || !Number.isFinite(stat)) continue
    matched = true
    total += stat * rate
  }
  return matched ? total : null
}

function sourceLabel(company: string | null): string {
  if (!company) return 'Sleeper'
  if (company.toLowerCase() === 'rotowire') return 'RotoWire via Sleeper'
  return `${company} via Sleeper`
}

function numericStats(value: unknown): Record<string, number> {
  const root = record(value)
  if (!root) return {}
  const stats: Record<string, number> = {}
  for (const [key, entry] of Object.entries(root)) {
    const amount = num(entry)
    if (amount == null) continue
    stats[key] = amount
  }
  return stats
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function timestamp(value: unknown): number | null {
  const parsed = num(value)
  if (parsed == null) return null
  return parsed < 1e12 ? parsed * 1000 : parsed
}

function average(left: number | null, right: number | null): number | null {
  if (left != null && right != null) return (left + right) / 2
  return left ?? right
}
