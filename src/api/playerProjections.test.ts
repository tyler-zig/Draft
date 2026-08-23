import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Player } from '../providers/types'

vi.mock('../supabase/artifacts', () => ({
  readRankingArtifact: async () => null,
}))
import {
  attachProjectedAdp,
  clearNflProjectionsCache,
  getNflProjections,
  parseSleeperProjections,
  projectedPointsFor,
  projectionAdp,
  projectionPointsPool,
  projectionSeason,
  scoreBreakdown,
  viewPlayerProjection,
  type PlayerProjection,
} from './playerProjections'

afterEach(() => {
  clearNflProjectionsCache()
  vi.unstubAllGlobals()
})

const mahomes = {
  player_id: '4046',
  season: '2026',
  season_type: 'regular',
  week: null,
  company: 'rotowire',
  last_modified: 1787298655629,
  stats: {
    gp: 17,
    pts_ppr: 286.68,
    pts_half_ppr: 286.68,
    pts_std: 286.68,
    pass_att: 555,
    rush_att: 47,
    rec: 0,
  },
}

const back = {
  player_id: 'one',
  season: '2026',
  week: null,
  company: 'rotowire',
  last_modified: 1787298655629,
  player: { first_name: 'Real', last_name: 'Player', position: 'RB', team: 'CHI' },
  stats: {
    gp: 17,
    pts_ppr: 250,
    pts_half_ppr: 230,
    pts_std: 210,
    rush_att: 280,
    rec: 40,
    rec_yd: 300,
    rush_td: 8,
    rush_yd: 1200,
  },
}

function projection(overrides: Partial<PlayerProjection> = {}): PlayerProjection {
  return {
    sleeperId: 'one',
    season: '2026',
    name: 'Real Player',
    team: 'CHI',
    position: 'RB',
    games: 17,
    stats: { gp: 17, pts_ppr: 250, pts_half_ppr: 230, pts_std: 210, rush_att: 280, rec: 40 },
    pointsPpr: 250,
    pointsHalf: 230,
    pointsStd: 210,
    adp: null,
    adpPpr: 8.4,
    adpHalf: 10.1,
    adpStd: 12.6,
    source: 'RotoWire via Sleeper',
    updatedAt: 1787298655629,
    ...overrides,
  }
}

describe('parseSleeperProjections', () => {
  it('keeps season totals keyed by Sleeper id and names RotoWire as the source', () => {
    const map = parseSleeperProjections([
      mahomes,
      { ...back, week: 1, stats: { ...back.stats, pts_ppr: 12 } },
      { player_id: 'adp-only', week: null, stats: { adp_ppr: 12.4 } },
    ], '2026')
    expect(map.size).toBe(2)
    expect(map.get('adp-only')?.adpPpr).toBe(12.4)
    expect(map.get('4046')).toMatchObject({
      sleeperId: '4046',
      games: 17,
      pointsPpr: 286.68,
      source: 'RotoWire via Sleeper',
      updatedAt: 1787298655629,
    })
    expect(map.get('4046')?.stats.pass_att).toBe(555)
  })

  it('keeps the name Sleeper prints on the projection row', () => {
    const map = parseSleeperProjections([back], '2026')
    expect(map.get('one')).toMatchObject({ name: 'Real Player', team: 'CHI', position: 'RB' })
  })

  it('keeps ADP published on the projection row and merges a separate ADP-only row', () => {
    const map = parseSleeperProjections([
      { ...mahomes, stats: { ...mahomes.stats, adp_ppr: 4.2, adp_half_ppr: 5.1, adp_std: 6.8 } },
      { player_id: 'one', week: null, stats: { adp_ppr: 12.4, adp_half_ppr: 14.1 } },
    ], '2026')
    expect(map.get('4046')?.adpPpr).toBe(4.2)
    expect(map.get('one')?.adpPpr).toBe(12.4)
    expect(map.get('one')?.pointsPpr).toBeNull()
  })
})

describe('projectionAdp', () => {
  it('uses the format-specific Sleeper ADP', () => {
    const row = projection()
    expect(projectionAdp(row, 'ppr')).toBe(8.4)
    expect(projectionAdp(row, 'half_ppr')).toBe(10.1)
    expect(projectionAdp(row, 'std')).toBe(12.6)
  })
})

describe('attachProjectedAdp', () => {
  it('fills a blank ADP and leaves a ranking-set ADP alone', () => {
    const map = new Map([['one', projection()]])
    const filled = attachProjectedAdp([
      { id: 'one', sleeperId: 'one' },
      { id: 'kept', sleeperId: 'one', adp: 3.2 },
    ] as Player[], map, 'ppr')
    expect(filled[0]?.adp).toBe(8.4)
    expect(filled[1]?.adp).toBe(3.2)
  })
})

