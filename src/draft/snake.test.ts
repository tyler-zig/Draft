import { describe, expect, it } from 'vitest'
import {
  livePickNumber,
  nextOpenPickNumber,
  nextPickNumberForSlot,
  ownerSlotForPick,
  pickNumberFor,
  picksUntilSlot,
} from './snake'

describe('snake arithmetic with no published board', () => {
  it('walks odd rounds forward and even rounds back', () => {
    expect(ownerSlotForPick(1, 12, 'snake').slot).toBe(1)
    expect(ownerSlotForPick(12, 12, 'snake').slot).toBe(12)
    expect(ownerSlotForPick(13, 12, 'snake').slot).toBe(12)
    expect(ownerSlotForPick(24, 12, 'snake').slot).toBe(1)
  })

  it('runs a linear draft in the same order every round', () => {
    expect(ownerSlotForPick(13, 12, 'linear').slot).toBe(1)
  })
})

describe('a published board that is not a plain snake', () => {
  // The real 12-team ESPN keeper draft this was written for: rounds 1-3 (the
  // keeper rounds) and round 4 all run in straight draft order, and the board
  // only starts reversing at round 5. Odd/even parity agrees with ESPN in
  // rounds 1 and 3 and mirrors every other round.
  const TEAMS = 12
  const FORWARD = new Set([1, 2, 3, 4, 6, 8, 10, 12, 14])
  const owners: number[] = []
  for (let round = 1; round <= 15; round += 1) {
    for (let index = 0; index < TEAMS; index += 1) {
      owners.push(FORWARD.has(round) ? index + 1 : TEAMS - index)
    }
  }
  // What the three keepers cost slot 9, per ESPN's own pick numbers.
  const keepers = new Set([9, 21, 33])

  it('reports the picks slot 9 really owns', () => {
    const yours: number[] = []
    for (let pick = 1; pick <= 180; pick += 1) {
      if (ownerSlotForPick(pick, TEAMS, 'snake', owners).slot === 9) yours.push(pick)
    }
    expect(yours.slice(0, 7)).toEqual([9, 21, 33, 45, 52, 69, 76])
  })

  it('finds the next pick past three keeper rounds', () => {
    expect(nextPickNumberForSlot(1, 9, TEAMS, 15, 'snake', keepers, owners)).toBe(45)
    // Parity alone answered 16 -- a pick slot 9 does not own.
    expect(nextPickNumberForSlot(1, 9, TEAMS, 15, 'snake', keepers)).toBe(16)
  })

  it('counts the wait to that pick', () => {
    expect(picksUntilSlot(1, 9, TEAMS, 15, 'snake', keepers, owners)).toBe(41)
    // The "14 picks until your next pick" the room used to show.
    expect(picksUntilSlot(1, 9, TEAMS, 15, 'snake', keepers)).toBe(14)
  })

  it('inverts back to the same pick numbers', () => {
    expect(pickNumberFor(1, 9, TEAMS, 'snake', owners)).toBe(9)
    expect(pickNumberFor(2, 9, TEAMS, 'snake', owners)).toBe(21)
    expect(pickNumberFor(4, 9, TEAMS, 'snake', owners)).toBe(45)
    expect(pickNumberFor(5, 9, TEAMS, 'snake', owners)).toBe(52)
  })

  it('falls back to snake math where the board says nothing', () => {
    expect(ownerSlotForPick(13, TEAMS, 'snake', null).slot).toBe(12)
    expect(ownerSlotForPick(13, TEAMS, 'snake', []).slot).toBe(12)
    // A board with holes only answers for the picks it actually covers.
    expect(ownerSlotForPick(13, TEAMS, 'snake', [null, 5]).slot).toBe(12)
    expect(ownerSlotForPick(2, TEAMS, 'snake', [null, 5]).slot).toBe(5)
    expect(pickNumberFor(2, 9, TEAMS, 'snake', [])).toBe(16)
  })
})

describe('livePickNumber', () => {
  it('starts the draft at pick 1 with only keepers on the board', () => {
    // Keepers at 9, 21 and 33 leave 1..8 open, and the draft opens at 1.
    expect(livePickNumber([9, 21, 33], 180, 0)).toBe(1)
  })

  it('steps past a pick the snapshot missed instead of stalling on it', () => {
    // 127, 140 and 143 never reached us, but the room is past 152. The old
    // "lowest open slot" answer pinned the room to 127 for the rest of the
    // draft; from the frontier the answer is the next real pick.
    const taken = new Set<number>()
    for (let pick = 1; pick <= 152; pick += 1) taken.add(pick)
    taken.delete(127)
    taken.delete(140)
    taken.delete(143)
    expect(nextOpenPickNumber(taken, 180)).toBe(127)
    expect(livePickNumber(taken, 180, 152)).toBe(153)
  })

  it('skips a keeper reserved ahead of the frontier', () => {
    const taken = new Set([1, 2, 3, 6])
    expect(livePickNumber(taken, 20, 3)).toBe(4)
    expect(livePickNumber(new Set([1, 2, 3, 4, 5, 6]), 20, 5)).toBe(7)
  })

  it('clamps to the last pick once the board is full', () => {
    const taken = new Set(Array.from({ length: 20 }, (_, i) => i + 1))
    expect(livePickNumber(taken, 20, 20)).toBe(20)
  })

  it('ignores a frontier past the end of the board', () => {
    expect(livePickNumber(new Set([1]), 12, 99)).toBe(12)
  })
})
