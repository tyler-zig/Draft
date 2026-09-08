/**
 * Week-to-week scoring consistency, and the floor it implies.
 *
 * A survival league is decided by a team's worst week. The engine had no
 * measure of that: it read `rankStdDev` -- the spread of expert opinion about
 * where a player should be *drafted* -- and treated it as a floor. Those are
 * different quantities. Two analysts disagreeing about a player's draft slot
 * says nothing about whether his Sundays are steady, and the field is optional
 * at the source, so on a board whose ADP feed omits it the whole floor signal
 * silently evaluated to nothing.
 *
 * What replaces it is the player's own coefficient of variation across a real
 * season of weekly scores, published in the intelligence shard index.
 *
 * It is scored against his positional peers rather than in absolute terms,
 * because the positions genuinely differ -- on the 2025 season, median CV runs
 * 0.48 at QB, 0.58 at RB, 0.59 at WR and 0.62 at TE. A tight end at 0.55 is
 * steadier than most tight ends; a quarterback at 0.55 is choppier than most
 * quarterbacks. An absolute threshold would call them the same player and
 * would quietly rank whole positions against each other on a number that only
 * means something within one.
 */

import type { Player } from '../providers/types'

export interface Consistency {
  /** Standard deviation of weekly points over their mean. Lower is steadier. */
  cv: number
  /** Weeks behind the reading. */
  weeks: number
}

/** Reads the `[cv, weeks]` pair carried in the shard index. */
export function consistencyFromPair(pair: readonly number[] | null | undefined): Consistency | null {
  if (!pair || pair.length < 2) return null
  const [cv, weeks] = [pair[0]!, pair[1]!]
  if (!Number.isFinite(cv) || !Number.isFinite(weeks)) return null
  if (cv <= 0 || weeks <= 0) return null
  return { cv, weeks }
}

/**
 * Median CV per position, taken from the pool being scored.
 *
 * Computed from the board rather than hard-coded so the comparison tracks
 * whatever season the published artifact holds. A position with too few
 * readings is left out entirely, and players there simply score no floor term
 * -- an inferred median from three players would be a number, not a fact.
 */
const MIN_POSITION_SAMPLE = 8

export function positionConsistencyMedians(players: Player[]): Map<string, number> {
  const byPosition = new Map<string, number[]>()
  for (const player of players) {
    if (!player.consistency) continue
    const values = byPosition.get(player.position) ?? []
    values.push(player.consistency.cv)
    byPosition.set(player.position, values)
  }
  const medians = new Map<string, number>()
  for (const [position, values] of byPosition) {
    if (values.length < MIN_POSITION_SAMPLE) continue
    values.sort((a, b) => a - b)
    const middle = Math.floor(values.length / 2)
    medians.set(position, values.length % 2 === 0
      ? (values[middle - 1]! + values[middle]!) / 2
      : values[middle]!)
  }
  return medians
}

/**
 * How much steadier or choppier a player is than his positional median, as a
 * signed share: positive means a better floor than his peers.
 *
 * Clamped, because the tail of this distribution is thin and a player at three
 * times the median CV is usually telling you about one enormous week rather
 * than about a floor.
 */
const MAX_EDGE = 0.5

export function consistencyEdge(
  consistency: Consistency | null | undefined,
  positionMedian: number | undefined,
): number | null {
  if (!consistency || positionMedian == null || positionMedian <= 0) return null
  const edge = (positionMedian - consistency.cv) / positionMedian
  return Math.max(-MAX_EDGE, Math.min(MAX_EDGE, edge))
}
