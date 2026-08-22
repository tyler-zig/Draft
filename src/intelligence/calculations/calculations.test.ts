import { describe, expect, it } from 'vitest'
import { calculateGamesMissed } from './durability'
import { calculateFantasyPoints } from './fantasy'
import { calculateOpportunityShares, calculateSnapShares } from './usage'

describe('player intelligence calculations', () => {
  it('calculates fantasy points for standard, half PPR, and PPR', () => {
    const line = { passingYards: 250, passingTds: 2, interceptions: 1, rushingYards: 20, receptions: 4, receivingYards: 50, receivingTds: 1, fumblesLost: 1 }
    expect(calculateFantasyPoints(line, 0)).toBe(27)
    expect(calculateFantasyPoints(line, 0.5)).toBe(29)
    expect(calculateFantasyPoints(line, 1)).toBe(31)
  })

  it('calculates fantasy-opportunity and red-zone shares', () => {
    const shares = calculateOpportunityShares([
      { playerId: 'a', team: 'CHI', carries: 10, targets: 5, week: 1 },
      { playerId: 'b', team: 'CHI', carries: 20, targets: 5, week: 1 },
    ], [
      { playerId: 'a', team: 'CHI', kind: 'carry', week: 1 },
      { playerId: 'b', team: 'CHI', kind: 'target', week: 1 },
      { playerId: 'b', team: 'CHI', kind: 'carry', week: 1 },
    ])
    expect(shares.get('a')?.touchShare).toBeCloseTo(0.375)
    expect(shares.get('a')?.redZoneTouchShare).toBeCloseTo(1 / 3)
  })

  it('weights snap share by team-game offensive snaps', () => {
    const shares = calculateSnapShares([
      { playerId: 'a', team: 'CHI', gameId: 'g1', offenseSnaps: 30 },
      { playerId: 'b', team: 'CHI', gameId: 'g1', offenseSnaps: 60 },
      { playerId: 'a', team: 'CHI', gameId: 'g2', offenseSnaps: 40 },
      { playerId: 'b', team: 'CHI', gameId: 'g2', offenseSnaps: 40 },
    ])
    expect(shares.get('a')?.snapShare).toBeCloseTo(0.7)
  })

  it('does not count byes or practice-squad weeks as missed games', () => {
    const missed = calculateGamesMissed([
      { playerId: 'a', team: 'CHI', week: 1, status: 'ACT' },
      { playerId: 'a', team: 'CHI', week: 2, status: 'ACT' },
      { playerId: 'a', team: 'CHI', week: 3, status: 'DEV' },
    ], new Set(['CHI|1', 'CHI|3']), new Set())
    expect(missed).toEqual({ gamesMissed: 1, missedWeeks: [1], byStatus: { ACT: 1 } })
  })

  it('counts a midweek team change at most once and respects participation for either team', () => {
    const roster = [
      { playerId: 'a', team: 'CHI', week: 5, status: 'ACT' },
      { playerId: 'a', team: 'GB', week: 5, status: 'ACT' },
    ]
    const games = new Set(['CHI|5', 'GB|5'])
    expect(calculateGamesMissed(roster, games, new Set())).toMatchObject({ gamesMissed: 1, missedWeeks: [5] })
    expect(calculateGamesMissed(roster, games, new Set(['a|GB|5']))).toMatchObject({ gamesMissed: 0 })
  })
})
