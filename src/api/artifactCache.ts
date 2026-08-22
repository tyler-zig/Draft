import { idbGet, idbSet } from './playerCache'

/**
 * IndexedDB cache for ranking artifact payloads, gated on the publisher's own
 * version stamp rather than a TTL.
 *
 * React Query's `staleTime` only lives as long as the tab, so every full page
 * load re-downloaded ~5.5 MB of ranking JSON that had usually not changed.
 * A TTL would have traded that for staleness -- the ADP board is rebuilt
 * every 15 minutes and the whole point of its short `staleTime` is to pick a re-scrape
 * up quickly. Keying on `ranking_snapshots.fetched_at` avoids the trade: one
 * ~550-byte probe covers every kind, a matching stamp serves the cached copy
 * with no payload transfer at all, and a changed stamp always refetches.
 */

const KEY_PREFIX = 'ranking-artifact:'

interface CachedArtifact {
  version: string
  payload: unknown
}

export async function readCachedArtifact(kind: string, version: string): Promise<{ payload: unknown } | null> {
  const cached = await idbGet<CachedArtifact>(`${KEY_PREFIX}${kind}`)
  if (!cached || cached.version !== version || cached.payload == null) return null
  return { payload: cached.payload }
}

/**
 * Not awaited by callers: a payload that has already been returned should not
 * wait on -- or fail because of -- writing it down for next time. `idbSet`
 * swallows its own errors, quota included.
 */
export function writeCachedArtifact(kind: string, version: string, payload: unknown): Promise<void> {
  return idbSet(`${KEY_PREFIX}${kind}`, { version, payload } satisfies CachedArtifact)
}
