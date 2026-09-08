import type { Player } from '../providers/types'
import { consistencyEdge } from './consistency'
import { injuryTone } from './injuryStatus'

/**
 * Probability an average team is still alive in a given week.
 *
 * One team is chopped per week, so a league of `teams` runs `teams - 1` weeks
 * and an average team's odds of seeing week `w` are `(teams - w + 1) / teams`:
 * certain in week 1, even money around the halfway mark, and one-in-`teams` at
 * the end.
 *
 * This is what every week-specific term below is weighted by, and it replaces
 * a hard week-7 cutoff that had been standing in for it. The cutoff priced 10
 * of 32 teams' bye weeks and treated the other 22 as free -- in an 18-team
 * league that runs into November, a week-11 bye is a real elimination risk
 * being scored at zero. Decaying weight says the true thing the cutoff was
 * reaching for: later weeks matter less because you may not get there, not
 * because nothing happens in them.
 */
export function survivalWeight(week: number, teams: number): number {
  if (!Number.isFinite(week) || week < 1) return 0
  const field = Math.max(2, teams)
  return Math.max(0, Math.min(1, (field - week + 1) / field))
}

/**
 * Weeks the strength-of-schedule window should cover: through the week an
 * average team is more likely than not to be eliminated. Scales with the
 * league for the same reason the bye weighting does -- a fixed four-week
 * window describes a much smaller share of an 18-team league's season than of
 * a 10-team one.
 */
export function choppedSosWeeks(teams: number): { start: number; end: number } {
  return { start: 1, end: Math.max(4, Math.ceil(Math.max(2, teams) / 2)) }
}

/** Retained for callers that want the old fixed early-season window. */
export const CHOPPED_EARLY_WEEKS = { start: 1, end: 4 } as const

/** Hold QB until after this many rounds, when nothing prices replacement level for us. */
export const CHOPPED_QB_WAIT_ROUNDS = 5

export interface ChoppedTerm {
  label: string
  delta: number
  reason: string | null
}

/**
 * Need should bite earlier than in H2H. A hole in week 1 is an elimination
 * risk, so empty starters are not something you "have time" to fill.
 */
export function choppedNeedScale(openStarters: number, picksLeft: number): number {
  return Math.min(1, openStarters / Math.max(1, picksLeft * 0.55))
}

/**
 * Every tilt below is a share of the player's own base value, not a flat point
 * total.
 *
 * The flat version had the failure this engine already documents for its need
 * bonuses: a -18 rookie penalty is four percent of a first-round back and
 * fatal to a last-round flier, so the same stated judgment landed as two
 * completely different ones depending on where in the draft it fired.
 */
const SHARE = {
  waitOnQb: 0.14,
  rookie: 0.06,
  floor: 0.10,
  injuryOut: 0.16,
  injuryWarn: 0.09,
  stackedBye: 0.10,
  sos: 0.05,
} as const

function term(label: string, delta: number, reason: string | null = label): ChoppedTerm {
  return { label, delta, reason }
}

/**
 * Last-man-standing tilts that season VORP does not know about.
 *
 * Survive the early chops: a steady weekly floor, filled starters, no stacked
 * bye, no week-1 injury. Ceiling and playoff schedule are H2H tools and stay
 * out.
 */
export function choppedTerms(options: {
  player: Player
  horizonPickNo: number
  teams: number
  yourPlayers: Player[]
  /** The player's score before these tilts, so each one scales with him. */
  baseValue: number
  /** Median weekly-scoring CV per position, from the pool being scored. */
  consistencyMedians?: Map<string, number>
}): ChoppedTerm[] {
  const { player, horizonPickNo, teams, yourPlayers, baseValue, consistencyMedians } = options
  if (!(baseValue > 0)) return []
  const terms: ChoppedTerm[] = []
  const share = (fraction: number) => -fraction * baseValue

  /**
   * Wait on QB only when nothing else has priced replacement level.
   *
   * `vorp` is already value over the QB12 baseline, which is the entire reason
   * a quarterback is not worth an early pick -- on the current board that is
   * the difference between the top QB at 175 and the top RB at 405. Charging
   * a further flat penalty billed the same fact twice. It still applies on the
   * rank fallback, where the base score is rank arithmetic and knows nothing
   * about replacement level at all.
   */
  if (player.position === 'QB' && player.vorp == null
    && horizonPickNo <= Math.max(1, teams) * CHOPPED_QB_WAIT_ROUNDS) {
    terms.push(term('Wait on QB', share(SHARE.waitOnQb)))
  }

  if (player.yearsExp === 0) {
    terms.push(term('Rookie volatility', share(SHARE.rookie)))
  }

  // Weekly scoring spread against his positional peers -- the floor measure a
  // survival format actually turns on. See `consistency.ts` for why this
  // replaced the expert-rank spread that used to stand in for it.
  const edge = consistencyEdge(player.consistency, consistencyMedians?.get(player.position))
  if (edge != null && Math.abs(edge) >= 0.08) {
    terms.push(edge > 0
      ? term('Steady week to week', edge * SHARE.floor * baseValue, 'Steady week to week')
      : term('Boom-or-bust weeks', edge * SHARE.floor * baseValue, 'Boom-or-bust weeks'))
  }

  const injury = injuryTone(player.injuryStatus)
  if (injury === 'out' && player.injuryStatus) {
    terms.push(term('Week-1 injury risk', share(SHARE.injuryOut), player.injuryStatus))
  } else if (injury === 'warn' && player.injuryStatus) {
    terms.push(term('Week-1 injury risk', share(SHARE.injuryWarn), player.injuryStatus))
  }

  /**
   * Stacked byes, weighted by how likely you are to still be playing that week.
   *
   * One player on a bye is a bench start; the second is a hole in the lineup
   * in a format where one bad week ends you, and each one after that is worse.
   * This is also the only bye term now: a separate penalty for sharing a bye
   * with your own QB stack used to fire alongside this one, charging twice for
   * the single fact that two of your starters are off in the same week.
   */
  const bye = player.bye
  if (bye != null) {
    const alreadyOnBye = yourPlayers.filter((owned) => owned.bye === bye).length
    const weight = survivalWeight(bye, teams)
    if (alreadyOnBye >= 1 && weight > 0) {
      terms.push(term(
        `Stacked bye week ${bye}`,
        share(SHARE.stackedBye * alreadyOnBye * weight),
        `${alreadyOnBye + 1} starters on bye week ${bye}`,
      ))
    }
  }

  const sosRank = player.playoffSos?.rank
  if (sosRank != null && sosRank > 0) {
    if (sosRank <= 8) terms.push(term('Easy early schedule', -share(SHARE.sos)))
    else if (sosRank >= 22) terms.push(term('Tough early schedule', share(SHARE.sos)))
  }

  return terms
}
