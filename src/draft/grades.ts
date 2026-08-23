import type { DraftPick, Player, SlotCounts } from '../providers/types'
import { marketBaseline } from './playerContext'
import { fillRoster, type FilledSlot } from './rosterNeeds'

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F'

export const MIN_GRADED_TEAMS = 4
export const MIN_PICKS_PER_TEAM = 3
export const LINEUP_WEIGHT = 0.7
export const VALUE_WEIGHT = 0.3

export interface LineupProjection {
  /** Sum of projected points across non-bench starting slots. */
  points: number
  /** Starting slots filled by a player with a projection. */
  covered: number
  /** Starting slots filled by any player, projected or not. */
  starters: number
  /** Every non-bench slot, empty ones included so holes stay visible. */
  seats: FilledSlot[]
}

/**
 * Project a roster into its starting lineup and total the projected points.
 *
 * Players are seated highest-projection first, then `fillRoster` fills
 * QB/RB/WR/TE/K/DEF before FLEX, so the flex is the best leftover eligible
 * player. Kickers and defenses frequently have no projection row; they still
 * occupy a slot (`starters`) but add nothing to `points` (`covered` tracks
 * the gap).
 */
export function projectedLineupPoints(
  rosterPlayers: Player[],
  slots: SlotCounts,
): LineupProjection {
  const ranked = [...rosterPlayers].sort((left, right) => {
    return (right.projectedPoints ?? Number.NEGATIVE_INFINITY)
      - (left.projectedPoints ?? Number.NEGATIVE_INFINITY)
  })
  const filled = fillRoster(slots, ranked)
  const seats = filled.filter((slot) => slot.key !== 'BN')
  const starting = seats.filter((slot) => slot.player)
  const points = starting.reduce(
    (sum, slot) => sum + (slot.player?.projectedPoints ?? 0),
    0,
  )
  const covered = starting.filter((slot) => slot.player?.projectedPoints != null).length
  return { points, covered, starters: starting.length, seats }
}

export interface TeamGrade {
  slot: number
  teamName: string
  picks: DraftPick[]
  lineup: LineupProjection
  /**
   * Σ (pickNo − market value) over valued picks: positive means the team
   * landed its players later than the market says they should go. Off-snake
   * keepers (pickNo <= 0) are skipped -- they never ran through the draft.
   */
  valueTally: number
  /** Picks with no ADP to value against. */
  unvaluedPicks: number
  /** Blended z: 70% lineup points, 30% ADP value, vs the room. */
  z: number | null
  grade: Grade | null
}

export function gradeFromZ(z: number): Grade {
  if (z >= 1) return 'A'
  if (z >= 0.5) return 'B'
  if (z >= -0.6) return 'C'
  if (z >= -1.5) return 'D'
  return 'F'
}

function zScores(values: number[]): number[] {
  const n = values.length
  if (n === 0) return []
  const mean = values.reduce((sum, value) => sum + value, 0) / n
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n
  const stdDev = Math.sqrt(variance)
  if (stdDev === 0) return values.map(() => 0)
  return values.map((value) => (value - mean) / stdDev)
}

/**
 * Every team's draft so far: projected starting-lineup points and a
 * value-over-market tally per pick. The letter is a room-relative blend of
 * those two, and only appears once enough teams have a real sample.
 */
export function leagueProjections(options: {
  picks: DraftPick[]
  playersById: Map<string, Player>
  teams: number
  slots: SlotCounts
  teamNameBySlot?: Map<number, string>
}): TeamGrade[] {
  const { picks, playersById, teams, slots, teamNameBySlot } = options

  const bySlot = new Map<number, DraftPick[]>()
  for (const pick of picks) {
    const list = bySlot.get(pick.draftSlot)
    if (list) list.push(pick)
    else bySlot.set(pick.draftSlot, [pick])
  }

  const grades: TeamGrade[] = []
  for (let slot = 1; slot <= teams; slot += 1) {
    const slotPicks = bySlot.get(slot)
    if (!slotPicks || slotPicks.length === 0) continue

    const roster = slotPicks
      .map((pick) => playersById.get(pick.playerId))
      .filter((player): player is Player => Boolean(player))

    let valueTally = 0
    let unvaluedPicks = 0
    for (const pick of slotPicks) {
      if (pick.pickNo <= 0) continue
      const player = playersById.get(pick.playerId)
      const baseline = player ? marketBaseline(player) : null
      if (baseline) valueTally += pick.pickNo - baseline.value
      else unvaluedPicks += 1
    }

    grades.push({
      slot,
      teamName: teamNameBySlot?.get(slot) ?? `Slot ${slot}`,
      picks: slotPicks,
      lineup: projectedLineupPoints(roster, slots),
      valueTally,
      unvaluedPicks,
      z: null,
      grade: null,
    })
  }

  const eligible = grades.filter((grade) => grade.picks.length >= MIN_PICKS_PER_TEAM)
  if (eligible.length >= MIN_GRADED_TEAMS) {
    const zPoints = zScores(eligible.map((grade) => grade.lineup.points))
    const zValue = zScores(eligible.map((grade) => grade.valueTally))
    eligible.forEach((grade, index) => {
      grade.z = LINEUP_WEIGHT * (zPoints[index] ?? 0) + VALUE_WEIGHT * (zValue[index] ?? 0)
      grade.grade = gradeFromZ(grade.z)
    })
  }

  return grades
}
