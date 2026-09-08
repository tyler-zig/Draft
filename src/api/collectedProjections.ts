import { playerKey } from '../rankings/normalize'
import type { PlayerProjection } from './playerProjections'

const VOLUME_KEYS = [
  'pass_att', 'pass_cmp', 'pass_yd', 'pass_td', 'pass_int', 'pass_2pt',
  'rush_att', 'rush_yd', 'rush_td', 'rush_2pt',
  'rec', 'rec_tgt', 'rec_yd', 'rec_td', 'rec_2pt',
  'fum_lost',
  'fgm', 'fga', 'xpm',
  'sack', 'int', 'fum_rec', 'def_td', 'safe', 'pts_allow',
] as const

export const SOURCE_LABELS: Record<string, string> = {
  fantasysharks: 'FantasySharks',
  cbs: 'CBS',
  espn: 'ESPN',
  rotowire: 'RotoWire',
}

export const SOURCE_ORDER = ['cbs', 'espn', 'fantasysharks', 'rotowire'] as const

export interface ProjectionSourceLine {
  id: string
  label: string
  stats: Record<string, number>
  games: number | null
  points: number | null
}

export interface CollectedProjection {
  name: string
  team: string | null
  position: string | null
  espnId: string | null
  games: number | null
  stats: Record<string, number>
  pointsPpr: number | null
  pointsHalf: number | null
  pointsStd: number | null
  sourceIds: string[]
  sourceCount: number
  sources: Array<{ id: string; stats: Record<string, number>; games: number | null }>
}

export interface CollectedProjectionsArtifact {
  schemaVersion: number
  fetchedAt: number
  season: string
  players: CollectedProjection[]
}

export function parseCollectedProjections(payload: unknown): CollectedProjection[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const players = (payload as { players?: unknown }).players
  if (!Array.isArray(players)) return []
  const rows: CollectedProjection[] = []
  for (const value of players) {
    const row = parseCollectedRow(value)
    if (row) rows.push(row)
  }
  return rows
}

function parseCollectedRow(value: unknown): CollectedProjection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  const position = typeof row.position === 'string' ? row.position : null
  if (!name || !position) return null
  const stats = numericRecord(row.stats)
  if (!VOLUME_KEYS.some((key) => stats[key] != null)) return null
  const sourceIds = Array.isArray(row.sourceIds)
    ? row.sourceIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
  return {
    name,
    team: typeof row.team === 'string' ? row.team : null,
    position,
    espnId: typeof row.espnId === 'string' && row.espnId ? row.espnId : null,
    games: num(row.games),
    stats,
    pointsPpr: num(row.pointsPpr),
    pointsHalf: num(row.pointsHalf),
    pointsStd: num(row.pointsStd),
    sourceIds,
    sourceCount: typeof row.sourceCount === 'number' ? row.sourceCount : sourceIds.length,
    sources: parseSourceSamples(row.sources),
  }
}

function parseSourceSamples(value: unknown) {
  if (!Array.isArray(value)) return []
  const samples: Array<{ id: string; stats: Record<string, number>; games: number | null }> = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : null
    const stats = numericRecord(row.stats)
    if (!id || !VOLUME_KEYS.some((key) => stats[key] != null)) continue
    samples.push({ id, stats, games: num(row.games) })
  }
  return samples
}

/**
 * Folds the collected consensus into the live Sleeper map. Sleeper ADP stays;
 * volume is a source-count-weighted blend so one RotoWire row cannot outweigh
 * three scraped boards. Players only present on the collected side are keyed
 * by ESPN id (and a collected: fallback) so ESPN sessions still match.
 */
