import { describe, expect, it } from 'vitest'
import { slotsFromRosterPositions } from './rosterNeeds'

describe('slotsFromRosterPositions', () => {
  it('counts the slots a team actually drafts into', () => {
    expect(slotsFromRosterPositions([
      'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN',
    ])).toMatchObject({
      QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 3,
    })
  })

  it('does not treat IR or taxi as bench spots', () => {
    // Chopped's recommended 2 IR slots are reserve, not draft rounds.
    expect(slotsFromRosterPositions([
      'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF',
      'BN', 'BN', 'BN', 'BN', 'BN', 'BN',
      'IR', 'IR',
    ])).toMatchObject({
      QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6,
    })
  })
})
