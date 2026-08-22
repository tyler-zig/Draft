import type { Player, ScoringType } from '../providers/types'
import type { MatchedRankRow, RankMethod, RankSet } from './types'
import { isLiveAdpSetId } from './types'
import { assignTiers } from './tiers'

export interface PlayerRankSource {
  id: string
  label: string
  rank: number
  fetchedAt: number
}

export interface PlayerRankFacts {
  sources: PlayerRankSource[]
  low: number | null
  high: number | null
  updatedAt: number | null
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const a = sorted[mid]
  const b = sorted[mid - 1]
  if (sorted.length % 2 === 1) return a ?? 9999
  return ((b ?? a ?? 9999) + (a ?? 9999)) / 2
}

function mean(values: number[]): number {
  if (values.length === 0) return 9999
  return values.reduce((sum, n) => sum + n, 0) / values.length
}

/** Turn scores (higher better) or mixed ranks into 1..N overall ranks. */
export function normalizeSetRanks(rows: MatchedRankRow[]): MatchedRankRow[] {
  const useScores = rows.some((r) => r.score != null) && rows.every((r) => !r.overall)
  if (!useScores) return [...rows]
  const sorted = [...rows].sort((a, b) => {
    return (b.score ?? 0) - (a.score ?? 0)
  })
  return sorted.map((row, i) => ({
    ...row,
    overall: i + 1,
  }))
}

export function builtinSet(
  id: string,
  label: string,
  players: Player[],
): RankSet {
  const rows: MatchedRankRow[] = players
    .filter((p) => p.searchRank > 0 && p.searchRank < 9000)
    .map((p) => ({
      name: p.fullName,
      team: p.team,
      position: p.position,
      overall: p.searchRank,
      // Carried through so a provider that publishes a real ADP (ESPN does)
      // reaches the market index. Without this the built-in sets contributed
      // rank only, and every ADP column read "—".
      adp: p.adp ?? null,
      sleeperId: p.sleeperId,
      espnId: p.espnId,
      playerId: p.id,
    }))
  return {
    id,
    label,
    scoring: 'unknown',
    kind: 'builtin',
    fetchedAt: Date.now(),
    rows: normalizeSetRanks(rows),
    unmatched: [],
  }
}

function indexSetRows(rows: MatchedRankRow[]): Map<string, MatchedRankRow> {
  const map = new Map<string, MatchedRankRow>()
  for (const row of rows) {
    const keys = [row.playerId, row.sleeperId, row.espnId].filter(
      (k): k is string => Boolean(k),
    )
    for (const key of keys) {
      if (!map.has(key)) map.set(key, row)
    }
  }
  return map
}

function spreadBound(value: number | null | undefined): number[] {
  return value != null && Number.isFinite(value) ? [value] : []
}

/**
 * One set's rows, normalized and keyed by every id a player might carry.
 *
 * Building this is the expensive half of `getPlayerRankFacts`, and it does not
 * depend on the player -- so it is hoisted out of the per-player loops in
 * `attachSetRange` and `applyConsensusRanks`. Rebuilding it per player made
 * both O(players x sets x rows): ~23k full re-indexes of ~3.9k rows on a real
 * directory, which cost ~2.5s of blocked main thread on every page load.
 */
export interface RankFactsIndex {
  id: string
  label: string
  fetchedAt: number
  rows: Map<string, MatchedRankRow>
}

export function buildRankFactsIndex(sets: RankSet[], enabledIds: string[]): RankFactsIndex[] {
  return sets
    .filter((set) => enabledIds.includes(set.id))
    .map((set) => ({
      id: set.id,
      label: set.label,
      fetchedAt: set.fetchedAt,
      rows: indexSetRows(normalizeSetRanks(set.rows)),
    }))
}

