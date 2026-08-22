import { describe, expect, it } from 'vitest'
import { gamesFromCsv, observationsFromWeeklyCsv, parseCsv, refreshPublishedSchedule } from './scheduleRefresh'

const gamesCsv = `game_id,season,game_type,week,away_team,away_score,home_team,home_score
a,2026,REG,1,GB,,CHI,
b,2026,REG,2,CHI,,MIN,
c,2026,PRE,1,DET,10,CHI,7
d,2025,REG,1,GB,17,CHI,20
`

const statsCsv = `season,season_type,week,position,opponent_team,fantasy_points,fantasy_points_ppr
2026,REG,1,RB,GB,30,30
2026,PRE,1,RB,DET,99,99
`

describe('hosted schedule refresh', () => {
  it('parses quoted CSV and keeps only regular-season games', () => {
    expect(parseCsv('name,city\n"Bears, Chicago",CHI')[0]).toEqual({ name: 'Bears, Chicago', city: 'CHI' })
    expect(gamesFromCsv(gamesCsv)).toEqual([
      { season: 2026, week: 1, gameType: 'REG', homeTeam: 'CHI', awayTeam: 'GB', completed: false },
      { season: 2026, week: 2, gameType: 'REG', homeTeam: 'MIN', awayTeam: 'CHI', completed: false },
      { season: 2025, week: 1, gameType: 'REG', homeTeam: 'CHI', awayTeam: 'GB', completed: true },
    ])
    expect(observationsFromWeeklyCsv(statsCsv, 2026)).toEqual([
      { season: 2026, week: 1, defense: 'GB', position: 'RB', standard: 30, ppr: 30 },
    ])
  })

  it('rebuilds schedule and SOS on a stored player artifact without dropping history', () => {
    const artifact = {
      schemaVersion: 1,
      generatedAt: 'old',
      methodology: { touchShare: 'documented' },
      summary: { players: 1, seasons: 1 },
      players: [{
        ids: { gsis: '00-0000001', espn: null, sleeper: null, pfr: null },
        name: 'Fixture Back',
        position: 'RB',
        seasons: [{
          season: 2025,
          weekly: [
            { week: 1, opponent: 'GB', fantasyPoints: 8, fantasyPointsPpr: 8 },
            { week: 1, opponent: 'MIN', fantasyPoints: 24, fantasyPointsPpr: 24 },
            { week: 1, opponent: 'CHI', fantasyPoints: 12, fantasyPointsPpr: 12 },
          ],
        }],
      }],
    }
    const thirtyTwo = ['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WSH']
    const others = thirtyTwo.filter((team) => team !== 'CHI' && team !== 'GB')
    const games = [
      { season: 2026, week: 1, gameType: 'REG' as const, homeTeam: 'CHI', awayTeam: 'GB', completed: false },
      ...others.map((team, index) => ({ season: 2026, week: 1, gameType: 'REG' as const, homeTeam: team, awayTeam: others[(index + 1) % others.length], completed: false })),
    ]
    const refreshed = refreshPublishedSchedule({ artifact, games, currentYear: 2026, generatedAt: 'now' })
    expect(refreshed.artifact.players).toHaveLength(1)
    expect(refreshed.artifact.generatedAt).toBe('now')
    expect(refreshed.stats).toMatchObject({ scheduleSeason: 2026, scheduleTeams: 32, currentGames: 0 })
    expect(refreshed.artifact.schedule.teams.CHI[0]?.opponent).toBe('GB')
    expect(refreshed.artifact.matchups.byScoring.ppr.RB.MIN.rank).toBeLessThan(refreshed.artifact.matchups.byScoring.ppr.RB.GB.rank)
  })
})