export function mergeCollectedProjections(
  sleeper: Map<string, PlayerProjection>,
  collected: CollectedProjection[],
  season: string,
  recompute: (stats: Record<string, number>) => Pick<PlayerProjection, 'pointsPpr' | 'pointsHalf' | 'pointsStd'>,
): Map<string, PlayerProjection> {
  if (!collected.length) return sleeper

  const result = new Map(sleeper)
  const byKey = new Map<string, PlayerProjection>()
  for (const row of result.values()) {
    const key = playerKey(row.name, row.team, row.position)
    if (key) byKey.set(key, row)
    if (row.espnId) result.set(row.espnId, row)
  }

  for (const row of collected) {
    const incoming = seasonCollected(row)
    if (!incoming) continue
    const key = playerKey(incoming.name, incoming.team, incoming.position)
    const existing = (key ? byKey.get(key) : undefined)
      ?? (incoming.espnId ? result.get(incoming.espnId) : undefined)
    if (existing) {
      const merged = blendWithSleeper(existing, incoming, recompute)
      writeProjection(result, merged)
      if (key) byKey.set(key, merged)
      continue
    }
    const created = collectedOnly(incoming, season, recompute)
    writeProjection(result, created)
    if (key) byKey.set(key, created)
  }
  return result
}

function sleeperLooksOutlier(existing: PlayerProjection, incoming: CollectedProjection) {
  const incomingPoints = volumeScore(incoming.stats)
  const sleeperPoints = volumeScore(volumeOnly(existing.stats))
  if (!(incomingPoints > 0 && sleeperPoints > 0)) return false
  return sleeperPoints < incomingPoints * OUTLIER_LOW || sleeperPoints > incomingPoints * OUTLIER_HIGH
}

function blendWithSleeper(
  existing: PlayerProjection,
  incoming: CollectedProjection,
  recompute: (stats: Record<string, number>) => Pick<PlayerProjection, 'pointsPpr' | 'pointsHalf' | 'pointsStd'>,
): PlayerProjection {
  const weight = Math.max(1, incoming.sourceCount || incoming.sourceIds.length || 1)
  const sleeperHasVolume = VOLUME_KEYS.some((key) => existing.stats[key] != null)
    && !sleeperLooksOutlier(existing, incoming)
  const stats = sleeperHasVolume
    ? weightedStats(incoming.stats, weight, existing.stats)
    : incoming.stats
  const sourceIds = sleeperHasVolume && (incoming.sourceIds.includes('rotowire') || existing.source.toLowerCase().includes('rotowire'))
    ? unique([...incoming.sourceIds, 'rotowire'])
    : incoming.sourceIds
  const points = recompute(stats)
  return {
    ...existing,
    espnId: existing.espnId ?? incoming.espnId,
    name: existing.name || incoming.name,
    team: existing.team ?? incoming.team,
    position: existing.position ?? incoming.position,
    games: incoming.games ?? existing.games,
    stats: { ...existing.stats, ...stats },
    ...points,
    source: sourceLabel(sleeperHasVolume ? sourceIds : incoming.sourceIds),
    breakdown: sourceBreakdown(incoming, sleeperHasVolume ? existing : null),
    updatedAt: incoming.sourceCount ? existing.updatedAt : existing.updatedAt,
  }
}

function collectedOnly(
  row: CollectedProjection,
  season: string,
  recompute: (stats: Record<string, number>) => Pick<PlayerProjection, 'pointsPpr' | 'pointsHalf' | 'pointsStd'>,
): PlayerProjection {
  const id = row.espnId ?? `collected:${playerKey(row.name, row.team, row.position)}`
  return {
    sleeperId: id,
    espnId: row.espnId,
    season,
    name: row.name,
    team: row.team,
    position: row.position,
    games: row.games,
    stats: row.stats,
    ...recompute(row.stats),
    adp: null,
    adpPpr: null,
    adpHalf: null,
    adpStd: null,
    source: sourceLabel(row.sourceIds),
    breakdown: sourceBreakdown(row, null),
    updatedAt: null,
  }
}

