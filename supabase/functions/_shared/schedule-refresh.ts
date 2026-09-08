import {
  MATCHUP_METHODOLOGY,
  MATCHUP_POSITIONS,
  buildTeamSchedules,
  calculateMatchupModel,
  normalizePos,
  normalizeTeam,
  observationsFromPlayers,
  type FpaObservation,
  type MatchupPosition,
  type ScheduleGame,
  type ScheduleModel,
} from './matchup.ts'

export const SCHEDULE_SOURCE = 'Data: nflverse schedules (CC-BY-4.0)'
export const SCHEDULE_URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv'
export const weeklyStatsUrl = (season: number) => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`

export interface PublishedIntelligence {
  schemaVersion: number
  generatedAt: string
  seasons?: number[]
  attribution?: string
  methodology?: Record<string, string>
  sources?: unknown[]
  players: Array<{
    // Identity is declared even though the schedule refresh does not read it:
    // the same records are sharded by id straight after this runs, and the
    // sync validates that every record carries a gsis id and a name.
    ids: { gsis: string; espn: string | null; sleeper: string | null; pfr: string | null }
    name: string
    position: string
    seasons: Array<{
      season: number
      // Declared but not read here, for the same reason identity is: these
      // records go straight to `buildPlayerShards`, which lifts the recent
      // games-missed window into the shard index. Leaving them off the type
      // let a refresh republish an index with the durability silently
      // dropped, which reads downstream as a clean injury record.
      gamesPlayed?: number
      durability?: { gamesMissed?: number } | null
      weekly: Array<{ week: number; opponent: string; fantasyPoints: number; fantasyPointsPpr: number }>
    }>
  }>
  summary?: Record<string, number>
  schedule?: unknown
  matchups?: unknown
}

export function parseCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        current += '"'
        index += 1
        continue
      }
      quoted = !quoted
      continue
    }
    if (character === ',' && !quoted) {
      row.push(current)
      current = ''
      continue
    }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(current)
      current = ''
      if (row.some((cell) => cell !== '')) rows.push(row)
      row = []
      continue
    }
    current += character
  }
  if (current || row.length) {
    row.push(current)
    rows.push(row)
  }
  const header = rows[0] ?? []
  return rows.slice(1).map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ''])))
}

export function gamesFromCsv(csv: string): ScheduleGame[] {
  return parseCsv(csv).flatMap((row) => {
    if (row.game_type !== 'REG' || !row.home_team || !row.away_team) return []
    const season = Number(row.season)
    const week = Number(row.week)
    if (!Number.isInteger(season) || !Number.isInteger(week) || !season || !week) return []
    return [{
      season,
      week,
      gameType: row.game_type,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      completed: row.home_score !== '' && row.away_score !== '',
    }]
  })
}

export function observationsFromWeeklyCsv(csv: string, season: number): FpaObservation[] {
  return parseCsv(csv).flatMap((row) => {
    if (row.season_type !== 'REG') return []
    const position = normalizePos(row.position)
    const defense = normalizeTeam(row.opponent_team)
    const week = Number(row.week)
    if (!position || !MATCHUP_POSITIONS.includes(position as MatchupPosition) || !defense || !week) return []
    return [{
      season: Number(row.season) || season,
      week,
      defense,
      position,
      standard: Number(row.fantasy_points) || 0,
      ppr: Number(row.fantasy_points_ppr) || 0,
    }]
  })
}

/** Schedule and matchups without the 16MB player-history payload. */
export function publishedScheduleArtifact(artifact: Pick<PublishedIntelligence, 'generatedAt' | 'attribution' | 'schedule' | 'matchups'>) {
  return {
    schemaVersion: 1 as const,
    generatedAt: artifact.generatedAt,
    attribution: artifact.attribution ?? 'Data: nflverse (CC-BY-4.0)',
    schedule: artifact.schedule ?? null,
    matchups: artifact.matchups ?? null,
  }
}

export function attachScheduleModel<T extends { methodology?: Record<string, string>; summary?: Record<string, number> }>(payload: T, model: ScheduleModel) {
  return {
    ...payload,
    methodology: {
      ...payload.methodology,
      matchupStrength: MATCHUP_METHODOLOGY.matchupStrength,
      strengthOfSchedule: MATCHUP_METHODOLOGY.strengthOfSchedule,
    },
    schedule: {
      season: model.season,
      source: model.source,
      updatedAt: model.updatedAt,
      teams: model.teams,
    },
    matchups: {
      window: model.window,
      byScoring: model.matchups,
      strengthOfSchedule: model.strengthOfSchedule,
    },
    summary: {
      ...payload.summary,
      scheduleSeason: model.season,
      scheduleTeams: Object.keys(model.teams).length,
    },
  }
}

export function refreshPublishedSchedule(input: {
  artifact: PublishedIntelligence
  games: ScheduleGame[]
  currentYear: number
  generatedAt: string
  extraObservations?: FpaObservation[]
}) {
  if (input.artifact.schemaVersion !== 1 || !Array.isArray(input.artifact.players) || !input.artifact.players.length) {
    throw new Error('Hosted intelligence artifact is missing player history. Upload a local sync first.')
  }
  if (!input.games.length) throw new Error('nflverse schedule file contained no regular-season games.')
  const seasons = [...new Set(input.games.map((game) => game.season))]
  const scheduleSeason = seasons.includes(input.currentYear) ? input.currentYear : Math.max(...seasons)
  const schedules = buildTeamSchedules(input.games, scheduleSeason)
  if (Object.keys(schedules).length !== 32) throw new Error(`Schedule for ${scheduleSeason} has ${Object.keys(schedules).length} teams; expected 32.`)
  const model = calculateMatchupModel({
    observations: [...observationsFromPlayers(input.artifact.players), ...input.extraObservations ?? []],
    schedules,
    currentSeason: scheduleSeason,
    source: SCHEDULE_SOURCE,
    updatedAt: input.generatedAt,
  })
  return {
    artifact: {
      ...attachScheduleModel(input.artifact, model),
      generatedAt: input.generatedAt,
    },
    model,
    stats: {
      scheduleSeason,
      scheduleTeams: Object.keys(schedules).length,
      currentGames: model.window.currentGames,
      priorSeason: model.window.priorSeason,
      extraObservations: input.extraObservations?.length ?? 0,
      players: input.artifact.players.length,
    },
  }
}
