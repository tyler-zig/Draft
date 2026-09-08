import { describe, expect, it } from 'vitest'
import { attachEspnIds, mergeProjectionSets } from './projection-consensus.mjs'

const sharks = {
  id: 'fantasysharks-rb',
  sourceId: 'fantasysharks',
  rows: [{
    name: 'Jahmyr Gibbs', team: 'DET', position: 'RB',
    games: 17, stats: { rush_yd: 1300, rec: 60, rec_yd: 500 },
  }],
}

const cbs = {
  id: 'cbs-rb',
  sourceId: 'cbs',
  rows: [{
    name: 'Jahmyr Gibbs', team: 'DET', position: 'RB',
    games: 17, stats: { rush_yd: 1400, rec: 80 },
  }],
}

const espn = {
  id: 'espn-projections',
  sourceId: 'espn',
  rows: [{
    name: 'Jahmyr Gibbs', team: 'DET', position: 'RB', espnId: '4429795',
    games: 17, stats: { rush_yd: 1372, rec: 68, rec_yd: 546 },
  }],
}

describe('mergeProjectionSets', () => {
  it('averages volume and keeps every contributing source id', () => {
    const [player] = mergeProjectionSets([sharks, cbs, espn])
    expect(player).toMatchObject({
      name: 'Jahmyr Gibbs',
      espnId: '4429795',
      sourceCount: 3,
    })
    expect(player.sourceIds).toEqual(expect.arrayContaining(['fantasysharks', 'cbs', 'espn']))
    expect(player.stats.rush_yd).toBeCloseTo((1300 + 1400 + 1372) / 3)
    expect(player.stats.rec).toBeCloseTo((60 + 80 + 68) / 3)
    expect(player.stats.rec_yd).toBeCloseTo((500 + 546) / 2)
    expect(player.pointsPpr).toBeGreaterThan(player.pointsStd)
    expect(player.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'cbs', stats: { rush_yd: 1400, rec: 80 } }),
      expect.objectContaining({ id: 'espn', stats: { rush_yd: 1372, rec: 68, rec_yd: 546 } }),
    ]))
  })

  it('drops a weekly CBS line so it cannot pull season volume down', () => {
    const [player] = mergeProjectionSets([
      sharks,
      {
        id: 'cbs-rb',
        sourceId: 'cbs',
        rows: [{
          name: 'Jahmyr Gibbs', team: 'DET', position: 'RB',
          games: 1, stats: { rush_yd: 94, rec: 4.5, rec_yd: 39 },
        }],
      },
      espn,
    ])
    expect(player.sourceIds).toEqual(expect.arrayContaining(['fantasysharks', 'espn']))
    expect(player.sourceIds).not.toContain('cbs')
    expect(player.stats.rush_yd).toBeCloseTo((1300 + 1372) / 2)
  })

  it('drops a FantasySharks week-1 line that has no games column', () => {
    const [player] = mergeProjectionSets([
      {
        id: 'fantasysharks-rb',
        sourceId: 'fantasysharks',
        rows: [{
          name: 'Jahmyr Gibbs', team: 'DET', position: 'RB',
          stats: { rush_yd: 63, rec: 3.3, rec_yd: 31 },
        }],
      },
      espn,
    ])
    expect(player.sourceIds).toEqual(['espn'])
    expect(player.stats.rush_yd).toBe(1372)
  })

  it('drops a source whose volume is way off the others even when games look seasonal', () => {
    const [player] = mergeProjectionSets([
      sharks,
      espn,
      {
        id: 'cbs-rb',
        sourceId: 'cbs',
        rows: [{
          name: 'Jahmyr Gibbs', team: 'DET', position: 'RB',
          games: 17, stats: { rush_yd: 90, rec: 4, rec_yd: 30 },
        }],
      },
    ])
    expect(player.sourceIds).toEqual(expect.arrayContaining(['fantasysharks', 'espn']))
    expect(player.sourceIds).not.toContain('cbs')
    expect(player.stats.rush_yd).toBeCloseTo((1300 + 1372) / 2)
  })

  it('does not invent a second player when only the team defense name differs', () => {
    const merged = mergeProjectionSets([
      { sourceId: 'cbs', rows: [{ name: 'SEA D/ST', team: 'SEA', position: 'DEF', stats: { sack: 40 } }] },
      { sourceId: 'espn', rows: [{ name: 'Seahawks D/ST', team: 'SEA', position: 'DEF', espnId: '-16026', stats: { sack: 50 } }] },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].stats.sack).toBe(45)
    expect(merged[0].espnId).toBe('-16026')
  })
})

describe('attachEspnIds', () => {
  it('fills a missing id from the crosswalk and leaves a present one alone', () => {
    const crosswalk = new Map([['jahmyr gibbs|DET|RB', '4429795']])
    const { attached, sets } = attachEspnIds([
      { rows: [{ name: 'Jahmyr Gibbs', team: 'DET', position: 'RB', stats: { rec: 1 } }] },
      { rows: [{ name: 'Bijan Robinson', team: 'ATL', position: 'RB', espnId: '1', stats: { rec: 1 } }] },
    ], crosswalk)
    expect(attached).toBe(1)
    expect(sets[0].rows[0].espnId).toBe('4429795')
    expect(sets[1].rows[0].espnId).toBe('1')
  })
})
