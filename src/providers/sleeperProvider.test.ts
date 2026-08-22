import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getNflPlayers, sleeperAvatarUrl } from '../api/sleeper'
import { mapSleeperPlayer, parsePlayoffWeeks, sleeperProvider } from './sleeperProvider'
import { readPlayerCacheEntry, writePlayerCache } from '../api/playerCache'

vi.mock('../api/playerCache', () => ({
  readPlayerCacheEntry: vi.fn(),
  writePlayerCache: vi.fn(async () => {}),
}))
vi.mock('../api/sleeper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/sleeper')>()),
  getNflPlayers: vi.fn(),
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
