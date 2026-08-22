import { describe, expect, it } from 'vitest'
import {
  byeWeekFromSchedule,
  blendWeights,
  buildTeamSchedules,
  calculateMatchupModel,
  matchupTone,
  observationsFromPlayers,
  ordinal,
  playoffStrengthOfSchedule,
  pointsForScoring,
  rankDefenses,
  resolvePlayerSchedule,
} from './matchup'

const game = (week: number, away: string, home: string, completed = false) => ({
  season: 2026, week, gameType: 'REG', homeTeam: home, awayTeam: away, completed,
})

describe('matchup calculations', () => {
  it('converts scoring formats and early-season blend weights', () => {
    expect(pointsForScoring(20, 24, 'standard')).toBe(20)
    expect(pointsForScoring(20, 24, 'half')).toBe(22)
    expect(pointsForScoring(20, 24, 'ppr')).toBe(24)
    expect(blendWeights(0, 4)).toEqual({ priorWeight: 1, currentWeight: 0 })
    expect(blendWeights(2, 4)).toEqual({ priorWeight: 0.5, currentWeight: 0.5 })
    expect(blendWeights(4, 4)).toEqual({ priorWeight: 0, currentWeight: 1 })
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(22)).toBe('22nd')
    expect(matchupTone(1)).toBe('easy')
    expect(matchupTone(8)).toBe('easy')
    expect(matchupTone(9)).toBe('neutral')
    expect(matchupTone(16)).toBe('neutral')
    expect(matchupTone(17)).toBe('tough')
    expect(matchupTone(24)).toBe('tough')
    expect(matchupTone(25)).toBe('hard')
    expect(matchupTone(32)).toBe('hard')
    expect(matchupTone(null)).toBe('neutral')
  })

  it('explodes games into team weeks and inserts a bye', () => {
    const schedules = buildTeamSchedules([
      game(1, 'GB', 'CHI'),
      game(2, 'CHI', 'MIN'),
      game(3, 'LA', 'GB'),
    ], 2026)
    expect(schedules.CHI?.map((week) => [week.week, week.opponent, week.home, week.bye])).toEqual([
      [1, 'GB', true, false],
      [2, 'MIN', false, false],
      [3, null, false, true],
    ])
    expect(schedules.LAR?.find((week) => week.week === 3)).toMatchObject({ opponent: 'GB', home: false, bye: false })
    expect(byeWeekFromSchedule(schedules.CHI)).toBe(3)
    expect(byeWeekFromSchedule(schedules.CHI?.filter((week) => !week.bye))).toBeNull()
    expect(byeWeekFromSchedule(undefined)).toBeNull()
    expect(byeWeekFromSchedule([
      { week: 5, opponent: null, bye: true },
      { week: 12, opponent: null, bye: true },
    ])).toBeNull()
  })

  it('sums every scorer against a defense and ranks the highest FPA first', () => {
    const ranked = rankDefenses([
      { team: 'MIN', pointsAllowed: 18, games: 2 },
      { team: 'GB', pointsAllowed: 30, games: 2 },
      { team: 'DET', pointsAllowed: 18, games: 2 },
    ])
    expect(ranked.map((entry) => [entry.team, entry.rank])).toEqual([
      ['GB', 1],
      ['DET', 2],
      ['MIN', 3],
    ])
  })

  it('blends prior and current FPA and changes ranks when scoring changes', () => {
    const schedules = buildTeamSchedules([
      game(1, 'GB', 'CHI'),
      game(1, 'DET', 'MIN'),
    ], 2026)
    const model = calculateMatchupModel({
      currentSeason: 2026,
      minSample: 4,
      updatedAt: 'now',
      schedules,
      observations: [
        { season: 2025, week: 1, defense: 'GB', position: 'RB', standard: 10, ppr: 10 },
        { season: 2025, week: 1, defense: 'MIN', position: 'RB', standard: 20, ppr: 28 },
      ],
    })
    expect(model.window).toMatchObject({ priorSeason: 2025, currentGames: 0, priorWeight: 1, currentWeight: 0 })
    expect(model.matchups.ppr.RB.MIN.rank).toBe(1)
    expect(model.matchups.standard.RB.MIN.rank).toBe(1)
    expect(model.matchups.ppr.RB.MIN.pointsAllowed).toBe(28)
    expect(model.matchups.standard.RB.MIN.pointsAllowed).toBe(20)

    const midseason = calculateMatchupModel({
      currentSeason: 2026,
      minSample: 1,
      updatedAt: 'now',
      schedules: buildTeamSchedules([game(1, 'GB', 'CHI', true), game(1, 'DET', 'MIN', true)], 2026),
      observations: [
        { season: 2025, week: 1, defense: 'GB', position: 'RB', standard: 10, ppr: 10 },
        { season: 2025, week: 1, defense: 'MIN', position: 'RB', standard: 20, ppr: 20 },
        { season: 2026, week: 1, defense: 'GB', position: 'RB', standard: 30, ppr: 30 },
        { season: 2026, week: 1, defense: 'MIN', position: 'RB', standard: 8, ppr: 8 },
      ],
    })
    expect(midseason.window.currentWeight).toBe(1)
    expect(midseason.matchups.ppr.RB.GB.rank).toBe(1)
    expect(midseason.matchups.ppr.RB.GB.pointsAllowed).toBe(30)
  })

  it('builds remaining SOS from opponent ranks and resolves a player card', () => {
    const schedules = buildTeamSchedules([
      game(1, 'GB', 'CHI'),
      game(2, 'CHI', 'MIN'),
      game(1, 'DET', 'MIN'),
      game(2, 'GB', 'DET'),
    ], 2026)
    const model = calculateMatchupModel({
      currentSeason: 2026,
      updatedAt: 'now',
      schedules,
      observations: observationsFromPlayers([{
        position: 'RB',
        seasons: [{
          season: 2025,
          weekly: [
            { week: 1, opponent: 'GB', fantasyPoints: 8, fantasyPointsPpr: 8 },
            { week: 1, opponent: 'MIN', fantasyPoints: 24, fantasyPointsPpr: 24 },
            { week: 1, opponent: 'DET', fantasyPoints: 16, fantasyPointsPpr: 16 },
            { week: 1, opponent: 'CHI', fantasyPoints: 12, fantasyPointsPpr: 12 },
          ],
        }],
      }]),
    })
    expect(model.strengthOfSchedule.ppr.RB.CHI.remainingGames).toBe(2)
    expect(model.strengthOfSchedule.ppr.RB.CHI.rank).toBeLessThan(model.strengthOfSchedule.ppr.RB.DET.rank)

    const view = resolvePlayerSchedule({ team: 'CHI', position: 'RB', scoring: 'ppr', model })
    expect(view?.upcoming[0]).toMatchObject({ week: 1, opponent: 'GB', home: true, matchupRank: model.matchups.ppr.RB.GB.rank })
    expect(resolvePlayerSchedule({ team: null, position: 'RB', scoring: 'ppr', model })?.message).toMatch(/no current team/)
    expect(resolvePlayerSchedule({ team: 'CHI', position: 'DEF', scoring: 'ppr', model })?.message).toMatch(/not modeled/)
  })

  it('ranks playoff-window schedules, 1 = easiest slate', () => {
    // Defenses ranked by FPA: GB (24) is the softest, CHI (8) the toughest.
    const schedules = buildTeamSchedules([
      game(14, 'MIN', 'CHI'), // outside the window -- must not count
      game(15, 'GB', 'CHI'), game(16, 'DET', 'CHI'), game(17, 'MIN', 'CHI'),
      game(15, 'CHI', 'GB'), game(16, 'MIN', 'GB'), game(17, 'DET', 'GB'),
      game(15, 'DET', 'MIN'), game(16, 'CHI', 'MIN'), game(17, 'GB', 'MIN'),
      game(15, 'MIN', 'DET'), game(16, 'GB', 'DET'), game(17, 'CHI', 'DET'),
    ], 2026)
    const model = calculateMatchupModel({
      currentSeason: 2026, updatedAt: 'now', schedules,
      observations: [
        { season: 2025, week: 1, defense: 'GB', position: 'RB', standard: 24, ppr: 24 },
        { season: 2025, week: 1, defense: 'DET', position: 'RB', standard: 16, ppr: 16 },
        { season: 2025, week: 1, defense: 'MIN', position: 'RB', standard: 12, ppr: 12 },
        { season: 2025, week: 1, defense: 'CHI', position: 'RB', standard: 8, ppr: 8 },
      ],
    })
    const playoff = playoffStrengthOfSchedule({ model, scoring: 'ppr', position: 'RB', weekStart: 15, weekEnd: 17 })
    // CHI draws GB (1) + DET (2) + MIN (3): average 2, the easiest playoff slate.
    expect(playoff.find((entry) => entry.team === 'CHI')).toMatchObject({ averageMatchupRank: 2, games: 3, rank: 1 })
    expect(playoff.find((entry) => entry.team === 'MIN')).toMatchObject({ averageMatchupRank: 7 / 3, games: 3, rank: 2 })
    expect(playoff.find((entry) => entry.team === 'DET')).toMatchObject({ averageMatchupRank: 8 / 3, games: 3, rank: 3 })
    expect(playoff.find((entry) => entry.team === 'GB')).toMatchObject({ averageMatchupRank: 3, games: 3, rank: 4 })
  })

  it('excludes byes and completed games, and ranks nothing outside the window', () => {
    const schedules = buildTeamSchedules([
      game(16, 'CHI', 'GB', true), // completed inside the window -- excluded
      game(17, 'CHI', 'GB'),
    ], 2026)
    const model = calculateMatchupModel({
      currentSeason: 2026, updatedAt: 'now', schedules,
      observations: [
        { season: 2025, week: 1, defense: 'GB', position: 'RB', standard: 24, ppr: 24 },
        { season: 2025, week: 1, defense: 'CHI', position: 'RB', standard: 8, ppr: 8 },
      ],
    })
    // CHI's week 15 bye and week 16 completed game leave only week 17.
    const playoff = playoffStrengthOfSchedule({ model, scoring: 'ppr', position: 'RB', weekStart: 15, weekEnd: 17 })
    expect(playoff.find((entry) => entry.team === 'CHI')).toMatchObject({ games: 1, rank: 1 })
    // A window with no games for anyone ranks nothing at all.
    const empty = playoffStrengthOfSchedule({ model, scoring: 'ppr', position: 'RB', weekStart: 15, weekEnd: 15 })
    expect(empty.every((entry) => entry.games === 0 && entry.rank === null)).toBe(true)
  })
})
