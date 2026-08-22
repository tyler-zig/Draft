import type { HistoricalSeason } from '../../src/api/playerHistorical'
import { MATCHUP_METHODOLOGY } from '../../src/intelligence/calculations/matchup'
import { attachScheduleModel } from '../../src/intelligence/scheduleRefresh'

export interface PlayerIds {
  gsis: string
  espn: string | null
  sleeper: string | null
  pfr: string | null
}

export interface SeasonPlayer {
  ids: PlayerIds
  name: string
  team: string
  position: string
  season: HistoricalSeason
}

export interface SeasonSlice {
  schemaVersion: 1
  season: number
  generatedAt: string
  sources: Array<{ season: number; kind: string; url: string; cached: boolean }>
  players: SeasonPlayer[]
}

export interface PublishedPlayer {
  ids: PlayerIds
  name: string
  team: string
  position: string
  seasons: HistoricalSeason[]
}

export function validSeason(season: number, currentYear: number) {
  return Number.isInteger(season) && season >= 1999 && season <= currentYear
}

export function parseSeasonList(value: string | undefined, currentYear: number) {
  if (!value) return []
  return [...new Set(value.split(',').map(Number).filter((season) => validSeason(season, currentYear)))].sort((a, b) => a - b)
}

export function resolveSeasons(input: { requested: number[]; stored: number[]; currentYear: number; refresh: boolean }) {
  const defaults = [input.currentYear - 2, input.currentYear - 1].filter((season) => validSeason(season, input.currentYear))
  const all = [...new Set([...input.stored, ...input.requested, ...defaults])].sort((a, b) => a - b)
  const rebuild = new Set(input.refresh ? (input.requested.length ? input.requested : all.slice(-1)) : [])
  return { all, rebuild }
}

export function needsBuild(season: number, stored: Iterable<number>, rebuild: Iterable<number>) {
  return new Set(rebuild).has(season) || !new Set(stored).has(season)
}

export function seasonHasSignal(season: HistoricalSeason) {
  return season.gamesPlayed > 0 || season.durability.gamesMissed > 0 || season.usage.opportunities > 0 || season.weekly.length > 0
}

export function splitLegacyPlayers(
  players: Array<{ ids: PlayerIds; name: string; team: string; position: string; seasons: HistoricalSeason[] }>,
  season: number,
): SeasonPlayer[] {
  return players.flatMap((player) => {
    const slice = player.seasons.find((entry) => entry.season === season)
    if (!slice || !seasonHasSignal(slice)) return []
    return [{ ids: player.ids, name: player.name, team: player.team, position: player.position, season: slice }]
  })
}

function preferId(next: string | null, previous: string | null) {
  return next || previous
}

export function mergeSeasonSlices(slices: SeasonSlice[], generatedAt: string) {
  const byId = new Map<string, PublishedPlayer>()
  const sources = slices.flatMap((slice) => slice.sources)
  const seasons = slices.map((slice) => slice.season)

  for (const slice of slices) {
    for (const player of slice.players) {
      const current = byId.get(player.ids.gsis)
      if (!current) {
        byId.set(player.ids.gsis, { ids: { ...player.ids }, name: player.name, team: player.team, position: player.position, seasons: [player.season] })
        continue
      }
      current.ids = {
        gsis: player.ids.gsis,
        espn: preferId(player.ids.espn, current.ids.espn),
        sleeper: preferId(player.ids.sleeper, current.ids.sleeper),
        pfr: preferId(player.ids.pfr, current.ids.pfr),
      }
      current.name = player.name
      current.team = player.team
      current.position = player.position
      const index = current.seasons.findIndex((entry) => entry.season === player.season.season)
      if (index >= 0) current.seasons[index] = player.season
      else current.seasons.push(player.season)
    }
  }

  const players = [...byId.values()].map((player) => ({
    ...player,
    seasons: [...player.seasons].sort((a, b) => a.season - b.season),
  })).sort((a, b) => a.name.localeCompare(b.name))

  return {
    schemaVersion: 1 as const,
    generatedAt,
    seasons,
    attribution: 'Data: nflverse (CC-BY-4.0)',
    methodology: {
      touchShare: '(player carries + targets) / team carries + targets in games with a player stat row',
      redZoneTouchShare: 'player carries + targets inside opponent 20 / team total in those games',
      snapShare: 'offensive snaps / team offensive snaps in participated games',
      gamesMissed: 'regular-season team games rostered without stats or recorded snaps; byes and DEV/CUT weeks excluded; team changes count at most once per week',
      matchupStrength: MATCHUP_METHODOLOGY.matchupStrength,
      strengthOfSchedule: MATCHUP_METHODOLOGY.strengthOfSchedule,
    },
    sources,
    players,
    summary: { players: players.length, exactGsisProfiles: players.filter((player) => player.ids.gsis).length, seasons: seasons.length },
  }
}

export { attachScheduleModel }
