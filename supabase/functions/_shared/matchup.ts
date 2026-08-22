export type MatchupScoring = 'ppr' | 'half' | 'standard'
export type MatchupPosition = 'QB' | 'RB' | 'WR' | 'TE' | 'K'

export const MATCHUP_SCORINGS: MatchupScoring[] = ['ppr', 'half', 'standard']
export const MATCHUP_POSITIONS: MatchupPosition[] = ['QB', 'RB', 'WR', 'TE', 'K']
export const MATCHUP_MIN_SAMPLE = 4

const TEAM_ALIASES: Record<string, string> = {
  JAC: 'JAX', WAS: 'WSH', WSH: 'WSH', WASHINGTON: 'WSH', LAR: 'LAR', LA: 'LAR', STL: 'LAR', SD: 'LAC', LAC: 'LAC', OAK: 'LV', LV: 'LV', DST: '', DEF: '',
}

export function normalizeTeam(value: string | null | undefined): string | null {
  if (!value) return null
  const team = value.toUpperCase().trim()
  return TEAM_ALIASES[team] ?? team
}

export function normalizePos(value: string | null | undefined): string | null {
  if (!value) return null
  const position = value.toUpperCase().trim()
  if (position === 'DST' || position === 'D/ST' || position === 'DEF') return 'DEF'
  if (position === 'PK') return 'K'
  return position
}

export interface ScheduleGame {
  season: number
  week: number
  gameType: string
  homeTeam: string
  awayTeam: string
  completed: boolean
}

export interface ScheduleWeek {
  week: number
  opponent: string | null
  home: boolean
  bye: boolean
  completed: boolean
}

export interface FpaObservation {
  season: number
  week: number
  defense: string
  position: string
  standard: number
  ppr: number
}

export interface MatchupWindow {
  priorSeason: number | null
  currentSeason: number
  currentGames: number
  priorWeight: number
  currentWeight: number
  minSample: number
}

export interface DefenseMatchup {
  team: string
  rank: number
  pointsAllowed: number
  games: number
}

export interface TeamStrengthOfSchedule {
  team: string
  rank: number
  averageMatchupRank: number
  remainingGames: number
}

export interface ScheduleModel {
  season: number
  source: string
  updatedAt: string
  teams: Record<string, ScheduleWeek[]>
  window: MatchupWindow
  matchups: Record<MatchupScoring, Record<string, Record<string, DefenseMatchup>>>
  strengthOfSchedule: Record<MatchupScoring, Record<string, Record<string, TeamStrengthOfSchedule>>>
}

export interface PlayerScheduleWeek extends ScheduleWeek {
  matchupRank: number | null
  pointsAllowed: number | null
}

export interface PlayerScheduleView {
  season: number
  team: string
  position: string
  scoring: MatchupScoring
  weeks: PlayerScheduleWeek[]
  upcoming: PlayerScheduleWeek[]
  strengthOfSchedule: TeamStrengthOfSchedule | null
  window: MatchupWindow
  methodology: string
  message: string | null
}

export const MATCHUP_METHODOLOGY = {
  matchupStrength: 'positional fantasy points allowed per game; 1 = easiest; current season blended with the prior season until 4 defense games exist; PPR/half/standard use the same scoring as the page',
  strengthOfSchedule: 'remaining regular-season opponents ranked by average positional matchup rank; 1 = easiest remaining slate; byes and completed games excluded',
}

export function matchupScoringFor(scoring: string | null | undefined): MatchupScoring {
  if (scoring === 'half_ppr' || scoring === 'half') return 'half'
  if (scoring === 'std' || scoring === 'standard') return 'standard'
  return 'ppr'
}

export function pointsForScoring(standard: number, ppr: number, scoring: MatchupScoring) {
  if (scoring === 'ppr') return ppr
  if (scoring === 'half') return standard + (ppr - standard) / 2
  return standard
}

