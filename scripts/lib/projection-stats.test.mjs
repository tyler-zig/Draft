import { describe, expect, it } from 'vitest'
import { averageStats, flipLastFirst, formatPoints, pointsFromStats, seasonFor } from './projection-stats.mjs'

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

describe('seasonFor', () => {
  it('labels the fantasy season by its starting calendar year', () => {
    expect(seasonFor(new Date('2026-08-22T00:00:00Z'))).toBe(2026)
    expect(seasonFor(new Date('2026-03-01T00:00:00Z'))).toBe(2025)
  })
})
