import { describe, expect, it } from 'vitest'
import { compactSnapshots, MARKET_ADP_HISTORY_START } from './ranking-history.mjs'

describe('ranking history compaction', () => {
  it('orders immutable observations, deduplicates retries, and keys players by stable id', () => {
    const player = (median, adp) => ({ name: 'Real Player', team: 'CHI', position: 'RB', espnId: '42', median, adp, best: median - 2, worst: median + 3, sampleCount: 5 })
    const result = compactSnapshots([
      { fetchedAt: 200, players: [player(8, 9)] },
      { fetchedAt: 100, players: [player(10, 11)] },
      { fetchedAt: 200, players: [player(7, 8)] },
    ])
    expect(result.snapshots).toEqual([{ at: 100 }, { at: 200 }])
    expect(result.players[0]).toMatchObject({ key: 'espn:42', espnId: '42' })
    expect(result.players[0].points.map((point) => [point.at, point.rank, point.adp])).toEqual([[100, 10, null], [200, 7, null]])
  })

  it('drops ADP and live ADP from snapshots taken before the market reset', () => {
    const player = { name: 'Real Player', team: 'CHI', position: 'RB', espnId: '42', median: 10, adp: 11, best: 8, worst: 13, sampleCount: 5 }
    const result = compactSnapshots([{
      fetchedAt: MARKET_ADP_HISTORY_START - 1,
      players: [player],
      sets: [{ id: 'fantasypros-rtadp', rows: [{ name: 'Real Player', team: 'CHI', position: 'RB', espnId: '42', adp: 83 }] }],
    }])
    expect(result.players[0].points[0]).toMatchObject({ rank: 10, adp: null, liveAdp: null })
  })

  it('records live ADP from the real-time ADP board, by ESPN id or name', () => {
    const player = (median, adp, extra = {}) => ({ name: 'Real Player', team: 'CHI', position: 'RB', espnId: '42', median, adp, best: median - 2, worst: median + 3, sampleCount: 5, ...extra })
    const rtadpSet = (rows) => ({ id: 'fantasypros-rtadp', rows })
    const start = MARKET_ADP_HISTORY_START
    const result = compactSnapshots([
      { fetchedAt: start + 100, players: [player(10, 11)], sets: [rtadpSet([{ name: 'Real Player', team: 'CHI', position: 'RB', espnId: '42', adp: 6 }])] },
      { fetchedAt: start + 200, players: [player(7, 8)], sets: [rtadpSet([{ name: 'Real Player', team: 'CHI', position: 'RB', adp: 5 }])] },
      { fetchedAt: start + 300, players: [player(6, 7)], sets: [] },
    ])
    expect(result.players[0].points.map((point) => point.liveAdp)).toEqual([6, 5, null])
  })
})
