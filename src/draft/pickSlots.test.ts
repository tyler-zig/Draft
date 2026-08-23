import { describe, expect, it } from 'vitest'
import { normalizePickSlots, occupiedPickNumbers, occupiesDraftSlot, pickTeamSlot } from './pickSlots'
import type { DraftPick, DraftSession } from '../providers/types'

const TEAMS = 4
const room = {
  teams: TEAMS,
  type: 'snake',
  pickOwners: null,
  order: Array.from({ length: TEAMS }, (_, i) => ({
    slot: i + 1, rosterId: `r${i + 1}`, userId: `u${i + 1}`,
    displayName: `T${i + 1}`, teamName: `Team ${i + 1}`, isYou: i === 0,
  })),
} as unknown as DraftSession

function pick(over: Partial<DraftPick>): DraftPick {
  return { playerId: 'p', pickedByUserId: null, rosterId: null, round: 1, draftSlot: 1, pickNo: 1, isKeeper: false, meta: null, ...over }
}

describe('pickTeamSlot', () => {
  it('trusts the provider roster id over the reported slot', () => {
    // ESPN reports draftSlot as roundPickNumber when it cannot match the team;
    // in a snake's even rounds that is the reversed position.
    expect(pickTeamSlot(pick({ rosterId: 'r1', draftSlot: 4, pickNo: 5, round: 2 }), room)).toBe(1)
    expect(pickTeamSlot(pick({ rosterId: 'r4', draftSlot: 1, pickNo: 8, round: 2 }), room)).toBe(4)
  })

  it('falls back to the slot implied by the overall pick number', () => {
    // Round 2 of a 4-team snake runs 8,7,6,5 for slots 1..4.
    expect(pickTeamSlot(pick({ rosterId: null, draftSlot: 1, pickNo: 5 }), room)).toBe(4)
    expect(pickTeamSlot(pick({ rosterId: null, draftSlot: 4, pickNo: 8 }), room)).toBe(1)
  })

  it('keeps the reported slot for an off-board keeper with no roster id', () => {
    expect(pickTeamSlot(pick({ rosterId: null, draftSlot: 3, pickNo: 0 }), room)).toBe(3)
  })

  it('ignores a roster id that is not in this room', () => {
    expect(pickTeamSlot(pick({ rosterId: 'someone-else', draftSlot: 2, pickNo: 5 }), room)).toBe(4)
  })
})

describe('normalizePickSlots', () => {
  it('reassigns picks to the team that actually owns them', () => {
    const picks = [
      pick({ playerId: 'a', rosterId: 'r1', pickNo: 1, round: 1, draftSlot: 1 }),
      pick({ playerId: 'b', rosterId: 'r1', pickNo: 8, round: 2, draftSlot: 4 }),
      pick({ playerId: 'c', rosterId: 'r4', pickNo: 4, round: 1, draftSlot: 4 }),
      pick({ playerId: 'd', rosterId: 'r4', pickNo: 5, round: 2, draftSlot: 1 }),
    ]
    const fixed = normalizePickSlots(picks, room)
    const slotOf = (id: string) => fixed.find((p) => p.playerId === id)?.draftSlot
    expect(slotOf('a')).toBe(1)
    expect(slotOf('b')).toBe(1)
    expect(slotOf('c')).toBe(4)
    expect(slotOf('d')).toBe(4)
    // Team 1's roster is now its own two picks, not one of each.
    expect(fixed.filter((p) => p.draftSlot === 1).map((p) => p.playerId)).toEqual(['a', 'b'])
  })

  it('returns the same array when nothing needed changing', () => {
    const picks = [pick({ rosterId: 'r1', pickNo: 1, draftSlot: 1 })]
    expect(normalizePickSlots(picks, room)).toBe(picks)
  })

  it('leaves picks alone without a room', () => {
    const picks = [pick({ draftSlot: 3 })]
    expect(normalizePickSlots(picks, undefined)).toBe(picks)
  })
})

describe('existing slot arithmetic still holds', () => {
  it('treats off-board keepers as occupying nothing', () => {
    expect(occupiesDraftSlot(pick({ pickNo: 0 }))).toBe(false)
    expect(occupiesDraftSlot(pick({ pickNo: 3 }))).toBe(true)
    expect([...occupiedPickNumbers([pick({ pickNo: 0 }), pick({ pickNo: 3 })])]).toEqual([3])
  })
})