/** Per-player half of `getPlayerRankFacts`, reading a prebuilt index. */
export function rankFactsFrom(player: Player, index: RankFactsIndex[]): PlayerRankFacts {
  const keys = [player.id, player.sleeperId, player.espnId].filter(
    (key): key is string => Boolean(key),
  )
  const sources = index.flatMap((set) => {
    const row = keys.map((key) => set.rows.get(key)).find((value) => value != null)
    return row == null ? [] : [{
      id: set.id,
      label: set.label,
      rank: row.overall,
      best: row.best ?? null,
      worst: row.worst ?? null,
      fetchedAt: set.fetchedAt,
    }]
  })
  const ranks = sources.map((source) => source.rank)
  const lows = sources.flatMap((source) => [source.rank, ...spreadBound(source.best)])
  const highs = sources.flatMap((source) => [source.rank, ...spreadBound(source.worst)])
  // A single overall rank is not a range. A published expert min/max is, and
  // so is the spread across two or more enabled boards.
  const hasRange = ranks.length >= 2 || sources.some((source) => source.best != null && source.worst != null && source.best !== source.worst)
  return {
    sources: sources.map(({ id, label, rank, fetchedAt }) => ({ id, label, rank, fetchedAt })),
    low: hasRange ? Math.min(...lows) : null,
    high: hasRange ? Math.max(...highs) : null,
    updatedAt: sources.length ? Math.max(...sources.map((source) => source.fetchedAt)) : null,
  }
}

/** Single-player convenience wrapper; loops should hoist the index instead. */
export function getPlayerRankFacts(
  player: Player,
  sets: RankSet[],
  enabledIds: string[],
): PlayerRankFacts {
  return rankFactsFrom(player, buildRankFactsIndex(sets, enabledIds))
}

/**
 * Expert spread is a published fact, not a recipe setting. Use every available
 * board -- not only the ones enabled for consensus -- so Range still fills
 * when the user left Sleeper as the sole ranking source.
 */
export function attachSetRange(players: Player[], sets: RankSet[]): Player[] {
  if (!sets.length) return players
  const index = buildRankFactsIndex(sets, sets.map((set) => set.id))
  return players.map((player) => {
    if (player.rankLow != null && player.rankHigh != null && player.rankHigh > player.rankLow) return player
    const facts = rankFactsFrom(player, index)
    if (facts.low == null || facts.high == null || facts.high <= facts.low) return player
    return { ...player, rankLow: facts.low, rankHigh: facts.high }
  })
}

interface MarketFacts {
  adp: number | null
  tier: number | null
  stdDev: number | null
}

/**
 * `fillOnly` is what keeps the off-format pass from competing with the
 * matching one: without it the earliest ADP wins regardless of format, which
 * is the cross-market blend this split exists to prevent.
 */
function absorb(map: Map<string, MarketFacts>, sets: RankSet[], fillOnly = false) {
  for (const set of sets) {
    for (const row of set.rows) {
      const keys = [row.playerId, row.sleeperId, row.espnId].filter(
        (k): k is string => Boolean(k),
      )
      for (const key of keys) {
        const existing = map.get(key) ?? { adp: null, tier: null, stdDev: null }
        // A zero ADP means the source had no value, not that he goes first.
        // Admitting one would win every `min` comparison below it.
        const adp = row.adp != null && row.adp > 0 ? row.adp : null
        if (adp != null && (existing.adp == null || (!fillOnly && adp < existing.adp))) {
          existing.adp = adp
        }
        existing.tier ??= row.tier ?? null
        existing.stdDev ??= row.stdDev ?? null
        map.set(key, existing)
      }
    }
  }
}

/**
 * ADP and tier describe the market, not one expert's opinion, so they are
 * collected across enabled sets rather than averaged: the earliest ADP seen
 * and the first tier reported win.
 *
 * Sets matching the league's scoring format are absorbed first and are not
 * overwritten by the rest. A PPR player's ADP and a standard player's ADP are
 * two different markets, and taking the minimum across both reported neither.
 * Off-format sets still fill players the matching sets never mention, which is
 * better than an empty column.
 *
 * Built from the raw rows because normalizeSetRanks rewrites `overall` but
 * carries these through untouched.
 */
type MarketKey = 'ppr' | 'half' | 'standard'

/**
 * One spelling for a scoring market.
 *
 * The collected sets tag themselves `half` / `standard`, while a DraftSession
 * reports `half_ppr` / `std`. Comparing those strings directly matched only
 * PPR, so in every half or standard league no set counted as the league's
 * market and ADP fell through to the fill pass -- where the ESPN builtin sits
 * first and supplies ESPN's raw averageDraftPosition instead of a real board.
 */
function marketKey(value: string | null | undefined): MarketKey | null {
  switch (String(value ?? '').toLowerCase()) {
    case 'ppr':
      return 'ppr'
    case 'half':
    case 'half_ppr':
      return 'half'
    case 'standard':
    case 'std':
      return 'standard'
    default:
      return null
  }
}

