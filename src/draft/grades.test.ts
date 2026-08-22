import { describe, expect, it } from 'vitest'
import { gradeFromZ, leagueProjections, projectedLineupPoints } from './grades'
import { defaultSlotCounts } from '../providers/types'
import type { DraftPick, Player } from '../providers/types'

function player(overrides: Partial<Player> & { id: string }): Player {
  return {
    firstName: overrides.id, lastName: '', fullName: overrides.id, position: 'RB', team: null,
    searchRank: 50, injuryStatus: null, number: null, yearsExp: null, bye: null,
    ...overrides,
  }
}

function pick(playerId: string, draftSlot: number, pickNo: number): DraftPick {
  return {
    playerId, pickedByUserId: null, rosterId: null, round: 1, draftSlot, pickNo,
    isKeeper: false, meta: null,
  }
}

describe('projectedLineupPoints', () => {
  it('sums only non-bench slots', () => {
    const slots = { ...defaultSlotCounts(), FLEX: 0, SUPER_FLEX: 0 }
    const players = [
      player({ id: 'rb1', position: 'RB', projectedPoints: 10 }),
      player({ id: 'rb2', position: 'RB', projectedPoints: 8 }),
      player({ id: 'bench-warmer', position: 'RB', projectedPoints: 99 }),
    ]
    const lineup = projectedLineupPoints(players, slots)
    // RB1 and RB2 fill the two starting RB slots; the 99-point back rides BN.
    expect(lineup.starters).toBe(2)
    expect(lineup.points).toBe(18)
    expect(lineup.covered).toBe(2)
  })

  it('counts a slot with no projection as an uncovered starter, not points', () => {
    const players = [
      player({ id: 'qb', position: 'QB', projectedPoints: 20 }),
      player({ id: 'rb', position: 'RB', projectedPoints: null }),
    ]
    const lineup = projectedLineupPoints(players, defaultSlotCounts())
    expect(lineup.points).toBe(20)
    expect(lineup.starters).toBe(2)
    expect(lineup.covered).toBe(1)
  })

  it('leaves empty slots out of starters', () => {
    const lineup = projectedLineupPoints([], defaultSlotCounts())
    expect(lineup.points).toBe(0)
    expect(lineup.starters).toBe(0)
    expect(lineup.covered).toBe(0)
  })
})

