import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDraft, getDraftTradedPicks, getLeague, getLeagueUsers, getNflPlayers, sleeperAvatarUrl } from '../api/sleeper'
import { mapSleeperPlayer, parsePlayoffWeeks, resolveSleeperDraftLink, sleeperProvider } from './sleeperProvider'
import { readPlayerCacheEntry, writePlayerCache } from '../api/playerCache'

vi.mock('../api/playerCache', () => ({
  readPlayerCacheEntry: vi.fn(),
  writePlayerCache: vi.fn(async () => {}),
}))
vi.mock('../api/sleeper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/sleeper')>()),
  getNflPlayers: vi.fn(),
  getDraft: vi.fn(),
  getLeague: vi.fn(),
  getLeagueUsers: vi.fn(),
  getDraftTradedPicks: vi.fn(),
}))

describe('player directory freshness', () => {
  const cached = [{ id: '1', fullName: 'Cached Back', position: 'RB', searchRank: 1 }]

  beforeEach(() => {
    vi.mocked(readPlayerCacheEntry).mockReset()
    vi.mocked(writePlayerCache).mockClear()
    vi.mocked(getNflPlayers).mockReset()
    vi.mocked(getNflPlayers).mockResolvedValue({ '9': { full_name: 'Fetched Back', position: 'RB', active: true } })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('fetches when there is nothing cached', async () => {
    vi.mocked(readPlayerCacheEntry).mockResolvedValue(null)
    await expect(sleeperProvider.getPlayers()).resolves.toMatchObject([{ fullName: 'Fetched Back' }])
    expect(getNflPlayers).toHaveBeenCalledTimes(1)
  })

  it('serves a fresh cache without touching the network', async () => {
    vi.mocked(readPlayerCacheEntry).mockResolvedValue({ players: cached as never, stale: false })
    await expect(sleeperProvider.getPlayers()).resolves.toEqual(cached)
    expect(getNflPlayers).not.toHaveBeenCalled()
  })

  it('serves a stale cache immediately and refreshes behind it', async () => {
    vi.mocked(readPlayerCacheEntry).mockResolvedValue({ players: cached as never, stale: true })
    await expect(sleeperProvider.getPlayers()).resolves.toEqual(cached)
    expect(getNflPlayers).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(writePlayerCache).toHaveBeenCalled())
  })

  it('keeps serving a stale cache when the background refresh fails', async () => {
    vi.mocked(readPlayerCacheEntry).mockResolvedValue({ players: cached as never, stale: true })
    vi.mocked(getNflPlayers).mockRejectedValue(new Error('offline'))
    await expect(sleeperProvider.getPlayers()).resolves.toEqual(cached)
  })

  it('shares one refresh between concurrent callers', async () => {
    vi.mocked(readPlayerCacheEntry).mockResolvedValue(null)
    await Promise.all([sleeperProvider.getPlayers(), sleeperProvider.getPlayers()])
    expect(getNflPlayers).toHaveBeenCalledTimes(1)
  })
})

describe('Sleeper player mapping', () => {
  it('retains sourced profile measurements and stable ids', () => {
    const player = mapSleeperPlayer('4046', {
      first_name: 'Test', last_name: 'Runner', position: 'RB', active: true,
      age: 27, height: "5'11\"", weight: '214', depth_chart_order: 1,
      depth_chart_position: 'RB', espn_id: 123, gsis_id: '00-003',
      sportradar_id: 'sr-1', fantasy_data_id: 77,
    })
    expect(player).toMatchObject({
      age: 27, height: "5'11\"", weight: 214, depthChartOrder: 1,
      depthChartPosition: 'RB', espnId: '123', gsisId: '00-003',
      sportradarId: 'sr-1', fantasyDataId: '77',
    })
  })

  it('uses null rather than inventing missing measurements', () => {
    expect(mapSleeperPlayer('1', { full_name: 'Missing Data', position: 'WR', active: true }))
      .toMatchObject({ age: null, height: null, weight: null, depthChartOrder: null })
  })
})

describe('parsePlayoffWeeks', () => {
  const league = (settings?: Record<string, number>) => ({ settings })

  it('reads the league-reported window including the championship round', () => {
    expect(parsePlayoffWeeks(league({ playoff_week_start: 15, playoff_rounds: 3 })))
      .toEqual({ start: 15, end: 17 })
    expect(parsePlayoffWeeks(league({ playoff_week_start: 14, playoff_rounds: 4 })))
      .toEqual({ start: 14, end: 17 })
  })

  it('defaults to a three-week window when the round count is not published', () => {
    expect(parsePlayoffWeeks(league({ playoff_week_start: 15 })))
      .toEqual({ start: 15, end: 17 })
  })

  it('clamps round counts to the 1-4 range and the end to week 18', () => {
    expect(parsePlayoffWeeks(league({ playoff_week_start: 17, playoff_rounds: 99 })))
      .toEqual({ start: 17, end: 18 })
    expect(parsePlayoffWeeks(league({ playoff_week_start: 17, playoff_rounds: 4 })))
      .toEqual({ start: 17, end: 18 })
  })

  it('returns null when the league does not report a playoff start', () => {
    expect(parsePlayoffWeeks(league({ playoff_rounds: 3 }))).toBeNull()
    expect(parsePlayoffWeeks(league({ playoff_week_start: 0 }))).toBeNull()
    expect(parsePlayoffWeeks(league({ playoff_week_start: 19 }))).toBeNull()
    expect(parsePlayoffWeeks(null)).toBeNull()
  })

  it('does not invent a playoff window for chopped or zero-playoff leagues', () => {
    expect(parsePlayoffWeeks(league({ playoff_week_start: 15, playoff_rounds: 3 }), 'chopped')).toBeNull()
    expect(parsePlayoffWeeks(league({ playoff_week_start: 15, playoff_teams: 0 }))).toBeNull()
  })
})

describe('sleeperProvider.getDraft', () => {
  it('wires chopped format, a live clock, and traded-pick ownership', async () => {
    vi.mocked(getDraft).mockResolvedValue({
      draft_id: 'd1',
      league_id: 'L1',
      type: 'snake',
      status: 'drafting',
      sport: 'nfl',
      season: '2026',
      start_time: 1_700_000_000_000,
      last_picked: 1_700_000_010_000,
      settings: { teams: 12, rounds: 4, pick_timer: 90, reversal_round: 3 },
      metadata: { name: 'Tuesday Chopped', scoring_type: 'ppr' },
      draft_order: { you: 1, them: 8 },
      slot_to_roster_id: { '1': 10, '8': 2, '12': 9 },
    })
    vi.mocked(getLeague).mockResolvedValue({
      league_id: 'L1',
      name: 'Tuesday Chopped',
      status: 'drafting',
      season: '2026',
      total_rosters: 12,
      draft_id: 'd1',
      avatar: null,
      roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'IR', 'IR'],
      scoring_settings: { rec: 1 },
      settings: { playoff_week_start: 15, playoff_rounds: 3, max_keepers: 0 },
    })
    vi.mocked(getLeagueUsers).mockResolvedValue([
      { user_id: 'you', display_name: 'You', avatar: null, metadata: { team_name: 'Us' } },
      { user_id: 'them', display_name: 'Them', avatar: null },
    ])
    vi.mocked(getDraftTradedPicks).mockResolvedValue([
      { season: '2026', round: 3, roster_id: 10, owner_id: 2 },
    ])

    const session = await sleeperProvider.getDraft('d1', 'you')
    expect(session).toMatchObject({
      leagueFormat: 'chopped',
      playoffWeeks: null,
      clockEndsAt: 1_700_000_100_000,
      yourSlot: 1,
      slots: { BN: 2 },
    })
    expect(session.pickOwners?.[24]).toBe(12)
    expect(session.pickOwners?.[35]).toBe(8)
  })

  it('loads a league mock from metadata.league_id and sits the only human', async () => {
    vi.mocked(getDraft).mockResolvedValue({
      draft_id: '1402482382057000960',
      league_id: null,
      type: 'snake',
      status: 'drafting',
      sport: 'nfl',
      season: '2026',
      start_time: 1_700_000_000_000,
      last_picked: 1_700_000_010_000,
      creators: ['mocker'],
      settings: { teams: 18, rounds: 14, pick_timer: 90 },
      metadata: {
        name: 'Wisconsin Dudes',
        scoring_type: 'half_ppr',
        type: 'league_mock',
        league_id: '1401696318404952064',
        league_type: '3',
      },
      draft_order: { mocker: 17 },
      slot_to_roster_id: { '17': 17 },
    })
    vi.mocked(getLeague).mockResolvedValue({
      league_id: '1401696318404952064',
      name: 'Wisconsin Dudes',
      status: 'pre_draft',
      season: '2026',
      total_rosters: 18,
      draft_id: 'real',
      avatar: null,
      roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
      scoring_settings: { rec: 0.5 },
      settings: { type: 3, last_chopped_leg: 17, playoff_week_start: 0 },
    })
    vi.mocked(getLeagueUsers).mockResolvedValue([
      { user_id: 'mocker', display_name: 'Tyler', avatar: null },
    ])
    vi.mocked(getDraftTradedPicks).mockResolvedValue([])

    const session = await sleeperProvider.getDraft('1402482382057000960', 'someone-else')
    expect(session).toMatchObject({
      isPractice: true,
      leagueId: '1401696318404952064',
      leagueFormat: 'chopped',
      scoringType: 'half_ppr',
      yourSlot: 17,
      yourUserId: 'mocker',
      teams: 18,
      rounds: 14,
    })
    expect(session.name).toContain('Mock')
    expect(session.order[0]?.displayName).toBe('CPU 1')
    expect(session.order[16]?.isYou).toBe(true)
  })
})

