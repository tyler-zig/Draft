import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ESPN_BRIDGE_SOURCE } from './mapEspn'
import { ESPN_PRACTICE_LOBBY_URL, espnDraftPageUrl, parseEspnRef } from './bridge'

describe('parseEspnRef', () => {
  it('reads a practice draft room URL', () => {
    const ref = parseEspnRef('https://fantasy.espn.com/football/draft?leagueId=999&seasonId=2026&teamId=3')
    expect(ref).toMatchObject({ leagueId: '999', season: '2026', teamId: '3' })
  })

  it('builds a draft-room URL for the cloned practice league', () => {
    expect(espnDraftPageUrl('999', '2026', '3')).toBe(
      'https://fantasy.espn.com/football/draft?leagueId=999&seasonId=2026&teamId=3',
    )
    expect(ESPN_PRACTICE_LOBBY_URL).toContain('mockdraftlobby')
  })
})

describe('ESPN app bridge rehydration', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('publishes suggested picks for the ESPN overlay', async () => {
    const post = vi.spyOn(window, 'postMessage')
    const { publishEspnSuggestions } = await import('./bridge')

    publishEspnSuggestions({
      leagueId: '10',
      season: '2026',
      teamId: '1',
      currentPickNo: 4,
      until: 0,
      youAreOnClock: true,
      pickStamp: '3:9:3',
      recs: [{ id: '9', name: 'Star Back', position: 'RB', team: 'SF', reason: 'Fill RB', rank: 4 }],
    })

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'draft-assistant-app',
        type: 'PUBLISH_ESPN_SUGGESTIONS',
        payload: expect.objectContaining({ leagueId: '10', youAreOnClock: true }),
      }),
      '*',
    )
  })

  it('asks the extension to refresh a league tab and come back', async () => {
    const post = vi.spyOn(window, 'postMessage')
    const { requestOpenEspn } = await import('./bridge')

    requestOpenEspn({ leagueId: '123', season: '2026', teamId: '7', page: 'team', returnToApp: true })

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'draft-assistant-app',
        type: 'OPEN_ESPN',
        leagueId: '123',
        returnToApp: true,
      }),
      '*',
    )
  })

  it('explicitly asks the extension to resend its stored snapshot', async () => {
    const post = vi.spyOn(window, 'postMessage')
    const { requestEspnSnapshot } = await import('./bridge')

    requestEspnSnapshot()

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'draft-assistant-app', type: 'GET_ESPN_SNAPSHOT' }),
      '*',
    )
  })

  it('requests an explicit practice exit', async () => {
    const post = vi.spyOn(window, 'postMessage')
    const bridge = await import('./bridge')
    bridge.ingestEspnBridgeMessage({
      source: ESPN_BRIDGE_SOURCE,
      snapshot: {
        leagueId: '999',
        fetchedAt: 1,
        league: { settings: { name: 'Practice Draft for The Best League' } },
      },
    })

    bridge.requestExitEspnPractice()

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'draft-assistant-app', type: 'EXIT_ESPN_PRACTICE' }),
      '*',
    )
    expect(bridge.getEspnSnapshot()).toBeNull()
  })

  it('restores the last usable snapshot after the app module reloads', async () => {
    const first = await import('./bridge')
    first.ingestEspnBridgeMessage({
      source: ESPN_BRIDGE_SOURCE,
      type: 'STATUS',
      snapshot: { leagueId: '123', season: '2026', fetchedAt: 1, league: { id: 123 }, players: [] },
    })

    vi.resetModules()
    const restored = await import('./bridge')

    expect(restored.getEspnSnapshot()?.leagueId).toBe('123')
  })

  it('does not let a practice clone overwrite the saved real league', async () => {
    const bridge = await import('./bridge')
    bridge.ingestEspnBridgeMessage({
      source: ESPN_BRIDGE_SOURCE,
      snapshot: { leagueId: '123', season: '2026', fetchedAt: 1, league: { id: 123 } },
    })
    bridge.ingestEspnBridgeMessage({
      source: ESPN_BRIDGE_SOURCE,
      snapshot: {
        leagueId: '650239158',
        season: '2026',
        fetchedAt: 2,
        isPractice: true,
        league: { id: 650239158, settings: { leagueSubType: 'CUSTOM_MOCK' } },
      },
    })

    expect(bridge.getEspnSnapshot()?.leagueId).toBe('650239158')

    vi.resetModules()
    const restored = await import('./bridge')
    expect(restored.getEspnSnapshot()?.leagueId).toBe('123')
  })

  it('restores the saved league after a dead practice room errors', async () => {
    const bridge = await import('./bridge')
    bridge.ingestEspnBridgeMessage({
      source: ESPN_BRIDGE_SOURCE,
      snapshot: { leagueId: '123', season: '2026', fetchedAt: 1, league: { id: 123 } },
    })
    bridge.ingestEspnBridgeMessage({
      source: ESPN_BRIDGE_SOURCE,
      snapshot: { leagueId: '650239158', error: 'ESPN 401', fetchedAt: 3 },
    })

    expect(bridge.getEspnSnapshot()?.leagueId).toBe('123')
  })

  it('does not let a delayed empty reply erase a usable snapshot', async () => {
    const bridge = await import('./bridge')
    bridge.ingestEspnBridgeMessage({
      source: ESPN_BRIDGE_SOURCE,
      snapshot: { leagueId: '456', fetchedAt: 2, league: { id: 456 } },
    })
    bridge.ingestEspnBridgeMessage({ source: ESPN_BRIDGE_SOURCE, snapshot: null })

    expect(bridge.isEspnBridgeHydrated()).toBe(true)
    expect(bridge.getEspnSnapshot()?.leagueId).toBe('456')
  })

  it('does clear the live clone for an explicit practice exit', async () => {
    const bridge = await import('./bridge')
    bridge.ingestEspnBridgeMessage({
      source: ESPN_BRIDGE_SOURCE,
      snapshot: { leagueId: '999', isPractice: true, fetchedAt: 2, league: { id: 999 } },
    })
    bridge.ingestEspnBridgeMessage({
      source: ESPN_BRIDGE_SOURCE,
      exitedPractice: true,
      snapshot: null,
    })

    expect(bridge.getEspnSnapshot()).toBeNull()
  })
})
