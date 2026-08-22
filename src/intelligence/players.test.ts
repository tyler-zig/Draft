import { describe, expect, it } from 'vitest'
import type { Player } from '../providers/types'
import { applyScheduleByes, attachPlayoffSos, enrichPlayersWithDirectory } from './players'
import type { ScheduleModel, ScheduleWeek } from './calculations/matchup'

const week = (week: number, opponent: string | null): ScheduleWeek => ({
  week, opponent, home: false, bye: opponent === null, completed: false,
})

// Two modeled teams and one with no playoff-window weeks. RB ranks: GB 4
// (softest), DET 8, MIN 16. WR ranks: GB 2, DET 10, MIN 20.
const playoffModel: ScheduleModel = {
  season: 2026, source: 'test', updatedAt: 'now',
  teams: {
    CHI: [week(14, 'GB'), week(15, 'MIN'), week(16, 'DET'), week(17, 'GB')],
    KC: [week(15, 'DET'), week(16, 'MIN'), week(17, 'GB')],
    JAX: [week(15, 'GB'), week(16, 'GB'), week(17, 'GB')],
    LAC: [],
  },
  window: { priorSeason: 2025, currentSeason: 2026, currentGames: 0, priorWeight: 1, currentWeight: 0, minSample: 4 },
  matchups: {
    ppr: {
      RB: {
        GB: { team: 'GB', rank: 4, pointsAllowed: 10, games: 17 },
        DET: { team: 'DET', rank: 8, pointsAllowed: 14, games: 17 },
        MIN: { team: 'MIN', rank: 16, pointsAllowed: 20, games: 17 },
      },
      WR: {
        GB: { team: 'GB', rank: 2, pointsAllowed: 30, games: 17 },
        DET: { team: 'DET', rank: 10, pointsAllowed: 24, games: 17 },
        MIN: { team: 'MIN', rank: 20, pointsAllowed: 18, games: 17 },
      },
      QB: {}, TE: {},
    },
    half: { RB: {}, WR: {}, QB: {}, TE: {} },
    standard: { RB: {}, WR: {}, QB: {}, TE: {} },
  },
  strengthOfSchedule: {
    ppr: { RB: {}, WR: {}, QB: {}, TE: {} },
    half: { RB: {}, WR: {}, QB: {}, TE: {} },
    standard: { RB: {}, WR: {}, QB: {}, TE: {} },
  },
}

const player = (overrides: Partial<Player>): Player => ({ id: 'base', firstName: 'Real', lastName: 'Player', fullName: 'Real Player', position: 'RB', team: 'CHI', searchRank: 1, injuryStatus: null, number: null, yearsExp: null, bye: null, ...overrides })

describe('player profile enrichment', () => {
  it('joins Sleeper profile fields to an ESPN draft player without changing its draft id', () => {
    const result = enrichPlayersWithDirectory(
      [player({ id: 'espn-draft-id', espnId: '42' })],
      [player({ id: 'sleeper-id', sleeperId: '900', espnId: '42', age: 25, height: `6'1"`, weight: 210, bye: 10 })],
    )[0]
    expect(result).toMatchObject({ id: 'espn-draft-id', sleeperId: '900', espnId: '42', age: 25, height: `6'1"`, weight: 210, bye: 10 })
  })

  it('joins across a generational suffix one source carries and the other omits', () => {
    // ESPN lists him as "James Cook III"; Sleeper as "James Cook". The raw
    // lowercase key these used to compare left a top-five back with no Sleeper
    // id, and therefore no Sleeper rank.
    const result = enrichPlayersWithDirectory(
      [player({ id: '4379399', espnId: '4379399', fullName: 'James Cook III', team: 'BUF' })],
      [player({ id: '8138', sleeperId: '8138', fullName: 'James Cook', team: 'BUF', age: 26 })],
    )[0]
    expect(result.sleeperId).toBe('8138')
    expect(result.age).toBe(26)
  })

  it('joins across punctuation and casing differences', () => {
    const result = enrichPlayersWithDirectory(
      [player({ id: 'e1', espnId: 'e1', fullName: "Ja'Marr Chase", position: 'WR', team: 'CIN' })],
      [player({ id: 's1', sleeperId: 's1', fullName: 'JaMarr Chase', position: 'WR', team: 'CIN', age: 25 })],
    )[0]
    expect(result.sleeperId).toBe('s1')
  })

  it('falls back past the team when the sources disagree about it', () => {
    const result = enrichPlayersWithDirectory(
      [player({ id: 'e1', espnId: 'e1', fullName: 'Traded Back', team: null })],
      [player({ id: 's1', sleeperId: 's1', fullName: 'Traded Back', team: 'NYJ', age: 24 })],
    )[0]
    expect(result.sleeperId).toBe('s1')
  })

  it('refuses to guess between two players who share a name and position', () => {
    const result = enrichPlayersWithDirectory(
      [player({ id: 'e1', espnId: 'e1', fullName: 'Mike Williams', team: null })],
      [
        player({ id: 's1', sleeperId: 's1', fullName: 'Mike Williams', team: 'NYJ' }),
        player({ id: 's2', sleeperId: 's2', fullName: 'Mike Williams', team: 'PIT' }),
      ],
    )[0]
    expect(result.sleeperId).toBeUndefined()
  })

  it('still prefers an id match over any name match', () => {
    const result = enrichPlayersWithDirectory(
      [player({ id: 'e1', espnId: '42', fullName: 'Name Collision' })],
      [
        player({ id: 's1', sleeperId: 'right', espnId: '42', fullName: 'Totally Different', age: 30 }),
        player({ id: 's2', sleeperId: 'wrong', fullName: 'Name Collision', age: 22 }),
      ],
    )[0]
    expect(result.sleeperId).toBe('right')
    expect(result.age).toBe(30)
  })

  it('stamps each player bye from the current team schedule, including aliased abbreviations', () => {
    const weeks = (bye: number): Array<{ week: number; opponent: string | null; home: boolean; bye: boolean; completed: boolean }> => [
      { week: 1, opponent: 'GB', home: true, bye: false, completed: false },
      { week: bye, opponent: null, home: false, bye: true, completed: false },
    ]
    const result = applyScheduleByes(
      [
        player({ id: 'chi', team: 'CHI', bye: null }),
        player({ id: 'was', team: 'WAS', bye: 12 }),
        player({ id: 'fa', team: null, bye: null }),
      ],
      { CHI: weeks(5), WSH: weeks(8) },
    )
    expect(result.map((item) => [item.id, item.bye])).toEqual([
      ['chi', 5],
      ['was', 8],
      ['fa', null],
    ])
  })
})

