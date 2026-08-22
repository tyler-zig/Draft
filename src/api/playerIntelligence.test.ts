import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Player } from '../providers/types'
import { attachHistoryRange, clearRankingHistoryCache, getPlayerIntelligence, getPlayerMarketHistory, getPlayerNews, getRankingHistoryCatalog, lookupMarketHistory, marketHistoryMode, marketHistoryTrend, parseAthleteNews, playerIntelligenceQueryKey, rangeFromHistory, withPayloadAdpWindows } from './playerIntelligence'

const player: Player = { id: 'draft-id', espnId: '42', firstName: 'Real', lastName: 'Player', fullName: 'Real Player', position: 'RB', team: 'CHI', searchRank: 1, injuryStatus: null, number: null, yearsExp: null, bye: null }

afterEach(() => { clearRankingHistoryCache(); vi.unstubAllGlobals() })

describe('player market history', () => {
  it('resolves a player by stable id and retains only stored observations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: 1, generatedAt: 300, series: 'Collected median', players: [
        { espnId: '42', name: 'Real Player', position: 'RB', team: 'CHI', points: [{ at: 100, rank: 8, adp: 9, liveAdp: 11, low: 5, high: 12, sourceCount: 4 }, { at: 200, rank: 7, adp: null, liveAdp: null, low: 4, high: 11, sourceCount: 5 }] },
      ],
    }), { headers: { 'content-type': 'application/json' } })))
    const history = await getPlayerMarketHistory(player)
    expect(history.source).toBe('Collected median')
    expect(history.points).toEqual([
      { at: 100, rank: 8, adp: 9, liveAdp: 11, low: 5, high: 12, sourceCount: 4 },
      { at: 200, rank: 7, adp: null, liveAdp: null, low: 4, high: 11, sourceCount: 5 },
    ])
    expect(history.message).toBeNull()
  })

  it('indexes the history artifact so every player can read trend without a second fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: 1, generatedAt: 300, series: 'Collected median', players: [
        { espnId: '42', name: 'Real Player', position: 'RB', team: 'CHI', points: [{ at: 100, rank: 8, adp: 9, liveAdp: 11, low: 5, high: 12, sourceCount: 4 }, { at: 200, rank: 7, adp: 8, liveAdp: 10, low: 4, high: 11, sourceCount: 5 }] },
      ],
    }), { headers: { 'content-type': 'application/json' } })))
    const catalog = await getRankingHistoryCatalog()
    const history = lookupMarketHistory(catalog, player)
    expect(history.points).toHaveLength(2)
    expect(marketHistoryTrend(history.points)).toBe(1)
    expect(marketHistoryTrend(history.points, { at: 400, value: 9 })).toBe(2)
    expect(rangeFromHistory(history.points)).toEqual({ low: 4, high: 11 })
    expect(attachHistoryRange([{ ...player, rankLow: null, rankHigh: null }], catalog)[0]).toMatchObject({ rankLow: 4, rankHigh: 11 })
  })

  it('turns FantasyPros last-1 and last-7 windows into a live-ADP series', () => {
    const publishedAt = Date.parse('2026-08-22T12:20:04-04:00')
    const points = withPayloadAdpWindows([], {
      liveAdp: 105.6,
      liveAdpLastOne: 114.9,
      liveAdpLastSeven: 110.1,
      liveAdpPublishedAt: publishedAt,
    })
    expect(points.map((point) => [point.liveAdp, point.sourceCount])).toEqual([
      [110.1, 1],
      [114.9, 1],
      [105.6, 1],
    ])
    expect(points[0]?.at).toBe(publishedAt - 7 * 24 * 60 * 60 * 1000)
    expect(points[1]?.at).toBe(publishedAt - 24 * 60 * 60 * 1000)
    expect(marketHistoryMode(points)).toBe('liveAdp')
    expect(marketHistoryTrend(points)).toBeCloseTo(4.5)
  })

  it('does not invent a window on top of a collected observation from the same day', () => {
    const publishedAt = Date.parse('2026-08-22T12:20:04-04:00')
    const collected = [{ at: publishedAt, rank: null, adp: null, liveAdp: 105.6, low: null, high: null, sourceCount: 2 }]
    const points = withPayloadAdpWindows(collected, {
      liveAdp: 105.6,
      liveAdpLastOne: 114.9,
      liveAdpLastSeven: 110.1,
      liveAdpPublishedAt: publishedAt,
    })
    expect(points.filter((point) => point.at === publishedAt)).toHaveLength(1)
    expect(points).toHaveLength(3)
  })
})

describe('player news', () => {
  it('keeps the RotoWire player note ahead of ESPN athlete headlines', () => {
    const news = parseAthleteNews(player, {
      rotowire: {
        headline: 'Held out of Saturday’s preseason game.',
        story: 'The team is exercising caution after last year’s knee injury.',
        published: 'Thu Aug 20 07:48:44 PDT 2026',
      },
      news: [
        {
          id: 49447878,
          headline: 'Training camp updates',
          description: 'Catch up on camp.',
          lastModified: '2026-08-20T18:25:25.000+00:00',
          links: { web: { href: 'https://www.espn.com/nfl/story/_/id/49447878' } },
        },
      ],
    })
    expect(news).toEqual([
      {
        id: 'rotowire:42:Thu Aug 20 07:48:44 PDT 2026',
        headline: 'Held out of Saturday’s preseason game.',
        description: 'The team is exercising caution after last year’s knee injury.',
        published: '2026-08-20T14:48:44.000Z',
        url: 'https://www.espn.com/nfl/player/news/_/id/42',
        source: 'RotoWire',
      },
      {
        id: '49447878',
        headline: 'Training camp updates',
        description: 'Catch up on camp.',
        published: '2026-08-20T18:25:25.000Z',
        url: 'https://www.espn.com/nfl/story/_/id/49447878',
        source: 'ESPN',
      },
    ])
  })

  it('loads news from the ESPN athlete overview instead of the league RSS feed', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/overview')) {
        return new Response(JSON.stringify({
          rotowire: { headline: 'Cleared for 11-on-11 work.', story: '', published: '2026-08-08T19:36:54.000Z' },
          news: [],
        }), { headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const data = await getPlayerIntelligence(player)
    expect(data.news).toEqual([expect.objectContaining({ source: 'RotoWire', headline: 'Cleared for 11-on-11 work.' })])
    expect(data.newsMessage).toBeNull()
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/espn/rss/'))).toBe(false)
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/athletes/42/overview'))).toBe(true)
  })

  it('does not invent headlines when the player has no ESPN profile', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    const data = await getPlayerIntelligence({ ...player, espnId: undefined })
    expect(data.news).toEqual([])
    expect(data.newsMessage).toBe('This player is not linked to an ESPN profile.')
  })

  it('keys draft-room and player-intelligence queries on ESPN id when present', () => {
    expect(playerIntelligenceQueryKey(player)).toBe('42')
    expect(playerIntelligenceQueryKey({ ...player, espnId: undefined, sleeperId: '77' })).toBe('77')
  })

  it('loads player news without waiting on stats or ranking history', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/overview')) {
        return new Response(JSON.stringify({
          rotowire: { headline: 'Cleared for 11-on-11 work.', story: '', published: '2026-08-08T19:36:54.000Z' },
          news: [],
        }), { headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const data = await getPlayerNews(player)
    expect(data.news).toEqual([expect.objectContaining({ source: 'RotoWire', headline: 'Cleared for 11-on-11 work.' })])
    expect(data.newsMessage).toBeNull()
    expect(fetchMock.mock.calls).toHaveLength(1)
  })
})
