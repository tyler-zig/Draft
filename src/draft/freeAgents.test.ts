import { describe, expect, it } from 'vitest'
import { demoteUnsigned, isUnsignedFreeAgent, UNSIGNED_RANK } from './freeAgents'
import type { Player } from '../providers/types'

describe('isUnsignedFreeAgent', () => {
  it('treats a blank team as unsigned, except defenses', () => {
    expect(isUnsignedFreeAgent({ team: null, position: 'WR' })).toBe(true)
    expect(isUnsignedFreeAgent({ team: '', position: 'RB' })).toBe(true)
    expect(isUnsignedFreeAgent({ team: 'DAL', position: 'WR' })).toBe(false)
    expect(isUnsignedFreeAgent({ team: null, position: 'DEF' })).toBe(false)
  })

  it('treats ESPN and dump free-agent codes as unsigned', () => {
    expect(isUnsignedFreeAgent({ team: 'FA', position: 'WR' })).toBe(true)
    expect(isUnsignedFreeAgent({ team: 'fa', position: 'RB' })).toBe(true)
    expect(isUnsignedFreeAgent({ team: 'FREE', position: 'TE' })).toBe(true)
    expect(isUnsignedFreeAgent({ team: 'Free Agent', position: 'QB' })).toBe(true)
    expect(isUnsignedFreeAgent({ team: 'FA*', position: 'WR' })).toBe(true)
  })

  it('clears leftover market and marks the player unranked', () => {
    expect(UNSIGNED_RANK).toBe(9999)
    const stripped = demoteUnsigned({
      id: 'hill',
      firstName: 'Tyreek',
      lastName: 'Hill',
      fullName: 'Tyreek Hill',
      position: 'WR',
      team: null,
      searchRank: 40,
      injuryStatus: null,
      number: null,
      yearsExp: 10,
      bye: 6,
      adp: 80,
      liveAdp: 75,
      liveAdpVsLastOne: 4,
      projectedPoints: 220,
      vorp: 40,
    } as Player)
    expect(stripped).toMatchObject({
      vorp: null,
      projectedPoints: null,
      adp: null,
      liveAdp: null,
      liveAdpVsLastOne: null,
      searchRank: UNSIGNED_RANK,
    })
  })
})
