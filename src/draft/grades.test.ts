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

function rb(id: string, points: number, adp: number): Player {
  return player({ id, position: 'RB', adp, searchRank: adp, projectedPoints: points })
}

/** Three valued picks so a four-team room is eligible to letter-grade. */
function threePicks(slot: number, ids: [string, string, string], pickNos: [number, number, number]): DraftPick[] {
  return ids.map((id, index) => pick(id, slot, pickNos[index] ?? 0))
}

describe('projectedLineupPoints', () => {
  it('starts the highest-projection players, not draft order', () => {
    const slots = { ...defaultSlotCounts(), FLEX: 0, SUPER_FLEX: 0 }
    const players = [
      player({ id: 'rb1', position: 'RB', projectedPoints: 10 }),
      player({ id: 'rb2', position: 'RB', projectedPoints: 8 }),
      player({ id: 'bench-warmer', position: 'RB', projectedPoints: 99 }),
    ]
    const lineup = projectedLineupPoints(players, slots)
    expect(lineup.starters).toBe(2)
    expect(lineup.points).toBe(109)
    expect(lineup.covered).toBe(2)
    expect(lineup.seats.filter((seat) => seat.player).map((seat) => seat.player?.id)).toEqual([
      'bench-warmer',
      'rb1',
    ])
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
    expect(lineup.seats.some((seat) => seat.player)).toBe(false)
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
        pick('steal', 1, 40),
        pick('reach', 2, 4),
      ],
      playersById: byId,
      teams: 4,
      slots: defaultSlotCounts(),
    })
    const steal = grades.find((g) => g.slot === 1)
    const reach = grades.find((g) => g.slot === 2)
    expect(steal?.valueTally).toBe(10)
    expect(reach?.valueTally).toBe(-6)
    expect(grades.every((g) => g.grade === null)).toBe(true)
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
        pick('keeper', 1, 0),
        pick('unranked', 1, 12),
        pick('valued', 1, 24),
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

  it('leaves grades null with fewer than four teams', () => {
    const players = [player({ id: 'a', position: 'RB', adp: 20, searchRank: 20 })]
    const byId = new Map(players.map((p) => [p.id, p]))
    const grades = leagueProjections({
      picks: [1, 2, 3].flatMap((slot) => threePicks(slot, ['a', 'a', 'a'], [20, 21, 22])),
      playersById: byId,
      teams: 4,
      slots: defaultSlotCounts(),
    })
    expect(grades).toHaveLength(3)
    expect(grades.every((g) => g.z === null && g.grade === null)).toBe(true)
  })

  it('leaves grades null until four teams have three picks', () => {
    const players = [1, 2, 3, 4].flatMap((slot) => [
      rb(`s${slot}a`, 20, 10),
      rb(`s${slot}b`, 18, 20),
    ])
    const byId = new Map(players.map((p) => [p.id, p]))
    const grades = leagueProjections({
      picks: [1, 2, 3, 4].flatMap((slot) => [
        pick(`s${slot}a`, slot, 10),
        pick(`s${slot}b`, slot, 20),
      ]),
      playersById: byId,
      teams: 4,
      slots: defaultSlotCounts(),
    })
    expect(grades).toHaveLength(4)
    expect(grades.every((g) => g.grade === null)).toBe(true)
  })

  it('gives everyone a neutral grade when lineups and value match', () => {
    const players = [player({ id: 'a', position: 'RB', adp: 20, searchRank: 20, projectedPoints: 12 })]
    const byId = new Map(players.map((p) => [p.id, p]))
    const grades = leagueProjections({
      picks: [1, 2, 3, 4].flatMap((slot) => threePicks(slot, ['a', 'a', 'a'], [20, 21, 22])),
      playersById: byId,
      teams: 4,
      slots: defaultSlotCounts(),
    })
    expect(grades.every((g) => g.z === 0 && g.grade === 'C')).toBe(true)
  })

  it('grades a much better lineup ahead of the room when value is flat', () => {
    const players = [
      rb('a1', 40, 10), rb('a2', 38, 20), rb('a3', 36, 30),
      rb('b1', 20, 10), rb('b2', 18, 20), rb('b3', 16, 30),
      rb('c1', 20, 10), rb('c2', 18, 20), rb('c3', 16, 30),
      rb('d1', 20, 10), rb('d2', 18, 20), rb('d3', 16, 30),
    ]
    const byId = new Map(players.map((p) => [p.id, p]))
    const grades = leagueProjections({
      picks: [
        ...threePicks(1, ['a1', 'a2', 'a3'], [10, 20, 30]),
        ...threePicks(2, ['b1', 'b2', 'b3'], [10, 20, 30]),
        ...threePicks(3, ['c1', 'c2', 'c3'], [10, 20, 30]),
        ...threePicks(4, ['d1', 'd2', 'd3'], [10, 20, 30]),
      ],
      playersById: byId,
      teams: 4,
      slots: defaultSlotCounts(),
    })
    expect(grades.find((g) => g.slot === 1)?.grade).toBe('A')
    expect(grades.filter((g) => g.slot !== 1).every((g) => g.grade === 'C')).toBe(true)
  })

  it('weights lineup over ADP value when the two disagree', () => {
    const players = [
      rb('studs1', 50, 10), rb('studs2', 48, 20), rb('studs3', 46, 30),
      rb('value1', 22, 10), rb('value2', 20, 20), rb('value3', 18, 30),
      rb('mid1', 22, 10), rb('mid2', 20, 20), rb('mid3', 18, 30),
      rb('flat1', 22, 10), rb('flat2', 20, 20), rb('flat3', 18, 30),
    ]
    const byId = new Map(players.map((p) => [p.id, p]))
    const grades = leagueProjections({
      picks: [
        ...threePicks(1, ['studs1', 'studs2', 'studs3'], [1, 2, 3]),
        ...threePicks(2, ['value1', 'value2', 'value3'], [40, 50, 60]),
        ...threePicks(3, ['mid1', 'mid2', 'mid3'], [10, 20, 30]),
        ...threePicks(4, ['flat1', 'flat2', 'flat3'], [10, 20, 30]),
      ],
      playersById: byId,
      teams: 4,
      slots: defaultSlotCounts(),
    })
    const studs = grades.find((g) => g.slot === 1)
    const value = grades.find((g) => g.slot === 2)
    expect(studs?.valueTally).toBeLessThan(0)
    expect(value?.valueTally).toBeGreaterThan(0)
    expect(studs?.lineup.points).toBeGreaterThan(value?.lineup.points ?? 0)
    expect(studs?.z ?? 0).toBeGreaterThan(value?.z ?? 0)
    expect(studs?.grade).toBe('B')
    expect(value?.grade).toBe('C')
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
    expect(gradeFromZ(0.5)).toBe('B')
    expect(gradeFromZ(0.99)).toBe('B')
    expect(gradeFromZ(0)).toBe('C')
    expect(gradeFromZ(-0.6)).toBe('C')
    expect(gradeFromZ(-0.61)).toBe('D')
    expect(gradeFromZ(-1.5)).toBe('D')
    expect(gradeFromZ(-1.51)).toBe('F')
  })
})