export function blendWeights(currentGames: number, minSample = MATCHUP_MIN_SAMPLE) {
  const currentWeight = Math.min(1, Math.max(0, currentGames / minSample))
  return { priorWeight: 1 - currentWeight, currentWeight }
}

export function matchupTone(rank: number | null | undefined) {
  if (rank == null) return 'neutral'
  if (rank <= 8) return 'easy'
  if (rank <= 16) return 'neutral'
  if (rank <= 24) return 'tough'
  return 'hard'
}

export function ordinal(value: number) {
  const remainder = value % 100
  if (remainder >= 11 && remainder <= 13) return `${value}th`
  return `${value}${['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'}`
}

/** True when this team-week is the bye, including older artifacts that omitted `bye`. */
export function isByeWeek(week: { bye?: boolean; opponent?: string | null }) {
  return week.bye === true || (week.bye !== false && !week.opponent)
}

/**
 * The team's regular-season bye week. Returns null when the slate has no bye
 * or more than one gap -- multiple gaps mean the schedule is incomplete, not
 * that the team has several byes.
 */
export function byeWeekFromSchedule(weeks: Array<{ week: number; bye?: boolean; opponent?: string | null }> | null | undefined): number | null {
  const byes = (weeks ?? []).filter(isByeWeek)
  return byes.length === 1 ? byes[0]!.week : null
}

export function buildTeamSchedules(games: ScheduleGame[], season: number) {
  const regular = games.filter((game) => game.season === season && game.gameType === 'REG')
  const byTeamWeek = new Map<string, ScheduleWeek>()
  const teams = new Set<string>()
  for (const game of regular) {
    const home = normalizeTeam(game.homeTeam)
    const away = normalizeTeam(game.awayTeam)
    if (!home || !away) continue
    teams.add(home)
    teams.add(away)
    byTeamWeek.set(`${home}|${game.week}`, { week: game.week, opponent: away, home: true, bye: false, completed: game.completed })
    byTeamWeek.set(`${away}|${game.week}`, { week: game.week, opponent: home, home: false, bye: false, completed: game.completed })
  }
  const maxWeek = regular.reduce((max, game) => Math.max(max, game.week), 0)
  const schedules: Record<string, ScheduleWeek[]> = {}
  for (const team of [...teams].sort()) {
    const weeks: ScheduleWeek[] = []
    for (let week = 1; week <= maxWeek; week += 1) {
      weeks.push(byTeamWeek.get(`${team}|${week}`) ?? { week, opponent: null, home: false, bye: true, completed: false })
    }
    schedules[team] = weeks
  }
  return schedules
}

export function observationsFromPlayers(players: Array<{
  position: string
  seasons: Array<{
    season: number
    weekly: Array<{ week: number; opponent: string; fantasyPoints: number; fantasyPointsPpr: number }>
  }>
}>) {
  const observations: FpaObservation[] = []
  for (const player of players) {
    const position = normalizePos(player.position)
    if (!position || !MATCHUP_POSITIONS.includes(position as MatchupPosition)) continue
    for (const season of player.seasons) {
      for (const week of season.weekly) {
        const defense = normalizeTeam(week.opponent)
        if (!defense) continue
        observations.push({
          season: season.season,
          week: week.week,
          defense,
          position,
          standard: week.fantasyPoints,
          ppr: week.fantasyPointsPpr,
        })
      }
    }
  }
  return observations
}

function seasonPositionTotals(observations: FpaObservation[], scoring: MatchupScoring) {
  const games = new Map<string, number>()
  for (const row of observations) {
    const key = `${row.season}|${row.defense}|${row.position}|${row.week}`
    games.set(key, (games.get(key) ?? 0) + pointsForScoring(row.standard, row.ppr, scoring))
  }
  const totals = new Map<string, { points: number; games: number }>()
  for (const [key, points] of games) {
    const [season, defense, position] = key.split('|')
    const group = `${season}|${defense}|${position}`
    const current = totals.get(group) ?? { points: 0, games: 0 }
    current.points += points
    current.games += 1
    totals.set(group, current)
  }
  return totals
}

