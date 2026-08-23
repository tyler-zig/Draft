import type { Player, PlayoffWeeks } from '../providers/types'
import { normalizeName, normalizePos, normalizeTeam } from '../rankings/normalize'
import type { ProjectedPointsEntry } from '../api/playerHistorical'
import {
  byeWeekFromSchedule,
  matchupScoringFor,
  playoffStrengthOfSchedule,
  type MatchupPosition,
  type ScheduleModel,
  type ScheduleWeek,
} from './calculations/matchup'

/**
 * Keys a player the way the rankings matcher does.
 *
 * This used to be a bare `fullName.toLowerCase()`, which meant ESPN's "James
 * Cook III" never met Sleeper's "James Cook" -- so a top-five back picked up no
 * Sleeper id, and with it no Sleeper rank, age, height or depth chart. The
 * rankings matcher already strips suffixes and punctuation; sharing that
 * normalizer keeps one definition of "same player" instead of two.
 */
function keyOf(player: Player) {
  const name = normalizeName(player.fullName)
  const team = normalizeTeam(player.team)
  const position = normalizePos(player.position)
  return { name, team, position }
}

export function enrichPlayersWithDirectory(players: Player[], directory: Player[]): Player[] {
  if (!directory.length) return players
  const byEspn = new Map(directory.filter((player) => player.espnId).map((player) => [player.espnId!, player]))
  const bySleeper = new Map(directory.filter((player) => player.sleeperId).map((player) => [player.sleeperId!, player]))
  const byNameTeamPos = new Map<string, Player>()
  // Name+position alone is only safe when it identifies one player. Two active
  // players can share a normalized name, and guessing between them would attach
  // the wrong profile rather than none.
  const byNamePos = new Map<string, Player | null>()

  for (const player of directory) {
    const { name, team, position } = keyOf(player)
    if (!name) continue
    if (team && position) byNameTeamPos.set(`${name}|${team}|${position}`, player)
    if (position) {
      const key = `${name}|${position}`
      byNamePos.set(key, byNamePos.has(key) ? null : player)
    }
  }

  return players.map((player) => {
    const { name, team, position } = keyOf(player)
    const profile = (player.espnId ? byEspn.get(player.espnId) : undefined)
      ?? (player.sleeperId ? bySleeper.get(player.sleeperId) : undefined)
      ?? (name && team && position ? byNameTeamPos.get(`${name}|${team}|${position}`) : undefined)
      // Falls back past the team so a player who changed teams, or whom one
      // source lists as a free agent, still finds his profile.
      ?? (name && position ? byNamePos.get(`${name}|${position}`) ?? undefined : undefined)
    if (!profile || profile === player) return player
    return {
      ...player,
      sleeperId: player.sleeperId ?? profile.sleeperId,
      espnId: player.espnId ?? profile.espnId,
      age: profile.age ?? player.age ?? null,
      height: profile.height ?? player.height ?? null,
      weight: profile.weight ?? player.weight ?? null,
      // ESPN never publishes a bye; Sleeper sometimes does. Prefer a real
      // number from either side, then let `applyScheduleByes` overwrite it
      // with the current nflverse slate when that is available.
      bye: player.bye ?? profile.bye ?? null,
      depthChartOrder: profile.depthChartOrder ?? player.depthChartOrder ?? null,
      depthChartPosition: profile.depthChartPosition ?? player.depthChartPosition ?? null,
      gsisId: profile.gsisId ?? player.gsisId,
      sportradarId: profile.sportradarId ?? player.sportradarId,
      fantasyDataId: profile.fantasyDataId ?? player.fantasyDataId,
    }
  })
}

/**
 * Stamp each player's bye from the current team schedule. The provider field
 * is often empty (ESPN always, Sleeper until it backfills `bye_week`), and
 * when it is present it can still be last year's week.
 */