describe('resolveSleeperDraftLink', () => {
  it('opens a beta mock URL and uses the only seated user', async () => {
    vi.mocked(getDraft).mockResolvedValue({
      draft_id: '1402482382057000960',
      league_id: null,
      type: 'snake',
      status: 'drafting',
      sport: 'nfl',
      season: '2026',
      start_time: null,
      settings: { teams: 18 },
      metadata: { type: 'league_mock', name: 'Wisconsin Dudes' },
      draft_order: { mocker: 17 },
      slot_to_roster_id: {},
    })
    await expect(resolveSleeperDraftLink('https://sleeper.com/beta/draft/nfl/1402482382057000960'))
      .resolves.toMatchObject({
        draftId: '1402482382057000960',
        userId: 'mocker',
        isPractice: true,
      })
  })
})

describe('sleeperAvatarUrl', () => {
  it('turns a Sleeper hash into the public thumbnail URL', () => {
    expect(sleeperAvatarUrl('abc123')).toBe('https://sleepercdn.com/avatars/thumbs/abc123')
  })

  it('keeps a custom team logo that is already a URL', () => {
    expect(sleeperAvatarUrl('https://sleepercdn.com/uploads/team.png')).toBe('https://sleepercdn.com/uploads/team.png')
  })

  it('returns null when Sleeper has no image', () => {
    expect(sleeperAvatarUrl(null)).toBeNull()
    expect(sleeperAvatarUrl('')).toBeNull()
  })
})