export function rankDefenses(entries: Array<{ team: string; pointsAllowed: number; games: number }>) {
  return [...entries]
    .sort((left, right) => right.pointsAllowed - left.pointsAllowed || left.team.localeCompare(right.team))
    .map((entry, index) => ({ ...entry, rank: index + 1 }))
}

export function calculateMatchupModel(input: {
  observations: FpaObservation[]
  schedules: Record<string, ScheduleWeek[]>
  currentSeason: number
  minSample?: number
  source?: string
  updatedAt?: string
}): ScheduleModel {
  const minSample = input.minSample ?? MATCHUP_MIN_SAMPLE
  const teams = Object.keys(input.schedules).sort()
  const availablePrior = [...new Set(input.observations.map((row) => row.season).filter((season) => season < input.currentSeason))].sort((left, right) => left - right)
  const priorSeason = availablePrior.at(-1) ?? null
  const currentGames = teams.reduce((max, team) => Math.max(max, input.schedules[team]?.filter((week) => week.completed && !week.bye).length ?? 0), 0)
  const leagueWeights = blendWeights(currentGames, minSample)
  const window: MatchupWindow = {
    priorSeason,
    currentSeason: input.currentSeason,
    currentGames,
    priorWeight: leagueWeights.priorWeight,
    currentWeight: leagueWeights.currentWeight,
    minSample,
  }

  const matchups = {} as ScheduleModel['matchups']
  const strengthOfSchedule = {} as ScheduleModel['strengthOfSchedule']

  for (const scoring of MATCHUP_SCORINGS) {
    const totals = seasonPositionTotals(input.observations, scoring)
    matchups[scoring] = {}
    strengthOfSchedule[scoring] = {}
    for (const position of MATCHUP_POSITIONS) {
      const blended = teams.map((team) => {
        const current = totals.get(`${input.currentSeason}|${team}|${position}`)
        const prior = priorSeason == null ? undefined : totals.get(`${priorSeason}|${team}|${position}`)
        const weights = blendWeights(current?.games ?? 0, minSample)
        const currentPpg = current && current.games ? current.points / current.games : null
        const priorPpg = prior && prior.games ? prior.points / prior.games : null
        const pointsAllowed = currentPpg == null && priorPpg == null
          ? 0
          : currentPpg == null
            ? priorPpg ?? 0
            : priorPpg == null
              ? currentPpg
              : weights.priorWeight * priorPpg + weights.currentWeight * currentPpg
        return { team, pointsAllowed, games: (current?.games ?? 0) + (prior?.games ?? 0) }
      })
      const ranked = rankDefenses(blended)
      matchups[scoring][position] = Object.fromEntries(ranked.map((entry) => [entry.team, entry]))

      const sos = teams.map((team) => {
        const remaining = (input.schedules[team] ?? []).filter((week) => !week.bye && !week.completed && week.opponent)
        const ranks = remaining.flatMap((week) => {
          const rank = matchups[scoring][position]?.[week.opponent!]?.rank
          return rank == null ? [] : [rank]
        })
        const averageMatchupRank = ranks.length ? ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length : 0
        return { team, averageMatchupRank, remainingGames: remaining.length }
      })
      const rankedSos = [...sos]
        .sort((left, right) => left.averageMatchupRank - right.averageMatchupRank || left.team.localeCompare(right.team))
        .map((entry, index) => ({ ...entry, rank: entry.remainingGames ? index + 1 : teams.length }))
      strengthOfSchedule[scoring][position] = Object.fromEntries(rankedSos.map((entry) => [entry.team, entry]))
    }
  }

  return {
    season: input.currentSeason,
    source: input.source ?? 'Data: nflverse schedules (CC-BY-4.0)',
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    teams: input.schedules,
    window,
    matchups,
    strengthOfSchedule,
  }
}

