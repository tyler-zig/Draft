import type { Player } from '../providers/types'
import { normalizeTeam } from '../rankings/normalize'
import { injuryTone } from './injuryStatus'

/** Weeks 1–4: survive the first chops before FAAB restocks the board. */
export const CHOPPED_EARLY_WEEKS = { start: 1, end: 4 } as const

/** Bye weeks that can end you before the waiver market is deep. */
export const CHOPPED_EARLY_BYE = 7

/** Hold QB until after this many rounds; volume skill players keep you alive. */
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

function term(label: string, delta: number, reason: string | null = label): ChoppedTerm {
  return { label, delta, reason }
}

/**
 * Last-man-standing tilts that season VORP does not know about.
 *
 * Survive the first month: high-floor volume, filled starters, no early-bye
 * stacks, no Week-1 injury, and a QB you can wait on. Ceiling, stacks, and
 * playoff SoS are H2H tools and stay out.
 */
export function choppedTerms(options: {
  player: Player
  horizonPickNo: number
  teams: number
  yourPlayers: Player[]
}): ChoppedTerm[] {
  const { player, horizonPickNo, teams, yourPlayers } = options
  const terms: ChoppedTerm[] = []
  const earlyRounds = Math.max(1, teams) * CHOPPED_QB_WAIT_ROUNDS

  if (player.position === 'QB' && horizonPickNo <= earlyRounds) {
    terms.push(term('Wait on QB', -32))
  }

  if (player.yearsExp === 0) {
    terms.push(term('Rookie volatility', -18))
  }

  const stdev = player.rankStdDev
  if (stdev != null && stdev >= 10) {
    terms.push(term('Volatile rank', -16))
  } else if (stdev != null && stdev > 0 && stdev <= 3) {
    terms.push(term('High-floor consensus', 10))
  }

  const injury = injuryTone(player.injuryStatus)
  if (injury === 'out' && player.injuryStatus) {
    terms.push(term('Week-1 injury risk', -30, player.injuryStatus))
  } else if (injury === 'warn' && player.injuryStatus) {
    terms.push(term('Week-1 injury risk', -18, player.injuryStatus))
  }

  const bye = player.bye
  if (bye != null && bye <= CHOPPED_EARLY_BYE) {
    const alreadyOnBye = yourPlayers.filter((owned) => owned.bye === bye).length
    if (alreadyOnBye >= 1) {
      terms.push(term(`Early bye week ${bye}`, -14))
    }
  }

  const playerTeam = normalizeTeam(player.team)
  if (playerTeam) {
    const stackMate = yourPlayers.find((owned) => normalizeTeam(owned.team) === playerTeam && (
      (player.position === 'QB' && (owned.position === 'WR' || owned.position === 'TE'))
      || ((player.position === 'WR' || player.position === 'TE') && owned.position === 'QB')
    ))
    if (stackMate && (player.bye ?? 99) <= CHOPPED_EARLY_BYE && (stackMate.bye ?? 99) <= CHOPPED_EARLY_BYE && player.bye === stackMate.bye) {
      terms.push(term(`Shared early bye with ${stackMate.fullName}`, -20))
    }
  }

  const sosRank = player.playoffSos?.rank
  if (sosRank != null && sosRank > 0) {
    if (sosRank <= 8) terms.push(term('Easy weeks 1–4', 12))
    else if (sosRank >= 22) terms.push(term('Tough weeks 1–4', -12))
  }

  return terms
}
