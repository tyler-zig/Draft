import { describe, expect, it } from 'vitest'
import { mapSiteLeague, mapSitePicks, mapSiteSession, parseSiteDraftId, siteDraftId } from './mapSite'
import type { SiteSnapshot } from './types'
import type { Player } from '../providers/types'

function snapshot(overrides: Partial<SiteSnapshot> = {}): SiteSnapshot {
  return {
    provider: 'yahoo',
    leagueId: '99',
    season: '2026',
    teamId: '3',
    fetchedAt: 1,
    league: {
      name: 'Gridiron',
      teamCount: 2,
      scoringType: 'ppr',
      draftType: 'snake',
      draftStatus: 'pre_draft',
      teams: [
        { id: '3', name: 'You', isYou: true, draftSlot: 1 },
        { id: '8', name: 'Them', draftSlot: 2 },
      ],
      picks: [{ playerId: '4046', playerName: 'Test Runner', teamId: '3', pickNo: 1, round: 1 }],
    },
    ...overrides,
  }
}

const player: Player = {
  id: '4046', firstName: 'Test', lastName: 'Runner', fullName: 'Test Runner', position: 'RB',
  team: 'CHI', searchRank: 8, injuryStatus: null, number: '22', yearsExp: 3, bye: 7,
  yahooId: '4046',
}

describe('site draft ids', () => {
  it('round-trips season and league', () => {
    expect(parseSiteDraftId(siteDraftId('2026', '99'))).toEqual({ season: '2026', leagueId: '99' })
  })
})

describe('mapSiteLeague', () => {
  it('keeps the detected seat', () => {
    const league = mapSiteLeague(snapshot())
    expect(league).toMatchObject({ id: '99', name: 'Gridiron', draftId: '2026:99', scoringType: 'ppr' })
    expect(league.teams?.find((team) => team.isYou)?.id).toBe('3')
  })
})

describe('mapSiteSession', () => {
  it('builds a read-only snake room from the snapshot', () => {
    const session = mapSiteSession(snapshot(), '3')
    expect(session.provider).toBe('yahoo')
    expect(session.yourSlot).toBe(1)
    expect(session.order).toHaveLength(2)
  })
})

describe('mapSitePicks', () => {
  it('matches Yahoo ids onto the Sleeper directory', () => {
    expect(mapSitePicks(snapshot(), [player])[0]).toMatchObject({ playerId: '4046', pickNo: 1, rosterId: '3' })
  })
})
