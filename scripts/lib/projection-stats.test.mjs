import { describe, expect, it } from 'vitest'
import { averageStats, flipLastFirst, formatPoints, isWeeklyProjection, pointsFromStats, rejectOutlierSamples, seasonFor } from './projection-stats.mjs'

describe('flipLastFirst', () => {
  it('turns Last, First into First Last and leaves forward names alone', () => {
    expect(flipLastFirst('Allen, Josh')).toBe('Josh Allen')
    expect(flipLastFirst("Fairbairn, Ka'imi")).toBe("Ka'imi Fairbairn")
    expect(flipLastFirst('Jahmyr Gibbs')).toBe('Jahmyr Gibbs')
  })
})

describe('averageStats', () => {
  it('averages only the sources that published each key', () => {
    expect(averageStats([
      { rush_yd: 1000, rec: 40 },
      { rush_yd: 1400 },
    ])).toEqual({ rush_yd: 1200, rec: 40 })
  })
})

describe('pointsFromStats', () => {
  it('scores a back with receptions at each format rate', () => {
    const stats = { rush_yd: 1200, rush_td: 8, rec: 40, rec_yd: 300, rec_td: 1 }
    expect(pointsFromStats(stats, 1)).toBe(120 + 48 + 40 + 30 + 6)
    expect(pointsFromStats(stats, 0.5)).toBe(120 + 48 + 20 + 30 + 6)
    expect(pointsFromStats(stats, 0)).toBe(120 + 48 + 0 + 30 + 6)
  })

  it('fills formatPoints for the three default reception rates', () => {
    const points = formatPoints({ rush_yd: 100, rec: 10 })
    expect(points.pointsStd).toBe(10)
    expect(points.pointsHalf).toBe(15)
    expect(points.pointsPpr).toBe(20)
  })
})

describe('isWeeklyProjection', () => {
  it('treats a 1-game CBS week-1 line as weekly and a 17-game ROS line as season', () => {
    expect(isWeeklyProjection({ games: 1, stats: { rush_yd: 94 } })).toBe(true)
    expect(isWeeklyProjection({ games: 17, stats: { rush_yd: 1436 } })).toBe(false)
    expect(isWeeklyProjection({ games: null, stats: { sack: 50 } })).toBe(false)
  })

  it('treats a FantasySharks week-1 CSV (no G column) as weekly', () => {
    expect(isWeeklyProjection({ games: null, stats: { rush_yd: 63, rec_yd: 31 } })).toBe(true)
    expect(isWeeklyProjection({ games: null, stats: { rush_yd: 1099, rec_yd: 534 } })).toBe(false)
  })
})

describe('rejectOutlierSamples', () => {
  it('drops a source that is a fraction of the others and keeps a normal spread', () => {
    const kept = rejectOutlierSamples([
      { id: 'cbs', stats: { rush_yd: 1400, rec: 80, rec_yd: 600 } },
      { id: 'espn', stats: { rush_yd: 1372, rec: 68, rec_yd: 546 } },
      { id: 'fantasysharks', stats: { rush_yd: 63, rec: 3.3, rec_yd: 31 } },
    ])
    expect(kept.map((row) => row.id)).toEqual(['cbs', 'espn'])
    expect(rejectOutlierSamples([
      { id: 'cbs', stats: { rush_yd: 1200, rec: 50, rec_yd: 400 } },
      { id: 'espn', stats: { rush_yd: 1300, rec: 60, rec_yd: 450 } },
      { id: 'fantasysharks', stats: { rush_yd: 1400, rec: 70, rec_yd: 500 } },
    ]).map((row) => row.id)).toEqual(['cbs', 'espn', 'fantasysharks'])
  })

  it('needs three sources before it will throw one out', () => {
    expect(rejectOutlierSamples([
      { id: 'cbs', stats: { rush_yd: 1400 } },
      { id: 'fantasysharks', stats: { rush_yd: 63 } },
    ]).map((row) => row.id)).toEqual(['cbs', 'fantasysharks'])
  })
})

describe('seasonFor', () => {
  it('labels the fantasy season by its starting calendar year', () => {
    expect(seasonFor(new Date('2026-08-22T00:00:00Z'))).toBe(2026)
    expect(seasonFor(new Date('2026-03-01T00:00:00Z'))).toBe(2025)
  })
})
