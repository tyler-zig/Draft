import type { Player } from '../providers/types'
import { normalizeName, normalizePos, normalizeTeam } from '../rankings/normalize'
import { getPlayerHistoricalIntelligence, type HistoricalPlayerIntelligence } from './playerHistorical'
import { readRankingArtifact } from '../supabase/artifacts'

export interface PlayerStat {
  label: string
  value: string
}

export interface PlayerNewsItem {
  id: string
  headline: string
  description: string
  published: string | null
  url: string | null
  source: string
}

export interface PlayerMarketHistoryPoint {
  at: number
  rank: number | null
  adp: number | null
  /** FantasyPros real-time ADP board position, when that observation has one. */
  liveAdp: number | null
  low: number | null
  high: number | null
  sourceCount: number
}

export interface PlayerMarketHistory {
  points: PlayerMarketHistoryPoint[]
  source: string
  generatedAt: number | null
  message: string | null
}

export type MarketHistoryMode = 'liveAdp' | 'adp' | 'rank'

export interface RankingHistoryCatalog {
  source: string
  generatedAt: number | null
  message: string | null
  byEspnId: Map<string, PlayerMarketHistoryPoint[]>
  byNamePosTeam: Map<string, PlayerMarketHistoryPoint[]>
  byNamePos: Map<string, PlayerMarketHistoryPoint[]>
}

const emptyHistory = (source = 'Collected rankings', generatedAt: number | null = null, message: string | null = null): PlayerMarketHistory => (
  { points: [], source, generatedAt, message }
)

const emptyCatalog = (source = 'Collected rankings', generatedAt: number | null = null, message: string | null = null): RankingHistoryCatalog => (
  { source, generatedAt, message, byEspnId: new Map(), byNamePosTeam: new Map(), byNamePos: new Map() }
)

export function withLiveObservation(
  points: PlayerMarketHistoryPoint[],
  live?: { at: number; value: number } | null,
): PlayerMarketHistoryPoint[] {
  const appended = live && (!points.length || live.at > points[points.length - 1].at)
    ? { at: live.at, rank: null, adp: null, liveAdp: live.value, low: null, high: null, sourceCount: 0 }
    : null
  return appended ? [...points, appended] : points
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The real-time ADP payload already carries rolling Last 1 / Last 7 averages.
 * Turn those into chart points so a single scrape can draw a live-ADP trend
 * before two hourly snapshots exist. Skip a window that lands on a collected
 * observation we already have.
 */
export function withPayloadAdpWindows(
  points: PlayerMarketHistoryPoint[],
  player?: Pick<Player, 'liveAdp' | 'liveAdpLastOne' | 'liveAdpLastSeven' | 'liveAdpPublishedAt'> | null,
): PlayerMarketHistoryPoint[] {
  if (!player) return points
  const publishedAt = player.liveAdpPublishedAt && player.liveAdpPublishedAt > 0 ? player.liveAdpPublishedAt : null
  const windows = [
    { at: publishedAt ? publishedAt - 7 * DAY_MS : 0, value: player.liveAdpLastSeven },
    { at: publishedAt ? publishedAt - DAY_MS : 0, value: player.liveAdpLastOne },
    { at: publishedAt ?? 0, value: player.liveAdp },
  ]
  const extras = windows.flatMap(({ at, value }) => {
    if (value == null || !(at > 0)) return []
    if (points.some((point) => point.liveAdp != null && Math.abs(point.at - at) < 12 * 60 * 60 * 1000)) return []
    return [{ at, rank: null, adp: null, liveAdp: value, low: null, high: null, sourceCount: 1 }]
  })
  if (!extras.length) return points
  return [...points, ...extras].sort((left, right) => left.at - right.at)
}

export function marketHistoryMode(points: PlayerMarketHistoryPoint[]): MarketHistoryMode {
  // The room appends today's board as a synthetic point (sourceCount 0). That
  // is not a collected observation. Requiring two *collected* live-ADP points
  // keeps a reset board from turning one leftover snapshot plus "now" into a
  // Live ADP history series.
  const collectedLive = points.filter((point) => point.liveAdp != null && point.sourceCount > 0).length
  const collectedAdp = points.filter((point) => point.adp != null && point.sourceCount > 0).length
  return collectedLive >= 2 ? 'liveAdp' : collectedAdp >= 2 ? 'adp' : 'rank'
}

export function rangeFromHistory(points: PlayerMarketHistoryPoint[]): { low: number; high: number } | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index]
    if (point && point.low != null && point.high != null && point.high > point.low) return { low: point.low, high: point.high }
  }
  return null
}

