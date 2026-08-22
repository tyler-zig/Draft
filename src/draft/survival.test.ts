import { describe, expect, it } from 'vitest'
import { sampleNormal, spreadFor, survivalAdjustment, survivalProbability } from './survival'

describe('sampleNormal', () => {
  it('is deterministic for an injected rng', () => {
    // u1 = u2 = 0.5 -> sqrt(2 ln 2) * cos(pi) = -sqrt(2 ln 2).
    expect(sampleNormal(() => 0.5)).toBeCloseTo(-Math.sqrt(2 * Math.log(2)), 10)
  })

  it('stays finite even when the rng pins the extremes', () => {
    expect(Number.isFinite(sampleNormal(() => 0))).toBe(true)
    expect(Number.isFinite(sampleNormal(() => 1))).toBe(true)
  })

  it('consumes two uniforms per sample', () => {
    const seen: number[] = []
    sampleNormal(() => { seen.push(0.5); return 0.5 })
    expect(seen).toHaveLength(2)
  })
})

describe('spreadFor', () => {
  it('prefers a real per-player std-dev', () => {
    expect(spreadFor({ rankStdDev: 3, rankLow: 1, rankHigh: 50 })).toBe(3)
  })

  it('falls back to a quarter of the expert range', () => {
    expect(spreadFor({ rankLow: 10, rankHigh: 18 })).toBe(2)
  })

  it('is null with no usable spread data', () => {
    expect(spreadFor({})).toBeNull()
    expect(spreadFor({ rankLow: 10, rankHigh: 10 })).toBeNull()
  })
})

describe('survivalProbability', () => {
  it('is about 50% right at the mean', () => {
    expect(survivalProbability(20, 5, 20)).toBeCloseTo(0.5, 1)
  })

  it('is high when the next pick is well before the mean', () => {
    expect(survivalProbability(40, 5, 22)).toBeGreaterThan(0.99)
  })

  it('is low when the next pick is well after the mean', () => {
    expect(survivalProbability(10, 5, 30)).toBeLessThan(0.01)
  })

  it('degenerates to a step function at zero spread', () => {
    expect(survivalProbability(20, 0, 19)).toBe(1)
    expect(survivalProbability(20, 0, 21)).toBe(0)
  })

  it('stays within [0, 1]', () => {
    expect(survivalProbability(1, 1, 1000)).toBeGreaterThanOrEqual(0)
    expect(survivalProbability(1000, 1, 1)).toBeLessThanOrEqual(1)
  })
})

describe('survivalAdjustment', () => {
  it('boosts a player who will almost certainly be gone', () => {
    const adj = survivalAdjustment(0.05)
    expect(adj.delta).toBeCloseTo(38, 5)
    expect(adj.reason).toBe('95% gone by next pick')
  })

  it('discounts a player who will almost certainly last', () => {
    const adj = survivalAdjustment(0.95)
    expect(adj.delta).toBeLessThan(0)
    expect(adj.reason).toBeNull()
  })
})
