import { readCachedArtifact, writeCachedArtifact } from '../api/artifactCache'
import { dataBucket, supabase, supabaseConfigured } from './client'

export function localArtifactUrl(path: string) {
  return `/${path.replace(/^\/+/, '')}`
}

export function hostedArtifactUrl(path: string): string | null {
  if (!supabaseConfigured || !supabase) return null
  return supabase.storage.from(dataBucket).getPublicUrl(path.replace(/^\/+/, '')).data.publicUrl
}

function aborted(init: RequestInit | undefined, error: unknown): boolean {
  return Boolean(init?.signal?.aborted) || (error instanceof Error && error.name === 'AbortError')
}

/** Prefer the hosted artifact, but preserve static/local development as a fallback. */
export async function fetchArtifact(path: string, init?: RequestInit): Promise<Response> {
  const hosted = hostedArtifactUrl(path)
  if (hosted) {
    try {
      const response = await fetch(hosted, init)
      if (response.ok) return response
    } catch (error) {
      // A caller that cancelled is not a hosted-artifact failure. Retrying the
      // fallback with the same dead signal only fails again, and the caller
      // would read that as "this artifact has no data".
      if (aborted(init, error)) throw error
      // Static fallback below keeps offline and partially configured installs usable.
    }
  }
  return fetch(localArtifactUrl(path), init)
}

/**
 * Publish stamps for every ranking kind, in one small request shared by all
 * callers on a page load. Resolves to an empty map when the probe fails, which
 * simply means nothing can be served from cache this time.
 */
let versionsPromise: Promise<Map<string, string>> | null = null
function artifactVersions(): Promise<Map<string, string>> {
  const client = supabase
  if (!supabaseConfigured || !client) return Promise.resolve(new Map())
  // PostgREST builders are thenable rather than real promises, so the result
  // is adopted into one before any promise method is used on it.
  versionsPromise ??= (async () => {
    try {
      const { data, error } = await client.from('ranking_snapshots').select('kind,fetched_at')
      if (error || !data) throw error ?? new Error('No artifact versions')
      return new Map(data.map((row) => [row.kind, String(row.fetched_at)]))
    } catch {
      versionsPromise = null
      return new Map<string, string>()
    }
  })()
  return versionsPromise
}

/** Test seam: drops the memoized probe so a fresh one runs. */
export function clearArtifactVersionCache() {
  versionsPromise = null
}

/** Ranking JSON lives in Postgres; Storage/static files are compatibility fallbacks. */
export async function readRankingArtifact(kind: string, path: string, init?: RequestInit): Promise<unknown | null> {
  if (supabaseConfigured && supabase) {
    try {
      // The probe is deliberately not given the caller's signal: it is shared
      // between callers, so one caller cancelling must not cancel it for the
      // rest. Their own cancellation is honoured on the line after.
      const version = (await artifactVersions()).get(kind) ?? null
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (version) {
        const cached = await readCachedArtifact(kind, version)
        if (cached) return cached.payload
      }

      let query = supabase.from('ranking_snapshots').select('payload').eq('kind', kind)
      if (init?.signal) query = query.abortSignal(init.signal)
      const { data, error } = await query.maybeSingle()
      if (!error && data?.payload != null) {
        if (version) void writeCachedArtifact(kind, version, data.payload)
        return data.payload
      }
    } catch (error) {
      if (aborted(init, error)) throw error
      // Older/unmigrated projects fall through to Storage and static assets.
    }
  }
  const response = await fetchArtifact(path, init)
  if (!response.ok) return null
  if (!response.headers.get('content-type')?.includes('application/json')) return null
  return response.json() as Promise<unknown>
}

/** Ranking JSON lives in Postgres; Storage/static files are compatibility fallbacks. */
export async function fetchRankingArtifact(kind: string, path: string, init?: RequestInit): Promise<Response> {
  const payload = await readRankingArtifact(kind, path, init)
  if (payload == null) return new Response(null, { status: 404 })
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json', 'x-draft-data-source': 'supabase-postgres' } })
}