export function sourceBreakdown(
  incoming: Pick<CollectedProjection, 'sources' | 'sourceIds'>,
  sleeper: PlayerProjection | null,
): ProjectionSourceLine[] {
  const lines = new Map<string, ProjectionSourceLine>()
  for (const sample of incoming.sources ?? []) {
    lines.set(sample.id, {
      id: sample.id,
      label: SOURCE_LABELS[sample.id] ?? sample.id,
      stats: sample.stats,
      games: sample.games,
      points: null,
    })
  }
  if (sleeper && VOLUME_KEYS.some((key) => sleeper.stats[key] != null)) {
    lines.set('rotowire', {
      id: 'rotowire',
      label: SOURCE_LABELS.rotowire,
      stats: volumeOnly(sleeper.stats),
      games: sleeper.games,
      points: sleeper.pointsPpr ?? sleeper.pointsHalf ?? sleeper.pointsStd,
    })
  }
  return [...lines.values()].sort((a, b) => sourceRank(a.id) - sourceRank(b.id) || a.label.localeCompare(b.label))
}

function sourceRank(id: string) {
  const index = SOURCE_ORDER.indexOf(id as typeof SOURCE_ORDER[number])
  return index === -1 ? SOURCE_ORDER.length : index
}

function volumeOnly(stats: Record<string, number>) {
  const compact: Record<string, number> = {}
  for (const key of VOLUME_KEYS) {
    if (stats[key] != null) compact[key] = stats[key]
  }
  return compact
}

function writeProjection(map: Map<string, PlayerProjection>, row: PlayerProjection) {
  map.set(row.sleeperId, row)
  if (row.espnId) map.set(row.espnId, row)
}

function weightedStats(collected: Record<string, number>, collectedWeight: number, sleeper: Record<string, number>) {
  const keys = new Set([...Object.keys(collected), ...Object.keys(sleeper)])
  const stats: Record<string, number> = {}
  for (const key of keys) {
    if (key.startsWith('adp') || key.startsWith('pts_')) continue
    const left = collected[key]
    const right = sleeper[key]
    if (typeof left === 'number' && typeof right === 'number') {
      stats[key] = (left * collectedWeight + right) / (collectedWeight + 1)
    } else if (typeof left === 'number') {
      stats[key] = left
    } else if (typeof right === 'number') {
      stats[key] = right
    }
  }
  return stats
}

export function sourceLabel(sourceIds: string[]): string {
  const names = unique(sourceIds.map((id) => SOURCE_LABELS[id] ?? id)).filter(Boolean)
  if (names.length === 0) return 'Consensus'
  if (names.length === 1) return names[0] === 'RotoWire' ? 'RotoWire via Sleeper' : names[0]
  return `Consensus (${names.join(', ')})`
}

/**
 * CBS `/season/` and FantasySharks' default Segment flip to Week 1 at
 * kickoff. Sharks CSVs often omit G, so a 63-yard Gibbs line would survive
 * a games-only check and halve VORP. Drop those samples and rebuild.
 */
export function isWeeklyProjection(row: { games?: number | null; stats?: Record<string, number> }): boolean {
  if (row.games != null && row.games > 0 && row.games <= 3) return true
  if (row.games != null && row.games > 3) return false
  return looksWeeklyVolume(row.stats)
}

function looksWeeklyVolume(stats?: Record<string, number>) {
  if (!stats) return false
  const pass = stats.pass_yd
  const rush = stats.rush_yd
  const rec = stats.rec_yd
  const fg = stats.fgm
  const sacks = stats.sack
  const allowed = stats.pts_allow
  if (pass > 800 || rush > 300 || rec > 300 || fg > 10 || sacks > 15 || allowed > 80) return false
  if (typeof pass === 'number' && pass > 0 && pass <= 500) return true
  if (typeof rush === 'number' && rush > 0 && rush <= 180) return true
  if (typeof rec === 'number' && rec > 0 && rec <= 180) return true
  if (typeof fg === 'number' && fg > 0 && fg <= 6) return true
  if (typeof sacks === 'number' && sacks > 0 && sacks <= 8) return true
  if (typeof allowed === 'number' && allowed > 0 && allowed <= 50) return true
  return false
}

