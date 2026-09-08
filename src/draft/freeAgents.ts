import type { Player } from '../providers/types'

/**
 * ESPN writes `FA`; projection dumps write `FREE` / `Free Agent`. After
 * punctuation is stripped those all collapse to one of these tokens.
 */
const UNSIGNED_TEAM_CODES = new Set(['FA', 'FA*', 'FREE', 'FREEAGENT', 'NONE', 'NA'])

/**
 * Skill players with no NFL club. Two days before kickoff that is not a
 * missing field -- they have no snaps to score. Defenses use the team
 * abbreviation as their id and are not free agents.
 */
export function isUnsignedFreeAgent(player: Pick<Player, 'team' | 'position'>): boolean {
  if (player.position === 'DEF') return false
  const raw = player.team?.trim()
  if (!raw) return true
  const compact = raw.toUpperCase().replace(/[\s._/-]/g, '')
  return UNSIGNED_TEAM_CODES.has(compact)
}

/** Same sentinel the table and recs already treat as unranked ("—"). */
export const UNSIGNED_RANK = 9999

/** @deprecated Use UNSIGNED_RANK. Unsigned players are undraftable, not late-round. */
export const UNSIGNED_RANK_FLOOR = UNSIGNED_RANK

/** Strip leftover market so summer ADP / VORP cannot float an unsigned name. */
export function demoteUnsigned(player: Player): Player {
  return {
    ...player,
    vorp: null,
    projectedPoints: null,
    projectionBreakdown: undefined,
    adp: null,
    liveAdp: null,
    liveAdpLastOne: null,
    liveAdpLastSeven: null,
    liveAdpVsLastOne: null,
    liveAdpVsLastSeven: null,
    searchRank: UNSIGNED_RANK,
  }
}