export interface PlayoffStrengthOfSchedule {
  team: string
  /** Average positional matchup rank of the playoff-window opponents. */
  averageMatchupRank: number
  /** Playoff-window games the team plays, byes and completed games excluded. */
  games: number
  /** League-wide ordering, 1 = easiest playoff slate; null with no games in the window. */
  rank: number | null
}

/**
 * Strength of schedule over a fixed week window (the league's playoffs),
 * ranked like the regular-season sos: ascending average matchup rank, 1 =
 * easiest slate. Byes and already-completed games do not count toward the
 * window, so a team whose bye falls inside it plays fewer playoff games.
 */
export function playoffStrengthOfSchedule(input: {
  model: ScheduleModel
  scoring: MatchupScoring
  position: MatchupPosition
  weekStart: number
  weekEnd: number
}): PlayoffStrengthOfSchedule[] {
  const { model, scoring, position, weekStart, weekEnd } = input
  const matchups = model.matchups[scoring]?.[position]
  const teams = Object.keys(model.teams).sort()
  const entries = teams.map((team) => {
    const weeks = (model.teams[team] ?? []).filter((week) => (
      !week.bye && !week.completed && week.opponent
      && week.week >= weekStart && week.week <= weekEnd
    ))
    const ranks = weeks.flatMap((week) => {
      const rank = matchups?.[week.opponent!]?.rank
      return rank == null ? [] : [rank]
    })
    return {
      team,
      games: weeks.length,
      averageMatchupRank: ranks.length ? ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length : 0,
      rank: null as number | null,
    }
  })
  // Ranks only count teams that actually play in the window -- a team with no
  // playoff games must not displace real slates.
  const sorted = [...entries].sort(
    (left, right) => left.averageMatchupRank - right.averageMatchupRank || left.team.localeCompare(right.team),
  )
  let rank = 1
  for (const entry of sorted) {
    if (entry.games) entry.rank = rank++
  }
  return sorted
}

export function resolvePlayerSchedule(input: {
  team: string | null | undefined
  position: string
  scoring: MatchupScoring
  model: ScheduleModel | null | undefined
}): PlayerScheduleView | null {
  if (!input.model) return null
  const team = normalizeTeam(input.team)
  const position = normalizePos(input.position) ?? input.position
  if (!team) {
    return {
      season: input.model.season,
      team: '',
      position,
      scoring: input.scoring,
      weeks: [],
      upcoming: [],
      strengthOfSchedule: null,
      window: input.model.window,
      methodology: MATCHUP_METHODOLOGY.matchupStrength,
      message: 'This player has no current team, so no schedule is available.',
    }
  }
  const weeks = (input.model.teams[team] ?? []).map((week) => {
    const defense = week.opponent ? input.model!.matchups[input.scoring]?.[position]?.[week.opponent] : undefined
    return {
      ...week,
      matchupRank: week.bye ? null : defense?.rank ?? null,
      pointsAllowed: week.bye ? null : defense?.pointsAllowed ?? null,
    }
  })
  if (!weeks.length) {
    return {
      season: input.model.season,
      team,
      position,
      scoring: input.scoring,
      weeks: [],
      upcoming: [],
      strengthOfSchedule: null,
      window: input.model.window,
      methodology: MATCHUP_METHODOLOGY.matchupStrength,
      message: `No ${input.model.season} regular-season schedule is stored for ${team}.`,
    }
  }
  return {
    season: input.model.season,
    team,
    position,
    scoring: input.scoring,
    weeks,
    upcoming: weeks.filter((week) => !week.completed).slice(0, 4),
    strengthOfSchedule: input.model.strengthOfSchedule[input.scoring]?.[position]?.[team] ?? null,
    window: input.model.window,
    methodology: MATCHUP_METHODOLOGY.matchupStrength,
    message: MATCHUP_POSITIONS.includes(position as MatchupPosition) ? null : 'Matchup ranks are not modeled for this position.',
  }
}
