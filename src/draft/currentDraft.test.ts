import { beforeEach, describe, expect, it } from 'vitest'
import { defaultSlotCounts, type DraftSession } from '../providers/types'
import { clearCurrentDraft, loadCurrentDraft, playerIntelligenceHref, saveCurrentDraft } from './currentDraft'

const session: DraftSession = {
  provider: 'espn', draftId: '2026:123', leagueId: '123', name: 'Home League', type: 'snake', status: 'drafting', season: '2026', scoringType: 'half_ppr', teams: 12, rounds: 16, pickTimer: 90, slots: defaultSlotCounts(), rosterPositions: [], order: [], yourUserId: '7', yourSlot: 4, startTime: null, receptionPremium: [{ position: 'TE', points: 1 }],
}

describe('current draft context', () => {
  beforeEach(() => localStorage.clear())

  it('restores the route and league scoring context', () => {
    const saved = saveCurrentDraft(session)
    expect(loadCurrentDraft()).toEqual(saved)
    expect(saved.href).toBe('/draft/espn/2026%3A123?userId=7')
    expect(playerIntelligenceHref(saved, 'p1')).toContain('scoring=half_ppr')
    expect(playerIntelligenceHref(saved, 'p1')).toContain('playerId=p1')
  })

  it('ignores malformed persisted state', () => {
    localStorage.setItem('draft-assistant:current-draft', '{"href":"https://evil.example"}')
    expect(loadCurrentDraft()).toBeNull()
  })

  it('clears the currently linked draft', () => {
    saveCurrentDraft(session)
    clearCurrentDraft()
    expect(loadCurrentDraft()).toBeNull()
  })
})
