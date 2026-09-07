import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDraft, getDraftPicks, sleeperGet } from './sleeper'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('sleeperGet', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the proxy when it returns JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(sleeperGet('/draft/1')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/sleeper/v1/draft/1')
  })

  it('falls back to api.sleeper.app when the proxy returns HTML', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith('/sleeper/')) {
        return new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
      }
      return jsonResponse([{ player_id: '7564', pick_no: 1 }])
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(sleeperGet('/draft/1/picks')).resolves.toEqual([{ player_id: '7564', pick_no: 1 }])
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      '/sleeper/v1/draft/1/picks',
      'https://api.sleeper.app/v1/draft/1/picks',
    ])
  })

  it('falls back to the documented host when the proxy 404s', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith('/sleeper/')) return new Response('', { status: 404 })
      return jsonResponse({ draft_id: '1' })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(sleeperGet('/draft/1')).resolves.toEqual({ draft_id: '1' })
  })
})

describe('live draft reads', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Sleeper's own draft room reads picks over GraphQL, which answers
  // `cache-control: max-age=0, private, must-revalidate` -- the REST board is
  // edge-cached and can hand back a body no request header busts.
  it('reads picks from the GraphQL endpoint Sleeper\'s own client uses', async () => {
    const row = { pick_no: 1, player_id: '7564', picked_by: '0', is_keeper: null, metadata: { last_name: 'Chase' } }
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ data: { draft_picks: [row] } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getDraftPicks('42')).resolves.toEqual([row])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://sleeper.com/graphql')
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store' })
    expect(JSON.parse(String(init?.body))).toMatchObject({ variables: { draft_id: '42' } })
  })

  it('falls back to the cache-busted REST board when GraphQL errors', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('graphql')) return jsonResponse({ errors: [{ message: 'nope' }] })
      return jsonResponse([{ player_id: '7564', pick_no: 1 }])
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(getDraftPicks('42')).resolves.toEqual([{ player_id: '7564', pick_no: 1 }])
    expect(String(fetchMock.mock.calls[1]?.[0])).toMatch(/^\/sleeper\/v1\/draft\/42\/picks\?_=\d+$/)
  })

  it('falls back when GraphQL is unreachable', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('graphql')) throw new TypeError('Failed to fetch')
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(getDraftPicks('42')).resolves.toEqual([])
  })

  it('cache-busts the draft document too, so status and the clock stay live', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ draft_id: '42' }))
    vi.stubGlobal('fetch', fetchMock)
    await getDraft('42')
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/^\/sleeper\/v1\/draft\/42\?_=\d+$/)
  })
})
