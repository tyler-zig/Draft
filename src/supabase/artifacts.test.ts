import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The configured/unconfigured split is stubbed rather than inherited from the
// developer's .env.local: this suite is about both branches, and which one runs
// must not depend on whose machine it is.
const state = { configured: false }
const publicUrl = 'https://project.supabase.co/storage/v1/object/public/draft-data/rankings/latest.json'

const versionRows = vi.fn()
const payloadRow = vi.fn()

/**
 * Stands in for the two query shapes `readRankingArtifact` uses: a thenable
 * `select('kind,fetched_at')` across the table, and a
 * `select('payload').eq(...).maybeSingle()` for one kind.
 */
function queryBuilder(columns: string) {
  if (columns === 'kind,fetched_at') {
    return { then: (resolve: (value: unknown) => unknown) => Promise.resolve(versionRows()).then(resolve) }
  }
  const builder = {
    eq: () => builder,
    abortSignal: () => builder,
    maybeSingle: async () => payloadRow(),
  }
  return builder
}

vi.mock('./client', () => ({
  get supabaseConfigured() { return state.configured },
  dataBucket: 'draft-data',
  get supabase() {
    return state.configured
      ? {
          storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl } }) }) },
          from: () => ({ select: queryBuilder }),
        }
      : null
  },
}))

const cacheStore = new Map<string, { version: string; payload: unknown }>()
vi.mock('../api/artifactCache', () => ({
  readCachedArtifact: async (kind: string, version: string) => {
    const hit = cacheStore.get(kind)
    return hit && hit.version === version ? { payload: hit.payload } : null
  },
  writeCachedArtifact: async (kind: string, version: string, payload: unknown) => {
    cacheStore.set(kind, { version, payload })
  },
}))

const { clearArtifactVersionCache, fetchArtifact, hostedArtifactUrl, localArtifactUrl, readRankingArtifact } = await import('./artifacts')

beforeEach(() => { state.configured = false })
afterEach(() => { vi.restoreAllMocks() })

describe('Supabase artifact routing', () => {
  it('keeps static artifacts available in local-only installs', async () => {
    const response = new Response('{}', { status: 200 })
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
    expect(hostedArtifactUrl('rankings/latest.json')).toBeNull()
    expect(localArtifactUrl('/rankings/latest.json')).toBe('/rankings/latest.json')
    await expect(fetchArtifact('rankings/latest.json')).resolves.toBe(response)
    expect(request).toHaveBeenCalledWith('/rankings/latest.json', undefined)
  })

  it('prefers the hosted artifact once Supabase is configured', async () => {
    state.configured = true
    const response = new Response('{}', { status: 200 })
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
    expect(hostedArtifactUrl('rankings/latest.json')).toBe(publicUrl)
    await expect(fetchArtifact('rankings/latest.json')).resolves.toBe(response)
    expect(request).toHaveBeenCalledWith(publicUrl, undefined)
  })

  it('falls back to the static copy when the hosted fetch fails', async () => {
    state.configured = true
    const local = new Response('{}', { status: 200 })
    const request = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(local)
    await expect(fetchArtifact('rankings/latest.json')).resolves.toBe(local)
    expect(request).toHaveBeenLastCalledWith('/rankings/latest.json', undefined)
  })

  it('falls back when the hosted artifact is missing', async () => {
    state.configured = true
    const local = new Response('{}', { status: 200 })
    const request = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('nope', { status: 404 }))
      .mockResolvedValueOnce(local)
    await expect(fetchArtifact('rankings/latest.json')).resolves.toBe(local)
    expect(request).toHaveBeenLastCalledWith('/rankings/latest.json', undefined)
  })
})

describe('readRankingArtifact caching', () => {
  beforeEach(() => {
    state.configured = true
    cacheStore.clear()
    clearArtifactVersionCache()
    versionRows.mockReset()
    payloadRow.mockReset()
    versionRows.mockReturnValue({ data: [{ kind: 'rankings-latest', fetched_at: 'v1' }], error: null })
    payloadRow.mockResolvedValue({ data: { payload: { sets: ['fresh'] } }, error: null })
  })

  it('downloads and caches the payload on a cold read', async () => {
    await expect(readRankingArtifact('rankings-latest', 'rankings/latest.json')).resolves.toEqual({ sets: ['fresh'] })
    expect(payloadRow).toHaveBeenCalledTimes(1)
    expect(cacheStore.get('rankings-latest')).toEqual({ version: 'v1', payload: { sets: ['fresh'] } })
  })

  it('serves the cached payload without downloading it again', async () => {
    cacheStore.set('rankings-latest', { version: 'v1', payload: { sets: ['cached'] } })
    await expect(readRankingArtifact('rankings-latest', 'rankings/latest.json')).resolves.toEqual({ sets: ['cached'] })
    expect(payloadRow).not.toHaveBeenCalled()
  })

  it('refetches when the publisher stamp moves on', async () => {
    cacheStore.set('rankings-latest', { version: 'v0', payload: { sets: ['stale'] } })
    await expect(readRankingArtifact('rankings-latest', 'rankings/latest.json')).resolves.toEqual({ sets: ['fresh'] })
    expect(payloadRow).toHaveBeenCalledTimes(1)
  })

  it('probes once for every kind read on a page load', async () => {
    versionRows.mockReturnValue({ data: [
      { kind: 'rankings-latest', fetched_at: 'v1' },
      { kind: 'adp-latest', fetched_at: 'v1' },
    ], error: null })
    await Promise.all([
      readRankingArtifact('rankings-latest', 'rankings/latest.json'),
      readRankingArtifact('adp-latest', 'rankings/adp-latest.json'),
    ])
    expect(versionRows).toHaveBeenCalledTimes(1)
  })

  it('still reads the payload when the probe fails', async () => {
    versionRows.mockReturnValue({ data: null, error: new Error('offline') })
    await expect(readRankingArtifact('rankings-latest', 'rankings/latest.json')).resolves.toEqual({ sets: ['fresh'] })
    expect(cacheStore.size).toBe(0)
  })

  it('honours a caller that aborted while the shared probe was in flight', async () => {
    const controller = new AbortController()
    versionRows.mockImplementation(() => {
      controller.abort()
      return { data: [{ kind: 'rankings-latest', fetched_at: 'v1' }], error: null }
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }))
    await expect(readRankingArtifact('rankings-latest', 'rankings/latest.json', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(payloadRow).not.toHaveBeenCalled()
  })
})
