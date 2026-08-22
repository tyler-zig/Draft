import type { Player } from '../providers/types'
import { fetchArtifact } from '../supabase/artifacts'

export interface TwitterCatalog {
  schemaVersion: number
  source: string
  bySleeper: Record<string, string>
  byEspn: Record<string, string>
  byGsis: Record<string, string>
}

const emptyCatalog = (): TwitterCatalog => ({ schemaVersion: 1, source: '', bySleeper: {}, byEspn: {}, byGsis: {} })

/** Official X/Twitter usernames are 1–15 letters, numbers, or underscores. */
export function normalizeTwitterHandle(value: string | null | undefined): string | null {
  if (!value) return null
  let handle = value.trim()
  if (!handle || /^n\/?a$/i.test(handle)) return null
  handle = handle.replace(/^https?:\/\/(?:www\.)?(?:twitter|x)\.com\//i, '')
  handle = handle.replace(/^@/, '').split(/[/?#]/)[0] ?? ''
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null
}

export function twitterUrl(handle: string): string {
  return `https://x.com/${encodeURIComponent(handle)}`
}

export function parseTwitterCatalog(value: unknown): TwitterCatalog {
  const root = value && typeof value === 'object' ? value as Record<string, unknown> : null
  const map = (field: string): Record<string, string> => {
    const record = root?.[field] && typeof root[field] === 'object' ? root[field] as Record<string, unknown> : {}
    return Object.fromEntries(Object.entries(record).flatMap(([id, handle]) => {
      const normalized = normalizeTwitterHandle(typeof handle === 'string' ? handle : null)
      return id && normalized ? [[id, normalized]] : []
    }))
  }
  return {
    schemaVersion: Number(root?.schemaVersion) || 1,
    source: typeof root?.source === 'string' ? root.source : '',
    bySleeper: map('bySleeper'),
    byEspn: map('byEspn'),
    byGsis: map('byGsis'),
  }
}

export function twitterHandleFor(
  player: Pick<Player, 'sleeperId' | 'espnId' | 'gsisId'>,
  catalog: TwitterCatalog | null | undefined,
): string | null {
  if (!catalog) return null
  return (player.sleeperId ? catalog.bySleeper[player.sleeperId] : undefined)
    ?? (player.espnId ? catalog.byEspn[player.espnId] : undefined)
    ?? (player.gsisId ? catalog.byGsis[player.gsisId] : undefined)
    ?? null
}

export async function loadTwitterCatalog(signal?: AbortSignal): Promise<TwitterCatalog> {
  try {
    const response = await fetchArtifact('players/twitter.json', { signal })
    if (!response.ok) return emptyCatalog()
    return parseTwitterCatalog(await response.json())
  } catch (error) {
    if (signal?.aborted) throw error
    return emptyCatalog()
  }
}
