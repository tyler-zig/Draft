import { describe, expect, it } from 'vitest'
import { defaultSlotCounts, type DraftPick, type DraftSlot, type Player } from '../providers/types'
import { overlayRoom } from './overlayRoom'

function player(overrides: Partial<Player> & { id: string }): Player {
  return {
    firstName: 'A', lastName: 'Back', fullName: 'A Back', position: 'RB', team: 'CHI',
    searchRank: 10, injuryStatus: null, number: null, yearsExp: null, bye: 7,
    ...overrides,
  }
}

const order: DraftSlot[] = [
  { slot: 1, rosterId: '1', userId: '1', displayName: 'You', teamName: 'Home Team', isYou: true },
  { slot: 2, rosterId: '2', userId: '2', displayName: 'Them', teamName: 'Away Club', isYou: false },
]

function pick(overrides: Partial<DraftPick> & { playerId: string }): DraftPick {
  return {
    pickedByUserId: null,
    rosterId: null,
    round: 1,
    draftSlot: 1,
    pickNo: 1,
    isKeeper: false,
    meta: null,
    ...overrides,
  }
}

describe('overlayRoom', () => {
  it('fills your starter slots and leaves the rest empty', () => {
    const room = overlayRoom({
      players: [player({ id: 'rb1' }), player({ id: 'wr1', position: 'WR', lastName: 'Wide', fullName: 'A Wide' })],
      picks: [pick({ playerId: 'rb1', draftSlot: 1, pickNo: 1, round: 1 })],
      slots: defaultSlotCounts(),
      yourSlot: 1,
      order,
      teams: 2,
      rounds: 2,
      type: 'snake',
      currentPickNo: 2,
    })

    expect(room.drafted).toBe(1)
    expect(room.roster.find((slot) => slot.key === 'RB' && slot.name === 'A Back')).toBeTruthy()
    expect(room.roster.find((slot) => slot.key === 'QB')?.name).toBeNull()
    expect(room.needs.find((need) => need.position === 'RB')).toMatchObject({ filled: 1, total: 2, tone: 'high' })
    expect(room.needs.find((need) => need.position === 'QB')).toMatchObject({ filled: 0, total: 1, tone: 'high' })
    expect(room.summary.find((row) => row.key === 'RB')).toEqual({ key: 'RB', label: 'RB', filled: 1, total: 2, open: 1 })
  })

  it('does not put another seat\'s pick on your roster', () => {
    const room = overlayRoom({
      players: [player({ id: 'theirs' })],
      picks: [pick({ playerId: 'theirs', draftSlot: 2, pickNo: 2, round: 1 })],
      slots: defaultSlotCounts(),
      yourSlot: 1,
      order,
      teams: 2,
      rounds: 1,
      type: 'snake',
      currentPickNo: 1,
    })
    expect(room.drafted).toBe(0)
    expect(room.roster.every((slot) => slot.name == null)).toBe(true)
  })

  it('builds a board with your column, the pick on the clock, and made picks', () => {
    const room = overlayRoom({
      players: [player({ id: 'rb1', lastName: 'Gibbs', fullName: 'Jahmyr Gibbs' })],
      picks: [pick({ playerId: 'rb1', draftSlot: 1, pickNo: 1, round: 1 })],
      slots: defaultSlotCounts(),
      yourSlot: 1,
      order,
      teams: 2,
      rounds: 2,
      type: 'snake',
      currentPickNo: 2,
    })

    expect(room.board.teams.map((team) => team.abbrev)).toEqual(['HT', 'AC'])
    expect(room.board.teams[0]?.you).toBe(true)
    const first = room.board.cells.find((cell) => cell.pickNo === 1)
    expect(first).toMatchObject({ last: 'Gibbs', position: 'RB', yours: true, current: false, playerId: 'rb1' })
    const clock = room.board.cells.find((cell) => cell.current)
    expect(clock).toMatchObject({ pickNo: 2, slot: 2, yours: false })
  })

  it('marks a filled flex as medium need rather than still-open', () => {
    const slots = { ...defaultSlotCounts(), RB: 1, WR: 0, TE: 0, FLEX: 1, QB: 0, K: 0, DEF: 0, BN: 0 }
    const room = overlayRoom({
      players: [player({ id: 'rb1' })],
      picks: [pick({ playerId: 'rb1' })],
      slots,
      yourSlot: 1,
      order,
      teams: 2,
      rounds: 1,
      type: 'linear',
      currentPickNo: 2,
    })
    expect(room.needs.find((need) => need.position === 'RB')).toMatchObject({ filled: 1, tone: 'med' })
  })
})
