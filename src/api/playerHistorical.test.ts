import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Player } from '../providers/types'
import { clearHistoricalArtifactCache, getPlayerHistoricalIntelligence, getProjectedPointsPool, getPublishedSchedule, getPublishedScheduleModel } from './playerHistorical'
import { SHARD_COUNT, SHARD_INDEX_PATH, shardFor, shardPath } from '../intelligence/shards'

function matchupArtifact() {
  return {
    schemaVersion: 1, generatedAt: '2026-08-22T00:00:00Z', attribution: 'Data: nflverse', methodology: {},
    players: [{ ids: { gsis: 'g', espn: '42', sleeper: '77', pfr: null }, name: 'Real Player', team: 'CHI', position: 'RB', seasons: [{ season: 2025 }] }],
    schedule: { season: 2026, source: 'nflverse', updatedAt: '2026-08-22T00:00:00Z', teams: { CHI: [{ week: 1, opponent: 'MIN', home: true, bye: false, completed: false }] } },
    matchups: {
      window: { priorSeason: 2025, currentSeason: 2026, currentGames: 0, priorWeight: 1, currentWeight: 0, minSample: 4 },
      byScoring: { ppr: { RB: { MIN: { team: 'MIN', rank: 6, pointsAllowed: 24, games: 17 } } }, half: { RB: {} }, standard: { RB: {} } },
      strengthOfSchedule: { ppr: { RB: { CHI: { team: 'CHI', rank: 9, averageMatchupRank: 6, remainingGames: 1 } } }, half: { RB: {} }, standard: { RB: {} } },
    },
  }
}

const player: Player = { id: 'draft', sleeperId: '77', espnId: '42', firstName: 'Real', lastName: 'Player', fullName: 'Real Player', position: 'RB', team: 'CHI', searchRank: 1, injuryStatus: null, number: null, yearsExp: null, bye: null }

afterEach(() => { clearHistoricalArtifactCache(); vi.unstubAllGlobals() })

describe('historical player intelligence loader', () => {
  it('matches stable provider ids and retains source metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 1, generatedAt: '2026-08-22T00:00:00Z', attribution: 'Data: nflverse', methodology: { touchShare: 'documented' }, players: [{ ids: { gsis: 'g', espn: '42', sleeper: '77', pfr: null }, name: 'Real Player', team: 'CHI', position: 'RB', seasons: [{ season: 2025 }] }] }), { status: 200 })))
    const result = await getPlayerHistoricalIntelligence(player)
    expect(result).toMatchObject({ source: 'Data: nflverse', updatedAt: '2026-08-22T00:00:00Z', message: null, seasons: [{ season: 2025 }], espnId: '42' })
    expect(result.scheduleModel).toBeNull()
  })

  it('resolves the current team schedule and scoring-aware matchup ranks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(matchupArtifact()), { status: 200 })))
    const result = await getPlayerHistoricalIntelligence(player, undefined, 'ppr')
    expect(result.schedule).toMatchObject({ team: 'CHI', upcoming: [{ week: 1, opponent: 'MIN', matchupRank: 6 }], strengthOfSchedule: { rank: 9 } })
    await expect(getPublishedSchedule()).resolves.toMatchObject({ CHI: [{ week: 1, opponent: 'MIN' }] })
  })

  it('reads schedule and matchups from the small schedule artifact', async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('schedule.json')) return new Response(JSON.stringify(matchupArtifact()), { status: 200 })
      return new Response('should not load player history', { status: 500 })
    })
    vi.stubGlobal('fetch', request)
    await expect(getPublishedSchedule()).resolves.toMatchObject({ CHI: [{ week: 1, opponent: 'MIN' }] })
    await expect(getPublishedScheduleModel()).resolves.toMatchObject({ season: 2026, teams: { CHI: [{ week: 1, opponent: 'MIN' }] } })
    expect(request).toHaveBeenCalled()
    expect(request.mock.calls.every(([input]) => String(input).includes('schedule.json'))).toBe(true)
  })

  it('exposes the full matchup model for room-wide playoff SoS', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(matchupArtifact()), { status: 200 })))
    const model = await getPublishedScheduleModel()
    expect(model).toMatchObject({ season: 2026, teams: { CHI: [{ week: 1, opponent: 'MIN' }] } })
    expect(model?.matchups.ppr.RB.MIN).toMatchObject({ rank: 6, pointsAllowed: 24 })
    expect(model?.strengthOfSchedule.ppr.RB.CHI).toMatchObject({ rank: 9 })
  })

  it('returns null for the model when the artifact carries no matchup table', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 1, generatedAt: 'now', attribution: 'Data: nflverse', methodology: {}, players: [] }), { status: 200 })))
    await expect(getPublishedScheduleModel()).resolves.toBeNull()
  })

  it('returns an honest unavailable state when no identity matches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 1, generatedAt: 'now', attribution: 'Data: nflverse', methodology: {}, players: [] }), { status: 200 })))
    expect((await getPlayerHistoricalIntelligence(player)).message).toMatch(/No nflverse historical record/)
  })
})

