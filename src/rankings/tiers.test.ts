import { describe, expect, it } from 'vitest'
import { assignTiers, shownTier, tierColorClass } from './tiers'

describe('assignTiers', () => {
  it('keeps overlapping expert ranges in the same tier', () => {
    const tiers = assignTiers([
      { id: 'a', position: 'RB', rank: 1, rankLow: 1, rankHigh: 3 },
      { id: 'b', position: 'RB', rank: 2, rankLow: 1, rankHigh: 4 },
      // c's best expert rank (5) is still worse than b's worst (4), so no
      // expert disagreement bridges the gap -- real tier break.
      { id: 'c', position: 'RB', rank: 6, rankLow: 5, rankHigh: 7 },
    ])
    expect(tiers.get('a')).toBe(1)
    expect(tiers.get('b')).toBe(1)
    expect(tiers.get('c')).toBe(2)
  })

  it('numbers tiers independently per position', () => {
    const tiers = assignTiers([
      { id: 'rb1', position: 'RB', rank: 1, rankLow: 1, rankHigh: 1 },
      { id: 'rb2', position: 'RB', rank: 20, rankLow: 20, rankHigh: 20 },
      { id: 'wr1', position: 'WR', rank: 2, rankLow: 2, rankHigh: 2 },
      { id: 'wr2', position: 'WR', rank: 30, rankLow: 30, rankHigh: 30 },
    ])
    expect(tiers.get('rb1')).toBe(1)
    expect(tiers.get('rb2')).toBe(2)
    expect(tiers.get('wr1')).toBe(1)
    expect(tiers.get('wr2')).toBe(2)
  })

  it('falls back to an adaptive rank gap without spread data', () => {
    const tiers = assignTiers([
      { id: 'a', position: 'QB', rank: 1, rankLow: null, rankHigh: null },
      { id: 'b', position: 'QB', rank: 2, rankLow: null, rankHigh: null },
      { id: 'c', position: 'QB', rank: 3, rankLow: null, rankHigh: null },
      // A big jump after a tight cluster reads as a real break.
      { id: 'd', position: 'QB', rank: 15, rankLow: null, rankHigh: null },
    ])
    expect(tiers.get('a')).toBe(1)
    expect(tiers.get('b')).toBe(1)
    expect(tiers.get('c')).toBe(1)
    expect(tiers.get('d')).toBe(2)
  })

  it('does not treat a point estimate as expert spread', () => {
    const tiers = assignTiers([
      { id: 'a', position: 'RB', rank: 1, rankLow: 1, rankHigh: 1 },
      { id: 'b', position: 'RB', rank: 2, rankLow: 2, rankHigh: 2 },
      { id: 'c', position: 'RB', rank: 3, rankLow: 3, rankHigh: 3 },
      { id: 'd', position: 'RB', rank: 20, rankLow: 20, rankHigh: 20 },
    ])
    expect(tiers.get('a')).toBe(1)
    expect(tiers.get('b')).toBe(1)
    expect(tiers.get('c')).toBe(1)
    expect(tiers.get('d')).toBe(2)
  })

  it('excludes unranked players entirely', () => {
    const tiers = assignTiers([
      { id: 'a', position: 'RB', rank: 1, rankLow: 1, rankHigh: 1 },
      { id: 'unranked', position: 'RB', rank: 9999, rankLow: null, rankHigh: null },
    ])
    expect(tiers.has('unranked')).toBe(false)
    expect(tiers.get('a')).toBe(1)
  })
})

describe('shownTier', () => {
  it('keeps a published or clustered tier instead of inventing one from overall rank', () => {
    expect(shownTier({ searchRank: 40, tier: 1 })).toBe(1)
    expect(shownTier({ searchRank: 4, tier: 8 })).toBe(8)
  })

  it('does not treat an unranked player as Tier 1', () => {
    expect(shownTier({ searchRank: 0, tier: null }, 30)).toBe(2)
    expect(shownTier({ searchRank: 9999, tier: null }, 30)).toBe(2)
  })

  it('cycles pill colors so tiers past 6 still match the draft board', () => {
    expect(tierColorClass(1)).toBe('cc-tier-1')
    expect(tierColorClass(7)).toBe('cc-tier-1')
    expect(tierColorClass(8)).toBe('cc-tier-2')
  })
})