describe('playoff strength of schedule', () => {
  const weeks = { start: 15, end: 17 }

  it('stamps the playoff-window matchup average and league-wide rank per position', () => {
    const result = attachPlayoffSos(
      [
        player({ id: 'chi-rb', team: 'CHI' }),
        player({ id: 'chi-wr', team: 'CHI', position: 'WR' }),
        player({ id: 'kc-rb', team: 'KC' }),
      ],
      playoffModel,
      'ppr',
      weeks,
    )
    // CHI RB: MIN 16 + DET 8 + GB 4 = 28/3.
    expect(result.find((item) => item.id === 'chi-rb')?.playoffSos).toEqual({ averageMatchupRank: 28 / 3, rank: 2, games: 3 })
    // KC RB draws the same three defenses in a different order; JAX (4 avg) is 1.
    expect(result.find((item) => item.id === 'kc-rb')?.playoffSos).toEqual({ averageMatchupRank: 28 / 3, rank: 3, games: 3 })
    // The WR slate is a different table: MIN 20 + DET 10 + GB 2 = 32/3.
    expect(result.find((item) => item.id === 'chi-wr')?.playoffSos?.averageMatchupRank).toBe(32 / 3)
  })

  it('leaves DEF, unknown teams, and no-window teams blank and ranks nothing with no games', () => {
    const result = attachPlayoffSos(
      [
        player({ id: 'def', team: 'CHI', position: 'DEF' }),
        player({ id: 'fa', team: null }),
        player({ id: 'lac', team: 'LAC' }),
        player({ id: 'chi', team: 'CHI' }),
      ],
      playoffModel,
      'ppr',
      weeks,
    )
    expect(result.find((item) => item.id === 'def')?.playoffSos).toBeUndefined()
    expect(result.find((item) => item.id === 'fa')?.playoffSos).toBeUndefined()
    expect(result.find((item) => item.id === 'lac')?.playoffSos).toEqual({ averageMatchupRank: 0, rank: null, games: 0 })
    expect(result.find((item) => item.id === 'chi')?.playoffSos?.rank).toBe(2)
  })

  it('pairs alias spellings through the shared team normalizer', () => {
    const result = attachPlayoffSos(
      [player({ id: 'jax', team: 'JAC' })],
      playoffModel,
      'ppr',
      weeks,
    )
    expect(result[0]?.playoffSos).toEqual({ averageMatchupRank: 4, rank: 1, games: 3 })
  })

  it('passes the pool through untouched without a model or a week window', () => {
    const pool = [player({ id: 'chi', team: 'CHI' })]
    expect(attachPlayoffSos(pool, null, 'ppr', weeks)).toBe(pool)
    expect(attachPlayoffSos(pool, playoffModel, 'ppr', null)).toBe(pool)
  })
})