describe('sharded player intelligence', () => {
  const record = { ids: { gsis: 'g', espn: '42', sleeper: '77', pfr: null }, name: 'Real Player', team: 'CHI', position: 'RB', seasons: [{ season: 2025 }] }
  const shard = shardFor('g')

  function shardedFetch(overrides: { index?: unknown } = {}) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(SHARD_INDEX_PATH)) {
        const index = 'index' in overrides ? overrides.index : {
          schemaVersion: 1, generatedAt: 'shard-time', attribution: 'Data: nflverse', methodology: { touchShare: 'documented' },
          shardCount: SHARD_COUNT,
          players: [{ g: 'g', e: '42', s: '77', n: 'real player', p: 'RB', d: shard }],
        }
        return index == null ? new Response(null, { status: 404 }) : new Response(JSON.stringify(index), { status: 200 })
      }
      if (url.includes(shardPath(shard))) return new Response(JSON.stringify({ schemaVersion: 1, players: [record] }), { status: 200 })
      if (url.includes('schedule.json')) return new Response(JSON.stringify(matchupArtifact()), { status: 200 })
      if (url.includes('latest.json')) return new Response(JSON.stringify(matchupArtifact()), { status: 200 })
      return new Response(null, { status: 404 })
    })
  }

  it('reads one player from the index and its bucket, never the whole dataset', async () => {
    const request = shardedFetch()
    vi.stubGlobal('fetch', request)
    const result = await getPlayerHistoricalIntelligence(player, undefined, 'ppr')
    expect(result).toMatchObject({ source: 'Data: nflverse', updatedAt: 'shard-time', message: null, seasons: [{ season: 2025 }], espnId: '42' })
    expect(result.schedule).toMatchObject({ team: 'CHI', upcoming: [{ week: 1, opponent: 'MIN', matchupRank: 6 }] })
    expect(request.mock.calls.some(([input]) => String(input).includes('intelligence/latest.json'))).toBe(false)
  })

  it('fetches the index and each bucket once across repeated lookups', async () => {
    const request = shardedFetch()
    vi.stubGlobal('fetch', request)
    await getPlayerHistoricalIntelligence(player)
    await getPlayerHistoricalIntelligence(player)
    const urls = request.mock.calls.map(([input]) => String(input))
    expect(urls.filter((url) => url.includes(SHARD_INDEX_PATH))).toHaveLength(1)
    expect(urls.filter((url) => url.includes(shardPath(shard)))).toHaveLength(1)
  })

  it('reports an unmatched player without downloading any bucket', async () => {
    const request = shardedFetch()
    vi.stubGlobal('fetch', request)
    const stranger: Player = { ...player, gsisId: undefined, espnId: undefined, sleeperId: undefined, fullName: 'Nobody Here' }
    expect((await getPlayerHistoricalIntelligence(stranger)).message).toMatch(/No nflverse historical record/)
    expect(request.mock.calls.some(([input]) => String(input).includes(shardPath(shard)))).toBe(false)
  })

  it('falls back to the monolithic artifact when no shard index is published', async () => {
    const request = shardedFetch({ index: null })
    vi.stubGlobal('fetch', request)
    const result = await getPlayerHistoricalIntelligence(player)
    expect(result).toMatchObject({ message: null, seasons: [{ season: 2025 }], espnId: '42' })
    expect(request.mock.calls.some(([input]) => String(input).includes('intelligence/latest.json'))).toBe(true)
  })

  it('ignores a pre-sharding artifact served at the index path', async () => {
    const request = shardedFetch({ index: matchupArtifact() })
    vi.stubGlobal('fetch', request)
    expect((await getPlayerHistoricalIntelligence(player)).seasons).toEqual([{ season: 2025 }])
    expect(request.mock.calls.some(([input]) => String(input).includes('intelligence/latest.json'))).toBe(true)
  })
})

const fullStats = {
  completions: 0, attempts: 0, passingYards: 0, passingTds: 0, interceptions: 0,
  carries: 200, rushingYards: 1000, rushingTds: 8,
  receptions: 40, targets: 50, receivingYards: 300, receivingTds: 1,
  fantasyPoints: 200, fantasyPointsPpr: 240,
}

function historicalArtifact(overrides: Partial<typeof fullStats> = {}) {
  return {
    schemaVersion: 1, generatedAt: 'now', attribution: 'Data: nflverse', methodology: {},
    players: [
      { ids: { gsis: 'g1', espn: '42', sleeper: '77', pfr: null }, name: 'Real Player', team: 'CHI', position: 'RB', seasons: [{ season: 2025, gamesPlayed: 17, stats: { ...fullStats, ...overrides } }] },
      { ids: { gsis: 'g2', espn: null, sleeper: null, pfr: null }, name: 'Injured Out', team: 'CHI', position: 'RB', seasons: [{ season: 2025, gamesPlayed: 0, stats: fullStats }] },
    ],
  }
}

describe('getProjectedPointsPool', () => {
  it('uses the format split when there are no custom scoring settings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(historicalArtifact()), { status: 200 })))
    const pool = await getProjectedPointsPool('ppr')
    expect(pool).toEqual([{ gsisId: 'g1', espnId: '42', sleeperId: '77', name: 'Real Player', position: 'RB', points: 240 }])
  })

  it('skips a player with zero games played in their latest season', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(historicalArtifact()), { status: 200 })))
    const pool = await getProjectedPointsPool('ppr')
    expect(pool.find((entry) => entry.name === 'Injured Out')).toBeUndefined()
  })

  it('recomputes from component stats when the league has custom scoring settings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(historicalArtifact()), { status: 200 })))
    // 6pt rushing TDs, 1 PPR, no other scoring -- ignores the precomputed totals entirely.
    const pool = await getProjectedPointsPool('ppr', { rush_td: 6, rec: 1 })
    // 8 rushing TDs * 6 + 40 receptions * 1 = 88
    expect(pool[0]?.points).toBe(88)
  })

  it('falls back to the format split when settings carry no stat this app can compute', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(historicalArtifact()), { status: 200 })))
    const pool = await getProjectedPointsPool('std', { bonus_rec_te: 0.5 })
    expect(pool[0]?.points).toBe(200)
  })
})