export function applyScheduleByes(
  players: Player[],
  teams: Record<string, ScheduleWeek[]> | null | undefined,
): Player[] {
  if (!teams) return players
  const byes = new Map<string, number>()
  for (const [team, weeks] of Object.entries(teams)) {
    const week = byeWeekFromSchedule(weeks)
    if (week == null) continue
    byes.set(team, week)
    const normalized = normalizeTeam(team)
    if (normalized) byes.set(normalized, week)
  }
  if (!byes.size) return players
  return players.map((player) => {
    const week = (player.team ? byes.get(player.team) : undefined)
      ?? (normalizeTeam(player.team) ? byes.get(normalizeTeam(player.team)!) : undefined)
    return week == null || week === player.bye ? player : { ...player, bye: week }
  })
}

/** Positions with a matchup model; DEF is not FPA-modeled. */
const PLAYOFF_MODELED_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE'])

/**
 * Stamp each player's strength of schedule over the league's playoff weeks
 * only: average positional matchup rank of the playoff-window opponents, and
 * the league-wide ordering (1 = easiest playoff slate). Skilled positions
 * present in the pool get one shared model pass each; DEF and players with an
 * unknown team get nothing. A null model, null week window, or a team with no
 * games in the window leaves the field blank.
 */
export function attachPlayoffSos(
  players: Player[],
  model: ScheduleModel | null | undefined,
  scoring: string | null | undefined,
  weeks: PlayoffWeeks | null | undefined,
): Player[] {
  if (!model || !weeks) return players
  const positions = [...new Set(players.map((player) => player.position))]
    .filter((position): position is MatchupPosition => PLAYOFF_MODELED_POSITIONS.has(position))
  // Keyed by position|team: RB and WR slates for one team are different tables.
  const byPositionTeam = new Map<string, { averageMatchupRank: number; rank: number | null; games: number }>()
  for (const position of positions) {
    const entries = playoffStrengthOfSchedule({
      model,
      scoring: matchupScoringFor(scoring),
      position,
      weekStart: weeks.start,
      weekEnd: weeks.end,
    })
    for (const entry of entries) {
      byPositionTeam.set(`${position}|${entry.team}`, entry)
      const normalized = normalizeTeam(entry.team)
      if (normalized) byPositionTeam.set(`${position}|${normalized}`, entry)
    }
  }
  if (!byPositionTeam.size) return players
  return players.map((player) => {
    if (!player.team || !PLAYOFF_MODELED_POSITIONS.has(player.position)) return player
    const normalized = normalizeTeam(player.team)
    const entry = byPositionTeam.get(`${player.position}|${player.team}`)
      ?? (normalized ? byPositionTeam.get(`${player.position}|${normalized}`) : undefined)
    if (!entry) return player
    return {
      ...player,
      playoffSos: {
        averageMatchupRank: entry.averageMatchupRank,
        rank: entry.rank,
        games: entry.games,
      },
    }
  })
}

/** Attaches each player's Sleeper/RotoWire season projection (or historical points pool) by id. */
export function attachProjectedPoints(players: Player[], pool: ProjectedPointsEntry[]): Player[] {
  if (!pool.length) return players
  const byGsis = new Map(pool.filter((e) => e.gsisId).map((e) => [e.gsisId!, e]))
  const byEspn = new Map(pool.filter((e) => e.espnId).map((e) => [e.espnId!, e]))
  const bySleeper = new Map(pool.filter((e) => e.sleeperId).map((e) => [e.sleeperId!, e]))
  const byNamePos = new Map<string, ProjectedPointsEntry | null>()
  for (const entry of pool) {
    const name = normalizeName(entry.name)
    const position = normalizePos(entry.position)
    if (!name || !position) continue
    const key = `${name}|${position}`
    byNamePos.set(key, byNamePos.has(key) ? null : entry)
  }

  return players.map((player) => {
    const entry =
      (player.gsisId ? byGsis.get(player.gsisId) : undefined) ??
      (player.espnId ? byEspn.get(player.espnId) : undefined) ??
      (player.sleeperId ? bySleeper.get(player.sleeperId) : undefined) ??
      bySleeper.get(player.id) ??
      byNamePos.get(`${normalizeName(player.fullName)}|${normalizePos(player.position)}`) ??
      undefined
    if (!entry) return player
    return { ...player, projectedPoints: entry.points, projectionBreakdown: entry.breakdown }
  })
}