export function attachHistoryRange(players: Player[], catalog?: RankingHistoryCatalog): Player[] {
  if (!catalog) return players
  return players.map((player) => {
    if (player.rankLow != null && player.rankHigh != null && player.rankHigh > player.rankLow) return player
    const range = rangeFromHistory(lookupMarketHistory(catalog, player).points)
    return range ? { ...player, rankLow: range.low, rankHigh: range.high } : player
  })
}

export function marketHistoryTrend(
  points: PlayerMarketHistoryPoint[],
  live?: { at: number; value: number } | null,
): number | null {
  const series = withLiveObservation(points, live)
  const mode = marketHistoryMode(series)
  const values = series.flatMap((point) => {
    const value = point[mode]
    return value == null ? [] : [value]
  })
  if (values.length < 2) return null
  const first = values[0]
  const last = values[values.length - 1]
  if (first == null || last == null) return null
  return first - last
}

export interface PlayerIntelligenceData {
  stats: PlayerStat[]
  news: PlayerNewsItem[]
  statsMessage: string | null
  newsMessage: string | null
  marketHistory: PlayerMarketHistory
  historical: HistoricalPlayerIntelligence
}

type JsonRecord = Record<string, unknown>

let rankingHistoryPromise: Promise<unknown> | null = null
let rankingHistoryCatalog: RankingHistoryCatalog | null = null

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' ? value as JsonRecord : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function displayValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return text(value)
}

function latestSeasonStats(value: unknown): PlayerStat[] {
  const root = record(value), categories = Array.isArray(root?.categories) ? root.categories : []
  const collected: PlayerStat[] = []
  for (const categoryValue of categories) {
    const category = record(categoryValue)
    const labels = Array.isArray(category?.displayNames) ? category.displayNames : []
    const seasons = Array.isArray(category?.statistics) ? category.statistics.map(record).filter((item): item is JsonRecord => Boolean(item)) : []
    const latest = seasons.sort((a, b) => Number(record(b.season)?.year ?? 0) - Number(record(a.season)?.year ?? 0))[0]
    const values = Array.isArray(latest?.stats) ? latest.stats : []
    labels.forEach((label, index) => {
      const name = text(label), shown = displayValue(values[index])
      if (name && shown && !collected.some((stat) => stat.label === name)) collected.push({ label: name, value: shown })
    })
  }
  const priority = ['Games Played', 'Passing Yards', 'Passing Touchdowns', 'Interceptions', 'Rushing Attempts', 'Rushing Yards', 'Rushing Touchdowns', 'Receptions', 'Receiving Yards', 'Receiving Touchdowns', 'Targets', 'Field Goals Made', 'Total Points']
  return collected.sort((a, b) => {
    const left = priority.indexOf(a.label), right = priority.indexOf(b.label)
    return (left < 0 ? 999 : left) - (right < 0 ? 999 : right)
  }).slice(0, 12)
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Request failed (${response.status})`)
  return response.json() as Promise<unknown>
}

function publishedAt(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw
}

function newsUrl(value: unknown): string | null {
  const links = record(value)
  return text(record(links?.web)?.href) ?? text(record(links?.mobile)?.href)
}

export function parseAthleteNews(player: Player, value: unknown): PlayerNewsItem[] {
  const root = record(value)
  const items: PlayerNewsItem[] = []
  const rotowire = record(root?.rotowire)
  const rotowireHeadline = text(rotowire?.headline) ?? text(rotowire?.description)
  if (rotowireHeadline) {
    items.push({
      id: `rotowire:${player.espnId ?? player.id}:${text(rotowire?.published) ?? rotowireHeadline}`,
      headline: rotowireHeadline,
      description: text(rotowire?.story) ?? '',
      published: publishedAt(rotowire?.published),
      url: player.espnId ? `https://www.espn.com/nfl/player/news/_/id/${encodeURIComponent(player.espnId)}` : null,
      source: 'RotoWire',
    })
  }
  const headlines = Array.isArray(root?.news) ? root.news : []
  headlines.forEach((entry, index) => {
    const item = record(entry)
    const headline = text(item?.headline) ?? text(item?.linkText)
    if (!item || !headline) return
    items.push({
      id: String(item.id ?? item.nowId ?? `espn:${player.id}:${index}`),
      headline,
      description: text(item.description) ?? '',
      published: publishedAt(item.lastModified ?? item.categorized),
      url: newsUrl(item.links),
      source: 'ESPN',
    })
  })
  return items.slice(0, 5)
}