function indexMarket(sets: RankSet[], leagueScoring?: ScoringType): Map<string, MarketFacts> {
  const map = new Map<string, MarketFacts>()
  // A set that names no market fills gaps but never competes on equal footing:
  // the built-ins carry a provider's own ADP, which is a different market from
  // the collected boards and should not outrank one that names the format.
  // Built-ins are a provider's own averageDraftPosition -- ESPN's league-wide
  // number, not a collected board. That is a different market, so it fills
  // gaps and never competes: letting it into the `min` reported neither
  // market, and for defenses, where the two disagree by tens of picks, the
  // provider's aggressive number won every time.
  // The live board is reported separately as `liveAdp`; letting it also drive
  // the season ADP made both columns read the same number.
  const collected = sets.filter((set) => set.kind !== 'builtin' && !isLiveAdpSetId(set.id))
  const provider = sets.filter((set) => set.kind === 'builtin')
  const wanted = marketKey(leagueScoring)
  const matching = wanted ? collected.filter((set) => marketKey(set.scoring) === wanted) : []
  const rest = collected.filter((set) => !matching.includes(set))

  if (matching.length) {
    absorb(map, matching)
    absorb(map, [...rest, ...provider], true)
    return map
  }
  // No board names the league's format -- or the league never said what it is.
  // The collected boards still describe the draft market better than a single
  // provider's number, so they compete among themselves first.
  absorb(map, rest)
  absorb(map, provider, true)
  return map
}

export function applyConsensusRanks(
  players: Player[],
  sets: RankSet[],
  enabledIds: string[],
  method: RankMethod,
  /** The league's scoring format, so ADP and tier come from that market. */
  leagueScoring?: ScoringType,
): Player[] {
  const enabled = sets.filter((set) => enabledIds.includes(set.id))
  // One normalize+index pass feeds both the consensus values and the rank
  // facts below; the facts used to re-index every set for every player.
  const factsIndex = buildRankFactsIndex(enabled, enabledIds)

  const withoutTiers: Player[] = factsIndex.length === 0
    ? players.map((p) => ({ ...p, consensusCount: 0, tier: null, rankLow: null, rankHigh: null, rankUpdatedAt: null, rankingSources: [] }))
    : (() => {
        const market = indexMarket(enabled, leagueScoring)
        return players.map((player) => {
          const keys = [player.id, player.sleeperId, player.espnId].filter(
            (k): k is string => Boolean(k),
          )
          const values: number[] = []
          for (const set of factsIndex) {
            let hit: MatchedRankRow | undefined
            for (const key of keys) {
              hit = set.rows.get(key)
              if (hit != null) break
            }
            if (hit != null) values.push(hit.overall)
          }

          let facts: MarketFacts | undefined
          for (const key of keys) {
            facts = market.get(key)
            if (facts) break
          }

          if (values.length === 0) {
            return { ...player, consensusCount: 0, adp: facts?.adp ?? player.adp ?? null, tier: facts?.tier ?? null, rankStdDev: facts?.stdDev ?? null, rankLow: null, rankHigh: null, rankUpdatedAt: null, rankingSources: [] }
          }
          const overall = method === 'mean' ? mean(values) : median(values)
          const rankFacts = rankFactsFrom(player, factsIndex)
          return {
            ...player,
            searchRank: overall,
            consensusCount: values.length,
            adp: facts?.adp ?? player.adp ?? null,
            tier: facts?.tier ?? null,
            rankStdDev: facts?.stdDev ?? null,
            rankLow: rankFacts.low,
            rankHigh: rankFacts.high,
            rankUpdatedAt: rankFacts.updatedAt,
            rankingSources: rankFacts.sources,
          }
        })
      })()

  // A source's own published tier (RotoWire boards commonly have one) wins
  // when present; otherwise fall back to the gap/overlap clustering below,
  // computed from this consensus pass's own ranks and expert spread.
  const computedTiers = assignTiers(
    withoutTiers.map((p) => ({ id: p.id, position: p.position, rank: p.searchRank, rankLow: p.rankLow ?? null, rankHigh: p.rankHigh ?? null })),
  )
  return withoutTiers.map((p) => ({ ...p, tier: p.tier ?? computedTiers.get(p.id) ?? null }))
}
