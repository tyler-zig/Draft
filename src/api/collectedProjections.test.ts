import { describe, expect, it } from 'vitest'
import { mergeCollectedProjections, parseCollectedProjections, rejectOutlierSamples, sourceLabel } from './collectedProjections'
import { volumeFormatPoints, type PlayerProjection } from './playerProjections'

function sleeper(overrides: Partial<PlayerProjection> = {}): PlayerProjection {
  return {
    sleeperId: 'gibbs',
    season: '2026',
    name: 'Jahmyr Gibbs',
    team: 'DET',
    position: 'RB',
    games: 17,
    stats: { rush_yd: 1200, rec: 40, rec_yd: 400 },
    pointsPpr: 200,
    pointsHalf: 180,
    pointsStd: 160,
    adp: null,
    adpPpr: 1.5,
    adpHalf: 1.6,
    adpStd: 1.8,
    source: 'RotoWire via Sleeper',
    updatedAt: 1,
    ...overrides,
  }
}

describe('parseCollectedProjections', () => {
  it('reads consensus rows and ignores a non-artifact payload', () => {
    expect(parseCollectedProjections([{ player_id: '1' }])).toEqual([])
    const rows = parseCollectedProjections({
      schemaVersion: 1,
      players: [{
        name: 'Jahmyr Gibbs',
        team: 'DET',
        position: 'RB',
        espnId: '4429795',
        games: 17,
        stats: { rush_yd: 1372, rec: 68 },
        pointsPpr: 360,
        pointsHalf: 326,
        pointsStd: 292,
        sourceIds: ['cbs', 'espn', 'fantasysharks'],
        sourceCount: 3,
        sources: [
          { id: 'cbs', stats: { rush_yd: 1400, rec: 80 }, games: 17 },
          { id: 'espn', stats: { rush_yd: 1372, rec: 68 }, games: 17 },
        ],
      }],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.espnId).toBe('4429795')
    expect(rows[0]?.sourceCount).toBe(3)
    expect(rows[0]?.sources).toHaveLength(2)
  })
})

describe('mergeCollectedProjections', () => {
  it('weights the collected consensus by source count and keeps Sleeper ADP', () => {
    const map = mergeCollectedProjections(
      new Map([['gibbs', sleeper()]]),
      [{
        name: 'Jahmyr Gibbs',
        team: 'DET',
        position: 'RB',
        espnId: '4429795',
        games: 17,
        stats: { rush_yd: 1600, rec: 80, rec_yd: 600 },
        pointsPpr: 400,
        pointsHalf: 360,
        pointsStd: 320,
        sourceIds: ['cbs', 'espn', 'fantasysharks'],
        sourceCount: 3,
        sources: [
          { id: 'cbs', stats: { rush_yd: 1600, rec: 80, rec_yd: 600 }, games: 17 },
          { id: 'espn', stats: { rush_yd: 1550, rec: 72, rec_yd: 540 }, games: 17 },
        ],
      }],
      '2026',
      volumeFormatPoints,
    )
    const row = map.get('gibbs')
    expect(row?.adpPpr).toBe(1.5)
    expect(row?.espnId).toBe('4429795')
    expect(row?.stats.rush_yd).toBe((1600 * 3 + 1200) / 4)
    expect(row?.stats.rec).toBe((80 * 3 + 40) / 4)
    expect(row?.source).toContain('CBS')
    expect(row?.source).toContain('RotoWire')
    expect(row?.breakdown?.map((line) => line.id)).toEqual(['cbs', 'espn', 'rotowire'])
    expect(row?.breakdown?.find((line) => line.id === 'rotowire')?.stats.rush_yd).toBe(1200)
    expect(map.get('4429795')).toBe(row)
  })

  it('drops a weekly CBS sample and rebuilds consensus from season sources', () => {
    const map = mergeCollectedProjections(
      new Map([['gibbs', sleeper()]]),
      [{
        name: 'Jahmyr Gibbs',
        team: 'DET',
        position: 'RB',
        espnId: '4429795',
        games: 9,
        stats: { rush_yd: 847, rec: 42, rec_yd: 320 },
        pointsPpr: 200,
        pointsHalf: 180,
        pointsStd: 160,
        sourceIds: ['cbs', 'espn'],
        sourceCount: 2,
        sources: [
          { id: 'cbs', stats: { rush_yd: 94, rec: 4.5, rec_yd: 39 }, games: 1 },
          { id: 'espn', stats: { rush_yd: 1600, rec: 80, rec_yd: 600 }, games: 17 },
        ],
      }],
      '2026',
      volumeFormatPoints,
    )
    const row = map.get('gibbs')
    expect(row?.stats.rush_yd).toBe((1600 + 1200) / 2)
    expect(row?.source).not.toContain('CBS')
    expect(row?.breakdown?.map((line) => line.id)).toEqual(['espn', 'rotowire'])
  })

  it('drops a FantasySharks week-1 sample that has no games column', () => {
    const map = mergeCollectedProjections(
      new Map([['gibbs', sleeper()]]),
      [{
        name: 'Jahmyr Gibbs',
        team: 'DET',
        position: 'RB',
        espnId: '4429795',
        games: 9,
        stats: { rush_yd: 831, rec: 42, rec_yd: 315 },
        pointsPpr: 200,
        pointsHalf: 180,
        pointsStd: 160,
        sourceIds: ['fantasysharks', 'espn'],
        sourceCount: 2,
        sources: [
          { id: 'fantasysharks', stats: { rush_yd: 63, rec: 3.3, rec_yd: 31 }, games: null },
          { id: 'espn', stats: { rush_yd: 1600, rec: 80, rec_yd: 600 }, games: 17 },
        ],
      }],
      '2026',
      volumeFormatPoints,
    )
    const row = map.get('gibbs')
    expect(row?.stats.rush_yd).toBe((1600 + 1200) / 2)
    expect(row?.source).not.toContain('FantasySharks')
    expect(row?.breakdown?.map((line) => line.id)).toEqual(['espn', 'rotowire'])
  })

  it('drops a source whose volume is way off the others even when games look seasonal', () => {
    const map = mergeCollectedProjections(
      new Map([['gibbs', sleeper()]]),
      [{
        name: 'Jahmyr Gibbs',
        team: 'DET',
        position: 'RB',
        espnId: '4429795',
        games: 17,
        stats: { rush_yd: 955, rec: 51, rec_yd: 392 },
        pointsPpr: 200,
        pointsHalf: 180,
        pointsStd: 160,
        sourceIds: ['cbs', 'espn', 'fantasysharks'],
        sourceCount: 3,
        sources: [
          { id: 'cbs', stats: { rush_yd: 1600, rec: 80, rec_yd: 600 }, games: 17 },
          { id: 'espn', stats: { rush_yd: 1550, rec: 72, rec_yd: 540 }, games: 17 },
          { id: 'fantasysharks', stats: { rush_yd: 90, rec: 4, rec_yd: 30 }, games: 17 },
        ],
      }],
      '2026',
      volumeFormatPoints,
    )
    const row = map.get('gibbs')
    expect(row?.stats.rush_yd).toBe((1575 * 2 + 1200) / 3)
    expect(row?.source).not.toContain('FantasySharks')
    expect(row?.breakdown?.map((line) => line.id)).toEqual(['cbs', 'espn', 'rotowire'])
  })

  it('skips a Sleeper line that is a fraction of the collected consensus', () => {
    const map = mergeCollectedProjections(
      new Map([['gibbs', sleeper({ stats: { rush_yd: 70, rec: 3, rec_yd: 25 } })]]),
      [{
        name: 'Jahmyr Gibbs',
        team: 'DET',
        position: 'RB',
        espnId: '4429795',
        games: 17,
        stats: { rush_yd: 1575, rec: 76, rec_yd: 570 },
        pointsPpr: 400,
        pointsHalf: 360,
        pointsStd: 320,
        sourceIds: ['cbs', 'espn'],
        sourceCount: 2,
        sources: [
          { id: 'cbs', stats: { rush_yd: 1600, rec: 80, rec_yd: 600 }, games: 17 },
          { id: 'espn', stats: { rush_yd: 1550, rec: 72, rec_yd: 540 }, games: 17 },
        ],
      }],
      '2026',
      volumeFormatPoints,
    )
    const row = map.get('gibbs')
    expect(row?.stats.rush_yd).toBe(1575)
    expect(row?.breakdown?.map((line) => line.id)).toEqual(['cbs', 'espn'])
  })

  it('adds a collected-only player keyed by ESPN id', () => {
    const map = mergeCollectedProjections(
      new Map(),
      [{
        name: 'Practice Body',
        team: 'CHI',
        position: 'RB',
        espnId: '99',
        games: 16,
        stats: { rush_yd: 800 },
        pointsPpr: 80,
        pointsHalf: 80,
        pointsStd: 80,
        sourceIds: ['espn'],
        sourceCount: 1,
        sources: [{ id: 'espn', stats: { rush_yd: 800 }, games: 16 }],
      }],
      '2026',
      volumeFormatPoints,
    )
    expect(map.get('99')?.source).toBe('ESPN')
    expect(map.get('99')?.stats.rush_yd).toBe(800)
  })
})

describe('rejectOutlierSamples', () => {
  it('keeps a normal three-source spread', () => {
    expect(rejectOutlierSamples([
      { id: 'cbs', stats: { rush_yd: 1200, rec: 50, rec_yd: 400 } },
      { id: 'espn', stats: { rush_yd: 1300, rec: 60, rec_yd: 450 } },
      { id: 'fantasysharks', stats: { rush_yd: 1400, rec: 70, rec_yd: 500 } },
    ]).map((row) => row.id)).toEqual(['cbs', 'espn', 'fantasysharks'])
  })
})

describe('sourceLabel', () => {
  it('names a single source and lists a consensus', () => {
    expect(sourceLabel(['rotowire'])).toBe('RotoWire via Sleeper')
    expect(sourceLabel(['cbs', 'espn'])).toBe('Consensus (CBS, ESPN)')
  })
})