async function fetchNews(player: Player, signal?: AbortSignal): Promise<PlayerNewsItem[]> {
  if (!player.espnId) return []
  return parseAthleteNews(player, await fetchJson(
    `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${encodeURIComponent(player.espnId)}/overview?region=us&lang=en&contentorigin=espn`,
    signal,
  ))
}

/** Same cache identity in the draft-room modal and on Player Intelligence. */
export function playerIntelligenceQueryKey(player: Pick<Player, 'id' | 'espnId' | 'sleeperId'>) {
  return player.espnId ?? player.sleeperId ?? player.id
}

export async function getPlayerNews(
  player: Player,
  signal?: AbortSignal,
): Promise<{ news: PlayerNewsItem[]; newsMessage: string | null }> {
  if (!player.espnId || player.position === 'DEF') {
    return {
      news: [],
      newsMessage: player.position === 'DEF'
        ? 'Player news is not available for team defenses.'
        : 'This player is not linked to an ESPN profile.',
    }
  }
  try {
    const news = await fetchNews(player, signal)
    return { news, newsMessage: news.length ? null : 'No recent RotoWire or ESPN updates for this player.' }
  } catch (error) {
    if (signal?.aborted) throw error
    return { news: [], newsMessage: 'Latest news is temporarily unavailable.' }
  }
}

const namePosKey = (name: string, position: string) => `${normalizeName(name)}|${normalizePos(position) ?? position}`
const namePosTeamKey = (name: string, position: string, team: string) => `${namePosKey(name, position)}|${normalizeTeam(team) ?? team}`

/** nflverse often has the ESPN id Sleeper left blank. News and the ADP graph both key on it. */
export function withResolvedEspnId<T extends Pick<Player, 'espnId'>>(
  player: T,
  historical?: Pick<HistoricalPlayerIntelligence, 'espnId'> | null,
): T {
  const espnId = player.espnId || historical?.espnId || undefined
  return espnId && espnId !== player.espnId ? { ...player, espnId } : player
}

function parseHistoryPoints(value: unknown): PlayerMarketHistoryPoint[] {
  if (!Array.isArray(value)) return []
  return value.map(record).filter((item): item is JsonRecord => Boolean(item)).flatMap((item) => {
    const at = Number(item.at)
    if (!Number.isFinite(at)) return []
    const numeric = (value: unknown) => Number.isFinite(Number(value)) && value != null ? Number(value) : null
    return [{ at, rank: numeric(item.rank), adp: numeric(item.adp), liveAdp: numeric(item.liveAdp), low: numeric(item.low), high: numeric(item.high), sourceCount: Number(item.sourceCount) || 0 }]
  }).sort((a, b) => a.at - b.at)
}

export function lookupMarketHistory(catalog: RankingHistoryCatalog | undefined, player: Player): PlayerMarketHistory {
  const stored = catalog
    ? (player.espnId ? catalog.byEspnId.get(player.espnId) : undefined)
      ?? (player.team ? catalog.byNamePosTeam.get(namePosTeamKey(player.fullName, player.position, player.team)) : undefined)
      ?? catalog.byNamePos.get(namePosKey(player.fullName, player.position))
      ?? []
    : []
  const points = withPayloadAdpWindows(stored, player)
  if (!points.length) {
    return emptyHistory(
      catalog?.source ?? 'Collected rankings',
      catalog?.generatedAt ?? null,
      catalog?.message ?? 'No collected ranking history matches this player.',
    )
  }
  return {
    points,
    source: points.length > stored.length ? 'FantasyPros real-time ADP windows' : catalog?.source ?? 'Collected rankings',
    generatedAt: catalog?.generatedAt ?? player.liveAdpPublishedAt ?? null,
    message: null,
  }
}

