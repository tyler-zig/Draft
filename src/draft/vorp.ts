import type { Player, SlotCounts } from '../providers/types'

const FLEX_ELIGIBLE = ['RB', 'WR', 'TE'] as const
type FlexPosition = (typeof FLEX_ELIGIBLE)[number]

export interface ProjectedPlayer {
  id: string
  position: string
  points: number
}

/**
 * Points a replacement-level player at each position would score.
 *
 * QB, K and DEF each get one dedicated baseline: the next player in line once
 * every starting slot for that position (superflex counted against QB, since
 * it is overwhelmingly spent there) is filled.
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

  dedicatedBaseline('QB', slots.SUPER_FLEX * teams)
  dedicatedBaseline('K')
  dedicatedBaseline('DEF')

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
  const pool = players.filter((player): player is Player & { projectedPoints: number } => player.projectedPoints != null)
  if (!pool.length) return players
  const levels = replacementLevels(
    pool.map((player) => ({ id: player.id, position: player.position, points: player.projectedPoints })),
    slots,
    teams,
  )
  return players.map((player) => (
    player.projectedPoints == null ? player : { ...player, vorp: vorp(player.projectedPoints, player.position, levels) }
  ))
}
