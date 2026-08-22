import { describe, expect, it } from 'vitest'
import type { HistoricalSeason } from '../../src/api/playerHistorical'
import { attachScheduleModel, mergeSeasonSlices, needsBuild, parseSeasonList, resolveSeasons, seasonHasSignal, splitLegacyPlayers } from './intelligence-history'
import { calculateMatchupModel, buildTeamSchedules } from '../../src/intelligence/calculations/matchup'

const season = (year: number, gamesPlayed = 10): HistoricalSeason => ({
  season: year,
  gamesPlayed,
  stats: { completions: 0, attempts: 0, passingYards: 0, passingTds: 0, interceptions: 0, carries: 12, rushingYards: 50, rushingTds: 1, receptions: 0, targets: 0, receivingYards: 0, receivingTds: 0, fantasyPoints: 11, fantasyPointsPpr: 11 },
  weekly: gamesPlayed ? [{ week: 1, opponent: 'GB', team: 'CHI', fantasyPoints: 11, fantasyPointsPpr: 11, carries: 12, targets: 0, offenseSnaps: 40 }] : [],
  usage: { opportunities: gamesPlayed ? 12 : 0, touchShare: gamesPlayed ? 0.2 : null, redZoneOpportunities: 0, redZoneTouchShare: null, offenseSnaps: gamesPlayed ? 40 : 0, snapShare: gamesPlayed ? 0.5 : null },
  durability: { gamesMissed: 0, missedWeeks: [], byStatus: {} },
})

describe('intelligence history seasons', () => {
  it('keeps stored years and treats --seasons as additions', () => {
    const resolved = resolveSeasons({ requested: [2021, 2022], stored: [2024, 2025], currentYear: 2026, refresh: false })
    expect(resolved.all).toEqual([2021, 2022, 2024, 2025])
    expect([...resolved.rebuild]).toEqual([])
  })

  it('does not rebuild frozen years unless they are missing or refreshed', () => {
    expect(needsBuild(2021, [2021, 2024, 2025], [])).toBe(false)
    expect(needsBuild(2023, [2021, 2024, 2025], [])).toBe(true)
    expect(needsBuild(2021, [2021, 2024, 2025], [2021])).toBe(true)
  })

  it('refreshes only requested years, or the newest year when --refresh is bare', () => {
    expect([...resolveSeasons({ requested: [2023], stored: [2021, 2023, 2025], currentYear: 2026, refresh: true }).rebuild]).toEqual([2023])
    expect([...resolveSeasons({ requested: [], stored: [2021, 2025], currentYear: 2026, refresh: true }).rebuild]).toEqual([2025])
  })

  it('parses season flags and drops empty legacy stubs', () => {
    expect(parseSeasonList('2018,2019,nope', 2026)).toEqual([2018, 2019])
    expect(seasonHasSignal(season(2024, 0))).toBe(false)
    expect(splitLegacyPlayers([
      { ids: { gsis: 'a', espn: '1', sleeper: null, pfr: null }, name: 'A', team: 'CHI', position: 'RB', seasons: [season(2024, 0), season(2025)] },
    ], 2024)).toEqual([])
    expect(splitLegacyPlayers([
      { ids: { gsis: 'a', espn: '1', sleeper: null, pfr: null }, name: 'A', team: 'CHI', position: 'RB', seasons: [season(2025)] },
    ], 2025)).toHaveLength(1)
  })

  it('merges year slices without dropping older players or IDs', () => {
    const merged = mergeSeasonSlices([
      { schemaVersion: 1, season: 2021, generatedAt: 'old', sources: [{ season: 2021, kind: 'stats', url: 'u', cached: true }], players: [{ ids: { gsis: 'retired', espn: null, sleeper: '9', pfr: null }, name: 'Old Back', team: 'DET', position: 'RB', season: season(2021) }] },
      { schemaVersion: 1, season: 2025, generatedAt: 'new', sources: [{ season: 2025, kind: 'stats', url: 'v', cached: true }], players: [{ ids: { gsis: 'star', espn: '2', sleeper: null, pfr: 'p' }, name: 'Star', team: 'KC', position: 'WR', season: season(2025) }] },
    ], 'now')
    expect(merged.seasons).toEqual([2021, 2025])
    expect(merged.players.map((player) => player.name)).toEqual(['Old Back', 'Star'])
    expect(merged.players[0]?.ids.sleeper).toBe('9')
    expect(merged.players[1]?.seasons.map((entry) => entry.season)).toEqual([2025])
  })

  it('attaches the current schedule model without rewriting player history', () => {
    const merged = mergeSeasonSlices([
      { schemaVersion: 1, season: 2025, generatedAt: 'new', sources: [], players: [{ ids: { gsis: 'star', espn: '2', sleeper: null, pfr: 'p' }, name: 'Star', team: 'KC', position: 'WR', season: season(2025) }] },
    ], 'now')
    const published = attachScheduleModel(merged, calculateMatchupModel({
      currentSeason: 2026,
      updatedAt: 'now',
      schedules: buildTeamSchedules([{ season: 2026, week: 1, gameType: 'REG', homeTeam: 'KC', awayTeam: 'CHI', completed: false }], 2026),
      observations: [],
    }))
    expect(published.schedule.season).toBe(2026)
    expect(published.schedule.teams.KC[0]?.opponent).toBe('CHI')
    expect(published.matchups.window.priorSeason).toBeNull()
    expect(published.players).toHaveLength(1)
    expect(published.methodology.strengthOfSchedule).toMatch(/remaining/)
  })
})
