import type { Player, SlotCounts } from '../providers/types'
import { demoteUnsigned, isUnsignedFreeAgent } from './freeAgents'

const FLEX_ELIGIBLE = ['RB', 'WR', 'TE'] as const
type FlexPosition = (typeof FLEX_ELIGIBLE)[number]

export interface ProjectedPlayer {
  id: string
  position: string
  points: number
}

/**
 * Positions you stream rather than roster, and how much of the tier an
 * attentive streamer captures.
 *
 * Replacement level is "what I can get for free", and for kicker and defense
 * that is a very different thing than it is for a running back. Only `teams`
 * of 48 kickers and 39 defenses are rostered, none of them are held for the
 * season, and the 30-plus left over are re-picked every week on matchup. So
 * the fallback is not the 13th-best kicker sitting just outside the starters
 * -- it is a fresh pick from a deep free pool, week after week, which lands
 * near the top of the tier rather than at its edge.
 *
 * Drawing their baseline the same way as a running back's said the top
 * defense was worth 27 points more than replacement, which put it 39th on the
 * whole board while the market drafts it around pick 105. That gap is not the
 * market being wrong about defenses; it is value-based drafting being handed
 * an assumption -- that you keep one all year and cannot replace him -- which
 * is false for exactly these two positions.
 *
 * Half the startable tier is the streamer's realistic capture: better than the
 * tier average, because he chases matchups out of a pool nobody else wants,
 * and short of the very best, because he cannot pick them in advance.
 */
const STREAMED_POSITIONS = new Set(['K', 'DEF'])
const STREAM_CAPTURE = 0.5

/**
 * Points a replacement-level player at each position would score.
 *
 * QB gets one dedicated baseline: the next player in line once every starting
 * slot for that position (superflex counted against QB, since it is
 * overwhelmingly spent there) is filled. K and DEF get the streaming baseline
 * described above instead.
 *
 * RB/WR/TE share the FLEX slot, so their baselines can't be computed alone --
 * a league with three dedicated WR slots and one FLEX doesn't have a fixed
 * "WR baseline rank" until you know how many flex spots RB and TE also
 * absorbed. This fills each position's dedicated starters first, then lets
 * the highest remaining RB/WR/TE value (regardless of position) claim the
 * FLEX slots, and reads the baseline off whoever was left just outside that
 * combined starter pool.
 */
export function replacementLevels(
  pool: ProjectedPlayer[],
  slots: SlotCounts,
  teams: number,
): Record<string, number> {
  const levels: Record<string, number> = {}

  const dedicatedBaseline = (position: string, extraStarters = 0) => {
    const starters = slots[position as keyof SlotCounts] * teams + extraStarters
    const ranked = pool
      .filter((p) => p.position === position)
      .sort((a, b) => b.points - a.points)
    levels[position] = ranked[starters]?.points ?? ranked[ranked.length - 1]?.points ?? 0
  }

  /**
   * Mean of the top slice of the startable tier: what you realize by streaming
   * the position all year rather than by holding the one you drafted.
   */
  const streamedBaseline = (position: string) => {
    const startable = Math.max(1, slots[position as keyof SlotCounts] * teams)
    const ranked = pool
      .filter((p) => p.position === position)
      .sort((a, b) => b.points - a.points)
    if (!ranked.length) {
      levels[position] = 0
      return
    }
    const captured = ranked.slice(0, Math.max(3, Math.round(startable * STREAM_CAPTURE)))
    levels[position] = captured.reduce((sum, p) => sum + p.points, 0) / captured.length
  }

  dedicatedBaseline('QB', slots.SUPER_FLEX * teams)
  for (const position of STREAMED_POSITIONS) streamedBaseline(position)

  const byFlexPos = new Map<FlexPosition, ProjectedPlayer[]>(
    FLEX_ELIGIBLE.map((position) => [
      position,
      pool.filter((p) => p.position === position).sort((a, b) => b.points - a.points),
    ]),
  )

  const dedicatedCount: Record<FlexPosition, number> = {
    RB: slots.RB * teams,
    WR: slots.WR * teams,
    TE: slots.TE * teams,
  }

  const usedIds = new Set<string>()
  const overflow: ProjectedPlayer[] = []
  for (const position of FLEX_ELIGIBLE) {
    const ranked = byFlexPos.get(position) ?? []
    ranked.slice(0, dedicatedCount[position]).forEach((p) => usedIds.add(p.id))
    overflow.push(...ranked.slice(dedicatedCount[position]))
  }
  overflow.sort((a, b) => b.points - a.points)

  const flexStarters = slots.FLEX * teams
  overflow.slice(0, flexStarters).forEach((p) => usedIds.add(p.id))

  for (const position of FLEX_ELIGIBLE) {
    const ranked = byFlexPos.get(position) ?? []
    const nextUp = ranked.find((p) => !usedIds.has(p.id))
    levels[position] = nextUp?.points ?? ranked[ranked.length - 1]?.points ?? 0
  }

  return levels
}

/** Value over the replacement-level player at the same position. */
export function vorp(points: number, position: string, levels: Record<string, number>): number {
  const baseline = levels[position]
  if (baseline == null) return 0
  return points - baseline
}

/** Stamps `vorp` on every player who already has a season projection. */
export function withVorp(players: Player[], slots: SlotCounts, teams: number): Player[] {
  const pool = players.filter((player): player is Player & { projectedPoints: number } => (
    player.projectedPoints != null && !isUnsignedFreeAgent(player)
  ))
  const demoted = players.map((player) => (isUnsignedFreeAgent(player) ? demoteUnsigned(player) : player))
  if (!pool.length) return demoted
  const levels = replacementLevels(
    pool.map((player) => ({ id: player.id, position: player.position, points: player.projectedPoints })),
    slots,
    teams,
  )
  return demoted.map((player) => (
    isUnsignedFreeAgent(player) || player.projectedPoints == null
      ? player
      : { ...player, vorp: vorp(player.projectedPoints, player.position, levels) }
  ))
}