export async function getRankingHistoryCatalog(signal?: AbortSignal): Promise<RankingHistoryCatalog> {
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (rankingHistoryCatalog) return rankingHistoryCatalog
    rankingHistoryPromise ??= readRankingArtifact('rankings-history', 'rankings/history.json').catch((error) => {
      rankingHistoryPromise = null
      throw error
    })
    const root = record(await rankingHistoryPromise)
    if (root?.schemaVersion !== 1 || !Array.isArray(root.players)) {
      return emptyCatalog('Collected rankings', null, 'Ranking history has not been generated for this build.')
    }
    const catalog = emptyCatalog(String(root.series ?? 'Collected rankings'), Number(root.generatedAt) || null, null)
    for (const item of root.players.map(record).filter((entry): entry is JsonRecord => Boolean(entry))) {
      const points = parseHistoryPoints(item.points)
      const espnId = item.espnId == null ? '' : String(item.espnId)
      const name = String(item.name ?? '')
      const position = String(item.position ?? '')
      const team = item.team == null ? '' : String(item.team)
      if (espnId) catalog.byEspnId.set(espnId, points)
      if (name && position && team) catalog.byNamePosTeam.set(namePosTeamKey(name, position, team), points)
      if (name && position && !catalog.byNamePos.has(namePosKey(name, position))) catalog.byNamePos.set(namePosKey(name, position), points)
    }
    if (!catalog.byEspnId.size && !catalog.byNamePos.size) {
      catalog.message = 'Ranking history has not been generated for this build.'
    }
    rankingHistoryCatalog = catalog
    return catalog
  } catch (error) {
    if (signal?.aborted) throw error
    return emptyCatalog('Collected rankings', null, 'Ranking history is temporarily unavailable.')
  }
}

export async function getPlayerMarketHistory(
  player: Player,
  signal?: AbortSignal,
): Promise<PlayerMarketHistory> {
  return lookupMarketHistory(await getRankingHistoryCatalog(signal), player)
}

export function clearRankingHistoryCache() {
  rankingHistoryPromise = null
  rankingHistoryCatalog = null
}

export async function getPlayerIntelligence(
  player: Player,
  signal?: AbortSignal,
): Promise<PlayerIntelligenceData> {
  const historicalPromise = getPlayerHistoricalIntelligence(player, signal)
  // News, ESPN stats, and the ADP graph all key on espnId. Wait for nflverse
  // only when Sleeper (or the host league) left it blank -- Gibbs and Bijan
  // have been showing up that way, which blanked headlines and live-ADP history.
  let resolved = player
  if (!player.espnId && player.position !== 'DEF') {
    resolved = withResolvedEspnId(player, await historicalPromise)
  }

  const stats: PlayerStat[] = []
  let statsMessage: string | null = null

  const espnId = resolved.espnId
  if (espnId && resolved.position !== 'DEF') {
    try {
      const statsJson = await fetchJson(
        `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${encodeURIComponent(espnId)}/stats?region=us&lang=en&contentorigin=espn`,
        signal,
      )
      stats.push(...latestSeasonStats(statsJson))
      if (!stats.length) statsMessage = 'No current-season statistics were returned.'
    } catch (error) {
      if (signal?.aborted) throw error
      statsMessage = 'Current-season statistics are temporarily unavailable.'
    }
  } else {
    statsMessage = resolved.position === 'DEF'
      ? 'Individual statistics are not available for team defenses.'
      : 'This player is not linked to an ESPN profile.'
  }

  const [{ news, newsMessage }, marketHistory, historical] = await Promise.all([
    getPlayerNews(resolved, signal),
    getPlayerMarketHistory(resolved, signal),
    historicalPromise,
  ])
  return { stats, news, statsMessage, newsMessage, marketHistory, historical }
}
