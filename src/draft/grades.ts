import type { DraftPick, Player, SlotCounts } from '../providers/types'
import { marketBaseline } from './playerContext'
import { fillRoster } from './rosterNeeds'

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F'

export interface LineupProjection {
  /** Sum of projected points across non-bench starting slots. */
  points: number
  /** Starting slots filled by a player with a projection. */
  covered: number
  /** Starting slots filled by any player, projected or not. */
  starters: number
}

/**
 * Project a roster into its starting lineup and total the projected points.
 *
 * `fillRoster` is greedy -- QB/RB/WR/TE/K/DEF fill before FLEX, so a
 * best-ball flex always picks the highest-projection eligible player. Kickers
 * and defenses frequently have no projection row; they still occupy a slot
 * (`starters`) but add nothing to `points` (`covered` tracks the gap).
 */
export function projectedLineupPoints(
  rosterPlayers: Player[],
  slots: SlotCounts,
): LineupProjection {
  const filled = fillRoster(slots, rosterPlayers)
  const starting = filled.filter((slot) => slot.key !== 'BN' && slot.player)
  const points = starting.reduce(
    (sum, slot) => sum + (slot.player?.projectedPoints ?? 0),
    0,
  )
  const covered = starting.filter((slot) => slot.player?.projectedPoints != null).length
  return { points, covered, starters: starting.length }
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
  /** Picks with no ADP/rank to value against. */
  unvaluedPicks: number
  /** Value tally in standard deviations above the room mean. */
  z: number | null
  grade: Grade | null
}

export function gradeFromZ(z: number): Grade {
  if (z >= 1) return 'A'
  if (z >= 0.3) return 'B'
  if (z >= -0.3) return 'C'
  if (z >= -1) return 'D'
  return 'F'
}

const MIN_GRADED_TEAMS = 4

/**
 * Every team's draft so far: projected starting-lineup points and a
 * value-over-market tally per pick. Grades (z-scores) only mean something
 * against a room of peers, so they appear once enough teams have a pick.
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

  if (grades.length >= MIN_GRADED_TEAMS) {
    const mean = grades.reduce((sum, g) => sum + g.valueTally, 0) / grades.length
    const variance =
      grades.reduce((sum, g) => sum + (g.valueTally - mean) ** 2, 0) / grades.length
    const stdDev = Math.sqrt(variance)
    for (const g of grades) {
      g.z = stdDev === 0 ? 0 : (g.valueTally - mean) / stdDev
      g.grade = gradeFromZ(g.z)
    }
  }

  return grades
}
