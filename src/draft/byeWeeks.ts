const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']

export interface ByeWeekRow {
  week: number
  count: number
  byPosition: Array<{ position: string; count: number }>
  /** Two or more at the same position — the stacking case recs already flag. */
  stacked: boolean
}

export interface ByeRosterPlayer {
  bye: number | null
  position: string
  starter: boolean
}

/**
 * How a candidate's bye week should move the recommendation score.
 *
 * Starters matter more than bench: three starters out the same week is a
 * lineup hole, while two RBs on one bye is worse than an RB and a WR because
 * you cannot flex around a doubled position. An unused bye is a small plus.
 */
export function scoreByeFit(options: {
  bye: number | null
  position: string
  addingStarter: boolean
  roster: Array<ByeRosterPlayer | null | undefined>
}): { delta: number; reason: string | null } {
  const { bye, position, addingStarter, roster } = options
  if (bye == null) return { delta: 0, reason: null }

  let startersOut = 0
  let samePosStarters = 0
  let totalOut = 0
  for (const player of roster) {
    if (player?.bye !== bye) continue
    totalOut += 1
    if (!player.starter) continue
    startersOut += 1
    if (player.position === position) samePosStarters += 1
  }

  if (!addingStarter) {
    if (totalOut >= 4) return { delta: -10, reason: `${totalOut + 1} on bye ${bye}` }
    return { delta: 0, reason: null }
  }

  if (samePosStarters >= 2) {
    return { delta: -25, reason: `${samePosStarters + 1} ${position}s on bye ${bye}` }
  }
  if (startersOut >= 3) {
    return { delta: -28, reason: `${startersOut + 1} starters on bye ${bye}` }
  }
  if (startersOut >= 2) {
    return { delta: -16, reason: `${startersOut + 1} starters on bye ${bye}` }
  }
  if (samePosStarters >= 1) {
    return { delta: -12, reason: `2 ${position}s on bye ${bye}` }
  }
  if (startersOut === 0 && totalOut === 0) {
    return { delta: 10, reason: `Open bye ${bye}` }
  }
  return { delta: 0, reason: null }
}

export function formatByePositions(byPosition: ByeWeekRow['byPosition']): string {
  return byPosition.map((row) => (row.count > 1 ? `${row.count} ${row.position}` : row.position)).join(' · ')
}

export function byeWeekDistribution(
  players: Array<{ bye: number | null; position: string } | null | undefined>,
): ByeWeekRow[] {
  const weeks = new Map<number, Map<string, number>>()
  for (const player of players) {
    if (player?.bye == null) continue
    const positions = weeks.get(player.bye) ?? new Map<string, number>()
    positions.set(player.position, (positions.get(player.position) ?? 0) + 1)
    weeks.set(player.bye, positions)
  }
  return [...weeks.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([week, positions]) => {
      const byPosition = [...positions.entries()]
        .sort((left, right) => {
          const leftRank = POSITION_ORDER.indexOf(left[0])
          const rightRank = POSITION_ORDER.indexOf(right[0])
          return (leftRank < 0 ? 99 : leftRank) - (rightRank < 0 ? 99 : rightRank) || right[1] - left[1]
        })
        .map(([position, count]) => ({ position, count }))
      return {
        week,
        count: byPosition.reduce((sum, row) => sum + row.count, 0),
        byPosition,
        stacked: byPosition.some((row) => row.count >= 2),
      }
    })
}
