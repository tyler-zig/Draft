import type { AvailabilityEstimate } from '../draft/availability'
import type { Consistency } from '../draft/consistency'
import type { Player } from '../providers/types'

/**
 * What the app knows about a player that an ESPN snapshot does not.
 *
 * The snapshot already carries identity, position, pro team, editorial rank and
 * injury status, so none of that is repeated here. What it cannot know is
 * anything the app computes or collects: projections, value over replacement,
 * the live ADP board, consensus tiers and expert spread. Those are what turn
 * the overlay's guess into the app's actual recommendation.
 *
 * Keys are ESPN player ids, the same ids `mapEspnPlayers` produces, so the join
 * needs no name matching.
 */
export interface PlayerValuation {
  /** Consensus draft position from the collected ranking sources. */
  adp?: number | null
  /** The hourly live ADP board's draft position. */
  liveAdp?: number | null
  /** Value over the replacement-level player at the same position. */
  vorp?: number | null
  /** Season projection scored to this league's format. */
  projectedPoints?: number | null
  tier?: number | null
  rankStdDev?: number | null
  rankLow?: number | null
  rankHigh?: number | null
  /** Depth-chart position, which drives handcuff and standalone-value reasons. */
  depthChartOrder?: number | null
  bye?: number | null
  /**
   * Recent games-missed history, already regressed. ESPN publishes a current
   * injury designation but nothing about a player's record, and the overlay
   * runs the same recommender as the app -- without these two the overlay
   * would quietly score a 30-year-old coming off a lost season as though the
   * projection were a promise, which is the exact bug this pair exists to fix.
   */
  availability?: AvailabilityEstimate | null
  age?: number | null
  /** Weekly scoring spread, which drives the chopped floor term. */
  consistency?: Consistency | null
}

export interface ValuationTable {
  /** Which draft these were computed for, so a stale league's table is ignored. */
  leagueId: string
  season: string
  updatedAt: number
  players: Record<string, PlayerValuation>
}

/** Fields worth sending: everything else the extension already has. */
function valuationFor(player: Player): PlayerValuation | null {
  const valuation: PlayerValuation = {}
  let useful = false
  const put = <K extends keyof PlayerValuation>(key: K, value: PlayerValuation[K]) => {
    if (value == null) return
    valuation[key] = value
    useful = true
  }
  put('adp', player.adp)
  put('liveAdp', player.liveAdp)
  put('vorp', player.vorp)
  put('projectedPoints', player.projectedPoints)
  put('tier', player.tier)
  put('rankStdDev', player.rankStdDev)
  put('rankLow', player.rankLow)
  put('rankHigh', player.rankHigh)
  put('depthChartOrder', player.depthChartOrder)
  put('bye', player.bye)
  put('availability', player.availability)
  put('age', player.age)
  put('consistency', player.consistency)
  return useful ? valuation : null
}

/**
 * The table the app publishes to the extension.
 *
 * Capped because this crosses `postMessage` and lands in `chrome.storage`, and
 * because the tail is not draftable: players are kept in board order and the
 * rest dropped. A player the cap excludes simply scores on ESPN's own rank,
 * which is what the whole pool did before this existed.
 */
export function buildValuations(
  players: Player[],
  leagueId: string,
  season: string,
  limit = 600,
): ValuationTable {
  const ordered = [...players].sort((a, b) => {
    const left = a.liveAdp ?? a.adp ?? (a.searchRank > 0 ? a.searchRank : 9999)
    const right = b.liveAdp ?? b.adp ?? (b.searchRank > 0 ? b.searchRank : 9999)
    return left - right
  })
  const table: Record<string, PlayerValuation> = {}
  let kept = 0
  for (const player of ordered) {
    if (kept >= limit) break
    // ESPN ids only: the extension joins on the ids its own snapshot produces,
    // and a Sleeper-only player has nothing on the ESPN board to attach to.
    const id = player.espnId ?? player.id
    if (!id) continue
    const valuation = valuationFor(player)
    if (!valuation) continue
    table[String(id)] = valuation
    kept += 1
  }
  return { leagueId, season, updatedAt: Date.now(), players: table }
}

/**
 * Join the app's numbers onto players read from an ESPN snapshot.
 *
 * Players the table does not cover are returned untouched rather than blanked,
 * so a capped or stale table degrades to snapshot-only scoring instead of
 * losing players off the board.
 */
export function applyValuations(players: Player[], table: ValuationTable | null | undefined): Player[] {
  const valuations = table?.players
  if (!valuations) return players
  return players.map((player) => {
    const valuation = valuations[player.id]
    return valuation ? { ...player, ...valuation } : player
  })
}
