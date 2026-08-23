import { beforeEach, describe, expect, it } from 'vitest'
import { clearMockLeagueSeed, loadMockLeagueSeed, mockTemplateFrom, saveMockLeagueSeed } from './mockLeague'
import type { DraftSession } from '../providers/types'

const session = {
  provider: 'sleeper', draftId: 'd1', leagueId: 'l1', name: 'Sunday Money',
  type: 'snake', status: 'pre_draft', season: '2026', scoringType: 'half_ppr',
  teams: 3, rounds: 4, pickTimer: 90,
  slots: { QB: 1, RB: 1, WR: 1, TE: 0, FLEX: 0, SUPER_FLEX: 0, K: 0, DEF: 0, BN: 1 },
  rosterPositions: ['QB', 'RB', 'WR', 'BN'],
  order: [
    { slot: 1, rosterId: 'r-88', userId: 'u1', displayName: 'Ann', teamName: 'Ann FC', isYou: false },
    { slot: 2, rosterId: 'r-91', userId: 'u2', displayName: 'You', teamName: 'My Team', isYou: true },
    { slot: 3, rosterId: 'r-14', userId: 'u3', displayName: 'Cy', teamName: 'Cy XI', isYou: false },
  ],
  yourUserId: 'u2', yourSlot: 2, startTime: null, keeperCount: 2, playoffWeeks: null,
} as unknown as DraftSession

beforeEach(() => { clearMockLeagueSeed() })

describe('mockTemplateFrom', () => {
  it('carries the room across verbatim so keeper roster ids still resolve', () => {
    const template = mockTemplateFrom(session)
    expect(template.order).toEqual(session.order)
    expect(template.order.map((slot) => slot.rosterId)).toEqual(['r-88', 'r-91', 'r-14'])
    expect(template).toMatchObject({ name: 'Sunday Money', teams: 3, rounds: 4, scoringType: 'half_ppr', yourSlot: 2, keeperCount: 2 })
  })
})

describe('mock league seed', () => {
  it('round-trips a saved seed', () => {
    saveMockLeagueSeed({ template: mockTemplateFrom(session), keepers: [{ playerId: 'p1', rosterId: 'r-91', round: 2, source: 'manual' }], costRoundPicks: true, sourceKey: 'sleeper:d1' })
    const seed = loadMockLeagueSeed()
    expect(seed?.template.name).toBe('Sunday Money')
    expect(seed?.keepers).toEqual([{ playerId: 'p1', rosterId: 'r-91', round: 2, source: 'manual' }])
    expect(seed?.costRoundPicks).toBe(true)
  })

  it('reads no seed when none was saved', () => {
    expect(loadMockLeagueSeed()).toBeNull()
  })

  it('rejects a stored value that is not a usable seed', () => {
    localStorage.setItem('draft-assistant:mock-league-seed', JSON.stringify({ template: { order: [] }, keepers: [] }))
    expect(loadMockLeagueSeed()).toBeNull()
    localStorage.setItem('draft-assistant:mock-league-seed', 'not json')
    expect(loadMockLeagueSeed()).toBeNull()
  })

  it('clears a seed so the next mock is a generated room', () => {
    saveMockLeagueSeed({ template: mockTemplateFrom(session), keepers: [], costRoundPicks: false, sourceKey: 'sleeper:d1' })
    clearMockLeagueSeed()
    expect(loadMockLeagueSeed()).toBeNull()
  })
})
