import { beforeEach, describe, expect, it } from 'vitest'
import {
  mergeSavedLeagues,
  parseSavedLeagues,
  removeSavedLeague,
  savedLeagueFrom,
  savedLeagueHref,
  savedLeagueKey,
  sortSavedLeagues,
  takeLegacySavedLeagues,
  upsertSavedLeague,
  type SavedLeague,
} from './savedLeagues'
import { playersHrefForSavedLeague } from './labels'
import type { LeagueSummary } from '../providers/types'

function league(overrides: Partial<SavedLeague> = {}): SavedLeague {
  return {
    provider: 'sleeper',
    leagueId: 'L1',
    season: '2026',
    name: 'Dynasty',
    draftId: 'D1',
    externalUserId: 'u1',
    teamName: 'My Team',
    scoringType: 'ppr',
    teamCount: 12,
    lastOpenedAt: 100,
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('savedLeagueKey', () => {
  it('separates the same league in two seasons', () => {
    expect(savedLeagueKey(league({ season: '2025' }))).not.toBe(savedLeagueKey(league({ season: '2026' })))
  })

  it('separates the same league id on two providers', () => {
    expect(savedLeagueKey(league({ provider: 'espn' }))).not.toBe(savedLeagueKey(league()))
  })
})

describe('sortSavedLeagues', () => {
  it('puts the most recently opened first', () => {
    const sorted = sortSavedLeagues([
      league({ leagueId: 'old', lastOpenedAt: 1 }),
      league({ leagueId: 'new', lastOpenedAt: 9 }),
    ])
    expect(sorted.map((item) => item.leagueId)).toEqual(['new', 'old'])
  })

  it('falls back to name for leagues never opened', () => {
    const sorted = sortSavedLeagues([
      league({ leagueId: 'b', name: 'Beta', lastOpenedAt: 0 }),
      league({ leagueId: 'a', name: 'Alpha', lastOpenedAt: 0 }),
    ])
    expect(sorted.map((item) => item.name)).toEqual(['Alpha', 'Beta'])
  })
})

describe('upsertSavedLeague', () => {
  it('replaces the same league rather than duplicating it', () => {
    const next = upsertSavedLeague([league()], league({ name: 'Renamed', lastOpenedAt: 200 }))
    expect(next).toHaveLength(1)
    expect(next[0]?.name).toBe('Renamed')
  })

  it('keeps a different season as its own row', () => {
    const next = upsertSavedLeague([league()], league({ season: '2025' }))
    expect(next).toHaveLength(2)
  })
})

describe('removeSavedLeague', () => {
  it('drops only the named league', () => {
    const next = removeSavedLeague([league(), league({ leagueId: 'L2' })], savedLeagueKey(league()))
    expect(next.map((item) => item.leagueId)).toEqual(['L2'])
  })
})

describe('mergeSavedLeagues', () => {
  it('keeps the more recently opened copy of a league', () => {
    const merged = mergeSavedLeagues(
      [league({ teamName: 'Local', lastOpenedAt: 500 })],
      [league({ teamName: 'Cloud', lastOpenedAt: 100 })],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.teamName).toBe('Local')
  })

  it('lets the cloud win when the cloud is newer', () => {
    const merged = mergeSavedLeagues(
      [league({ teamName: 'Local', lastOpenedAt: 100 })],
      [league({ teamName: 'Cloud', lastOpenedAt: 500 })],
    )
    expect(merged[0]?.teamName).toBe('Cloud')
  })

  it('keeps leagues only one side knows about', () => {
    const merged = mergeSavedLeagues([league({ leagueId: 'local' })], [league({ leagueId: 'cloud' })])
    expect(merged.map((item) => item.leagueId).sort()).toEqual(['cloud', 'local'])
  })
})

describe('parseSavedLeagues / takeLegacySavedLeagues', () => {
  it('sorts newest first and keeps Yahoo and NFL.com rows', () => {
    const rows = parseSavedLeagues([
      league({ leagueId: 'a', lastOpenedAt: 1 }),
      league({ provider: 'yahoo', leagueId: 'Y1', lastOpenedAt: 5 }),
      league({ provider: 'nfl', leagueId: 'N1', lastOpenedAt: 3 }),
    ])
    expect(rows.map((item) => item.provider)).toEqual(['yahoo', 'nfl', 'sleeper'])
  })

  it('ignores corrupt leftover storage instead of throwing', () => {
    localStorage.setItem('draft-assistant:saved-leagues', '{not json')
    expect(takeLegacySavedLeagues()).toEqual([])
    expect(localStorage.getItem('draft-assistant:saved-leagues')).toBeNull()
  })

  it('imports leftover device rows once, then clears the key', () => {
    localStorage.setItem('draft-assistant:saved-leagues', JSON.stringify([{ provider: 'nope' }, league()]))
    expect(takeLegacySavedLeagues()).toHaveLength(1)
    expect(takeLegacySavedLeagues()).toEqual([])
    expect(localStorage.getItem('draft-assistant:saved-leagues')).toBeNull()
  })
})

describe('savedLeagueFrom', () => {
  it('carries the summary plus your seat', () => {
    const summary: LeagueSummary = {
      id: 'L9', name: 'Work League', season: '2026', teamCount: 10, status: 'in_season',
      scoringType: 'half_ppr', draftId: 'D9', draftStatus: 'pre_draft', avatar: null,
    }
    expect(savedLeagueFrom('sleeper', summary, 'user-9', 'Team Nine', 42)).toEqual({
      provider: 'sleeper', leagueId: 'L9', season: '2026', name: 'Work League', draftId: 'D9',
      externalUserId: 'user-9', teamName: 'Team Nine', scoringType: 'half_ppr', teamCount: 10, lastOpenedAt: 42,
    })
  })
})

describe('playersHrefForSavedLeague', () => {
  it('carries scoring and draft context into Players', () => {
    expect(playersHrefForSavedLeague(league())).toBe('/players?scoring=ppr&provider=sleeper&leagueId=L1&draftId=D1')
    expect(playersHrefForSavedLeague(league({ draftId: null, scoringType: 'unknown' }))).toBe('/players')
  })
})

describe('savedLeagueHref', () => {
  it('links into the draft room with your seat', () => {
    expect(savedLeagueHref(league())).toBe('/draft/sleeper/D1?userId=u1')
    expect(savedLeagueHref(league({ provider: 'yahoo', draftId: '2026:99' }))).toBe('/draft/yahoo/2026%3A99?userId=u1')
    expect(savedLeagueHref(league({ provider: 'nfl', draftId: '2026:77' }))).toBe('/draft/nfl/2026%3A77?userId=u1')
  })

  it('has no link before the league has a draft', () => {
    expect(savedLeagueHref(league({ draftId: null }))).toBeNull()
  })
})