describe('projectedPointsFor', () => {
  it('uses the scoring-format totals when the league has no custom settings', () => {
    const row = projection()
    expect(projectedPointsFor(row, 'ppr')).toBe(250)
    expect(projectedPointsFor(row, 'half_ppr')).toBe(230)
    expect(projectedPointsFor(row, 'std')).toBe(210)
  })

  it('uses published format totals for a standard half-PPR league instead of a partial settings recompute', () => {
    const row = projection()
    expect(projectedPointsFor(row, 'half_ppr', {
      rec: 0.5, rec_yd: 0.1, rec_td: 6, rush_yd: 0.1, rush_td: 6, pass_yd: 0.04, pass_td: 4, pass_int: -1, fum_lost: -2, sack: 1, int: 2,
    })).toBe(230)
    expect(projectedPointsFor(row, 'half_ppr', { rec: 0.5 })).toBe(230)
  })

  it('recomputes from scoring settings when the league uses custom rates', () => {
    const row = projection({ stats: { rec: 40, rec_yd: 300, rec_td: 1, rush_td: 8, rush_yd: 1200, pts_ppr: 250, pts_half_ppr: 230, pts_std: 210 } })
    expect(projectedPointsFor(row, 'ppr', { rec: 1, rec_yd: 0.1, rec_td: 6, rush_td: 6, rush_yd: 0.1, pass_td: 6, pass_yd: 0.04, pass_int: -1 })).toBe(40 + 30 + 6 + 48 + 120)
  })

  it('falls back to the format total when settings do not overlap projection stats', () => {
    expect(projectedPointsFor(projection(), 'std', { bonus_rec_te: 0.5 })).toBe(210)
  })

  it('applies a position reception premium to standard points', () => {
    expect(projectedPointsFor(projection(), 'ppr', null, 0.5)).toBe(230)
  })
})

describe('viewPlayerProjection', () => {
  it('looks up by sleeper id and leaves unmatched players unavailable', () => {
    const map = new Map([['one', projection()]])
    expect(viewPlayerProjection({ id: 'one', sleeperId: 'one' }, map, 'ppr')).toMatchObject({
      points: 250,
      ppg: 250 / 17,
      rushAttempts: 280,
      receptions: 40,
      targets: null,
      source: 'RotoWire via Sleeper',
      breakdown: [],
    })
    expect(viewPlayerProjection({ id: 'two', sleeperId: 'two' }, map, 'ppr')).toBeNull()
  })
})

describe('scoreBreakdown', () => {
  it('scores each source line with the league format', () => {
    const row = projection({
      breakdown: [
        { id: 'cbs', label: 'CBS', stats: { rush_yd: 1000, rec: 40, rec_yd: 400 }, games: 17, points: null },
        { id: 'espn', label: 'ESPN', stats: { rush_yd: 1200, rec: 50, rec_yd: 500 }, games: 17, points: null },
      ],
    })
    const lines = scoreBreakdown(row, 'ppr')
    expect(lines[0]?.points).toBe(180)
    expect(lines[1]?.points).toBe(220)
  })
})

describe('projectionPointsPool', () => {
  it('emits sleeper-id entries scored to the league format', () => {
    const map = parseSleeperProjections([back], '2026')
    expect(projectionPointsPool(map, 'ppr')).toEqual([
      { gsisId: null, espnId: null, sleeperId: 'one', name: 'Real Player', position: 'RB', points: 250 },
    ])
  })
})

describe('getNflProjections', () => {
  it('fetches the Sleeper season projection endpoint and caches the result', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([mahomes]), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const first = await getNflProjections('2026')
    const second = await getNflProjections('2026')
    expect(first.get('4046')?.pointsPpr).toBe(286.68)
    expect(second).toBe(first)
    const requested = fetchMock.mock.calls.map((call) => String(call.at(0) ?? ''))
    const sleeperCalls = requested.filter((url) => url.includes('/sleeper/projections/nfl/2026'))
    expect(sleeperCalls).toHaveLength(6)
    expect(sleeperCalls.every((url) => url.includes('position='))).toBe(true)
    expect(requested.some((url) => url.includes('position[]'))).toBe(false)
  })
})

describe('projectionSeason', () => {
  it('keeps a plausible season year and otherwise uses the current UTC year', () => {
    expect(projectionSeason('2026')).toBe('2026')
    expect(projectionSeason('nope')).toBe(String(new Date().getUTCFullYear()))
  })
})
