import { describe, expect, it } from 'vitest'
import { seasonStats, statsFromEspn, toRow } from './espn-projections.mjs'

const gibbs = {
  player: {
    id: 4429795,
    fullName: 'Jahmyr Gibbs',
    defaultPositionId: 2,
    proTeamId: 8,
    stats: [
      { seasonId: 2026, scoringPeriodId: 1, statSourceId: 1, statSplitTypeId: 1, stats: { 23: 16, 24: 80 } },
      {
        seasonId: 2026,
        scoringPeriodId: 0,
        statSourceId: 1,
        statSplitTypeId: 0,
        appliedTotal: 364.8,
        stats: { 23: 283.1, 24: 1372.6, 25: 14.5, 42: 545.9, 43: 3.4, 53: 67.8, 72: 1.3, 210: 17, 40: 80.7 },
      },
    ],
  },
}

const allen = {
  player: {
    id: 3918298,
    fullName: 'Josh Allen',
    defaultPositionId: 1,
    proTeamId: 2,
    stats: [{
      seasonId: 2026, scoringPeriodId: 0, statSourceId: 1, statSplitTypeId: 0,
      stats: { 0: 508.7, 1: 340.1, 3: 3946.4, 4: 26.3, 20: 11.6, 23: 116.4, 24: 579.9, 25: 12.5, 210: 17 },
    }],
  },
}

describe('seasonStats', () => {
  it('picks the season-total projection, not a weekly line', () => {
    const line = seasonStats(gibbs.player.stats)
    expect(line.stats[24]).toBe(1372.6)
    expect(line.scoringPeriodId).toBe(0)
  })
})

describe('statsFromEspn', () => {
  it('maps season ids and ignores per-game aliases', () => {
    const stats = statsFromEspn(seasonStats(gibbs.player.stats).stats)
    expect(stats.rush_yd).toBe(1372.6)
    expect(stats.rec).toBe(67.8)
    expect(stats.rush_att).toBe(283.1)
    expect(stats).not.toHaveProperty('40')
  })
})

describe('toRow', () => {
  it('keeps ESPN identity and season volume', () => {
    expect(toRow(gibbs, 2026)).toMatchObject({
      name: 'Jahmyr Gibbs',
      team: 'DET',
      position: 'RB',
      espnId: '4429795',
      games: 17,
      stats: { rush_yd: 1372.6, rec: 67.8, rec_yd: 545.9, fum_lost: 1.3 },
    })
  })

  it('maps a quarterback pass line', () => {
    const row = toRow(allen, 2026)
    expect(row.stats.pass_yd).toBe(3946.4)
    expect(row.stats.pass_td).toBe(26.3)
    expect(row.stats.pass_int).toBe(11.6)
    expect(row.team).toBe('BUF')
  })

  it('drops a player with no season projection', () => {
    expect(toRow({ player: { id: 1, fullName: 'Practice Squad', defaultPositionId: 2, proTeamId: 8, stats: [] } }, 2026)).toBeNull()
  })
})