const OUTLIER_LOW = 0.45
const OUTLIER_HIGH = 2.2
const OUTLIER_MIN_SOURCES = 3

function volumeScore(stats?: Record<string, number>) {
  if (!stats) return 0
  return (stats.pass_yd ?? 0) * 0.04
    + (stats.pass_td ?? 0) * 4
    + (stats.pass_int ?? 0) * -1
    + (stats.rush_yd ?? 0) * 0.1
    + (stats.rush_td ?? 0) * 6
    + (stats.rec ?? 0)
    + (stats.rec_yd ?? 0) * 0.1
    + (stats.rec_td ?? 0) * 6
    + (stats.fgm ?? 0) * 3
    + (stats.xpm ?? 0)
    + (stats.sack ?? 0)
    + (stats.int ?? 0) * 2
    + (stats.fum_rec ?? 0) * 2
    + (stats.def_td ?? 0) * 6
    + (stats.safe ?? 0) * 2
}

function median(values: number[]) {
  const amounts = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right)
  if (!amounts.length) return null
  const mid = Math.floor(amounts.length / 2)
  return amounts.length % 2 ? amounts[mid]! : (amounts[mid - 1]! + amounts[mid]!) / 2
}

/** A source under half or over 2.2× the others' median is treated as tainted. */
export function rejectOutlierSamples<T extends { stats: Record<string, number> }>(samples: T[]): T[] {
  const rows = samples.filter((sample) => VOLUME_KEYS.some((key) => sample.stats[key] != null))
  if (rows.length < OUTLIER_MIN_SOURCES) return rows
  const scored = rows.map((sample) => ({ sample, points: volumeScore(sample.stats) }))
  const mid = median(scored.map((row) => row.points))
  if (!(mid != null && mid > 0)) return rows
  const kept = scored
    .filter((row) => row.points >= mid * OUTLIER_LOW && row.points <= mid * OUTLIER_HIGH)
    .map((row) => row.sample)
  return kept.length >= 2 ? kept : rows
}

function rebuildFromSamples(row: CollectedProjection, samples: CollectedProjection['sources']): CollectedProjection | null {
  if (!samples.length) return null
  const stats = averageVolume(samples.map((sample) => sample.stats))
  if (!VOLUME_KEYS.some((key) => stats[key] != null)) return null
  const games = samples
    .map((sample) => sample.games)
    .filter((value): value is number => value != null && value > 3)
  return {
    ...row,
    stats,
    games: games.length ? games.reduce((sum, value) => sum + value, 0) / games.length : row.games,
    sources: samples,
    sourceIds: samples.map((sample) => sample.id),
    sourceCount: samples.length,
  }
}

function seasonCollected(row: CollectedProjection): CollectedProjection | null {
  const seasonal = row.sources.filter((sample) => !isWeeklyProjection(sample))
  const samples = rejectOutlierSamples(seasonal)
  if (samples.length !== row.sources.length) {
    if (!samples.length) return isWeeklyProjection(row) ? null : row
    return rebuildFromSamples(row, samples)
  }
  if (isWeeklyProjection(row) && !samples.length) return null
  return row
}

function averageVolume(rows: Array<Record<string, number>>) {
  const sums: Record<string, number> = {}
  const counts: Record<string, number> = {}
  for (const stats of rows) {
    for (const key of VOLUME_KEYS) {
      const amount = stats[key]
      if (typeof amount !== 'number' || !Number.isFinite(amount)) continue
      sums[key] = (sums[key] ?? 0) + amount
      counts[key] = (counts[key] ?? 0) + 1
    }
  }
  const averaged: Record<string, number> = {}
  for (const key of VOLUME_KEYS) {
    if (counts[key]) averaged[key] = sums[key]! / counts[key]!
  }
  return averaged
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function numericRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const stats: Record<string, number> = {}
  for (const [key, amount] of Object.entries(value as Record<string, unknown>)) {
    const parsed = num(amount)
    if (parsed == null) continue
    stats[key] = parsed
  }
  return stats
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
