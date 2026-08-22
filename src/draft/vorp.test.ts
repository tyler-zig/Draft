import { describe, expect, it } from 'vitest'
import { replacementLevels, vorp, withVorp, type ProjectedPlayer } from './vorp'
import { emptySlotCounts } from './rosterNeeds'
import type { Player, SlotCounts } from '../providers/types'

function player(id: string, position: string, points: number): ProjectedPlayer {
  return { id, position, points }
}

function slots(overrides: Partial<SlotCounts>): SlotCounts {
  return { ...emptySlotCounts(), ...overrides }
}

describe('replacementLevels', () => {
  it('baselines a dedicated position past its starter count', () => {
    const pool = [
      player('qb1', 'QB', 300),
      player('qb2', 'QB', 280),
      player('qb3', 'QB', 260),
    ]
    const levels = replacementLevels(pool, slots({ QB: 1 }), 2)
    // 1 QB x 2 teams = 2 starters, so the baseline is the 3rd-ranked QB.
    expect(levels.QB).toBe(260)
  })

  it('lets the strongest RB/WR/TE claim FLEX regardless of position', () => {
    const pool = [
      player('rb1', 'RB', 200),
      player('rb2', 'RB', 150),
      player('rb3', 'RB', 100),
      player('wr1', 'WR', 190),
      player('wr2', 'WR', 140),
      player('wr3', 'WR', 90),
      player('te1', 'TE', 130),
      player('te2', 'TE', 60),
    ]
    // 1 team, 1 RB, 1 WR, 1 TE dedicated, 1 FLEX.
    const levels = replacementLevels(pool, slots({ RB: 1, WR: 1, TE: 1, FLEX: 1 }), 1)
    // Dedicated starters: rb1, wr1, te1. Remaining pool for FLEX: rb2(150),
    // wr2(140), te2(60) -- rb2 has the highest value and claims the FLEX slot.
    // RB baseline is then the next unused RB (rb3=100); WR/TE baselines are
    // their own next-unused players since neither claimed FLEX.
    expect(levels.RB).toBe(100)
    expect(levels.WR).toBe(140)
    expect(levels.TE).toBe(60)
  })

  it('counts superflex starters against the QB baseline', () => {
    const pool = [player('qb1', 'QB', 300), player('qb2', 'QB', 280), player('qb3', 'QB', 260)]
    const levels = replacementLevels(pool, slots({ QB: 1, SUPER_FLEX: 1 }), 1)
    // 1 dedicated + 1 superflex = 2 starters, baseline is the 3rd QB.
    expect(levels.QB).toBe(260)
  })

  it('falls back to the last-ranked player when the pool is thinner than starter count', () => {
    const pool = [player('k1', 'K', 100)]
    const levels = replacementLevels(pool, slots({ K: 2 }), 2)
    expect(levels.K).toBe(100)
  })
})

describe('vorp', () => {
  it('is points above the baseline', () => {
    expect(vorp(220, 'RB', { RB: 150 })).toBe(70)
  })

  it('can go negative below the baseline', () => {
    expect(vorp(90, 'RB', { RB: 150 })).toBe(-60)
  })

  it('is zero for a position with no baseline data', () => {
    expect(vorp(100, 'DEF', {})).toBe(0)
  })
})

describe('withVorp', () => {
  it('stamps VORP from projected points and leaves blanks alone', () => {
    const players = [
      { id: 'a', position: 'RB', projectedPoints: 220 },
      { id: 'b', position: 'RB', projectedPoints: 150 },
      { id: 'c', position: 'WR' },
    ] as Player[]
    const valued = withVorp(players, slots({ RB: 1 }), 1)
    expect(valued[0]?.vorp).toBe(70)
    expect(valued[1]?.vorp).toBe(0)
    expect(valued[2]?.vorp).toBeUndefined()
  })
})