describe('leagueProjections', () => {
  it('tallies value as pickNo minus market value, positive for steals', () => {
    const players = [
      player({ id: 'steal', position: 'RB', searchRank: 30, adp: 30, projectedPoints: 15 }),
      player({ id: 'reach', position: 'WR', searchRank: 10, adp: 10, projectedPoints: 12 }),
    ]
    const byId = new Map(players.map((p) => [p.id, p]))
    const grades = leagueProjections({
      picks: [
        pick('steal', 1, 40), // drafted 10 picks after ADP -> +10
        pick('reach', 2, 4), // drafted 6 picks before ADP -> -6
      ],
      playersById: byId,
      teams: 4,
      slots: defaultSlotCounts(),
    })
    const steal = grades.find((g) => g.slot === 1)
    const reach = grades.find((g) => g.slot === 2)
    expect(steal?.valueTally).toBe(10)
    expect(reach?.valueTally).toBe(-6)
  })

  it('counts picks with no baseline and skips off-snake keepers', () => {
    const players = [
      player({ id: 'unranked', position: 'RB', searchRank: 9999 }),
      player({ id: 'valued', position: 'WR', adp: 20, searchRank: 20 }),
      player({ id: 'keeper', position: 'QB', adp: 8, searchRank: 8 }),
    ]
    const byId = new Map(players.map((p) => [p.id, p]))
    const grades = leagueProjections({
      picks: [
        pick('keeper', 1, 0), // keeper parked before the draft: no tally
        pick('unranked', 1, 12), // no market value: unvalued
        pick('valued', 1, 24), // +4
      ],
      playersById: byId,
      teams: 4,
      slots: defaultSlotCounts(),
    })
    const mine = grades.find((g) => g.slot === 1)
    expect(mine?.valueTally).toBe(4)
    expect(mine?.unvaluedPicks).toBe(1)
    expect(mine?.lineup.starters).toBe(3)
  })

  it('leaves grades null with fewer than four graded teams', () => {
    const players = [player({ id: 'a', position: 'RB', adp: 20, searchRank: 20 })]
    const byId = new Map(players.map((p) => [p.id, p]))
    const grades = leagueProjections({
      picks: [pick('a', 1, 20), pick('a', 2, 20), pick('a', 3, 20)].map((p, i) => ({ ...p, draftSlot: i + 1 })),
      playersById: byId,
      teams: 4,
      slots: defaultSlotCounts(),
    })
    expect(grades).toHaveLength(3)
    expect(grades.every((g) => g.z === null && g.grade === null)).toBe(true)
  })

  it('scores value against the room with at least four teams', () => {
    // Four teams, all taking players at their ADP except slot 1 who steals.
    const players = [
      player({ id: 's1', position: 'RB', adp: 30, searchRank: 30 }),
      player({ id: 's2', position: 'RB', adp: 30, searchRank: 30 }),
      player({ id: 's3', position: 'RB', adp: 30, searchRank: 30 }),
      player({ id: 's4', position: 'RB', adp: 30, searchRank: 30 }),
    ]
    const byId = new Map(players.map((p) => [p.id, p]))
    const grades = leagueProjections({
      picks: [
        pick('s1', 1, 40),
        pick('s2', 2, 30),
        pick('s3', 3, 30),
        pick('s4', 4, 30),
      ],
      playersById: byId,
      teams: 4,
      slots: defaultSlotCounts(),
    })
    expect(grades).toHaveLength(4)
    const steal = grades.find((g) => g.slot === 1)
    expect(steal?.grade).toBe('A')
    expect(steal?.z).toBeGreaterThan(1)
    if (!steal) return
    // Room-mates who drafted at market value sit below the steal.
    const flat = grades.filter((g) => g.slot !== 1)
    expect(flat.every((g) => g.z! < steal.z!)).toBe(true)
    expect(flat.every((g) => g.grade === flat[0]?.grade)).toBe(true)
  })

  it('gives everyone a neutral grade when tallies are identical', () => {
    const players = [player({ id: 'a', position: 'RB', adp: 20, searchRank: 20 })]
    const byId = new Map(players.map((p) => [p.id, p]))
    const grades = leagueProjections({
      picks: [1, 2, 3, 4].map((slot) => pick('a', slot, 20)),
      playersById: byId,
      teams: 4,
      slots: defaultSlotCounts(),
    })
    expect(grades.every((g) => g.z === 0 && g.grade === 'C')).toBe(true)
  })

  it('names teams from the slot map when provided', () => {
    const players = [player({ id: 'a', position: 'RB', adp: 20, searchRank: 20 })]
    const byId = new Map(players.map((p) => [p.id, p]))
    const grades = leagueProjections({
      picks: [pick('a', 1, 20)],
      playersById: byId,
      teams: 2,
      slots: defaultSlotCounts(),
      teamNameBySlot: new Map([[1, 'The Stealers']]),
    })
    expect(grades[0]?.teamName).toBe('The Stealers')
  })
})

describe('gradeFromZ', () => {
  it('draws the A/B/C/D/F boundaries', () => {
    expect(gradeFromZ(1)).toBe('A')
    expect(gradeFromZ(2.5)).toBe('A')
    expect(gradeFromZ(0.3)).toBe('B')
    expect(gradeFromZ(0.99)).toBe('B')
    expect(gradeFromZ(0)).toBe('C')
    expect(gradeFromZ(-0.3)).toBe('C')
    expect(gradeFromZ(-0.31)).toBe('D')
    expect(gradeFromZ(-1)).toBe('D')
    expect(gradeFromZ(-1.01)).toBe('F')
  })
})
