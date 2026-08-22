import type { Player, ProviderId } from '../providers/types'
import { mirrorDraftState } from '../supabase/cloudStore'

const PREFIX = 'draft-assistant:queue:'
const QUEUE_EVENT = 'draft-assistant:queue-change'

function parse(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw ?? 'null') as unknown
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === 'string'))] : []
  } catch {
    return []
  }
}

export function loadQueue(draftKey: string): string[] {
  const key = PREFIX + draftKey
  const durable = parse(localStorage.getItem(key))
  if (durable.length || localStorage.getItem(key) != null) return durable
  const legacy = parse(sessionStorage.getItem(key))
  if (legacy.length) localStorage.setItem(key, JSON.stringify(legacy))
  return legacy
}

export function saveQueue(draftKey: string, ids: string[]) {
  const next = [...new Set(ids)]
  const key = PREFIX + draftKey
  localStorage.setItem(key, JSON.stringify(next))
  sessionStorage.setItem(key, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail: { draftKey, ids: next } }))
  void mirrorDraftState(draftKey)
}

export function subscribeQueue(draftKey: string, listener: (ids: string[]) => void) {
  const onLocal = (event: Event) => {
    const detail = (event as CustomEvent<{ draftKey?: string; ids?: string[] }>).detail
    if (detail?.draftKey === draftKey && Array.isArray(detail.ids)) listener(detail.ids)
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === PREFIX + draftKey) listener(parse(event.newValue))
  }
  window.addEventListener(QUEUE_EVENT, onLocal)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(QUEUE_EVENT, onLocal)
    window.removeEventListener('storage', onStorage)
  }
}

export function queueIdForPlayer(player: Player, provider?: ProviderId | null): string {
  if (provider === 'espn') return player.espnId ?? player.id
  if (provider === 'yahoo') return player.yahooId ?? player.id
  if (provider === 'sleeper') return player.sleeperId ?? player.id
  return player.id
}

function playerAliases(player: Player): string[] {
  return [player.id, player.sleeperId, player.espnId, player.yahooId, player.gsisId].filter((id): id is string => Boolean(id))
}

export function queueIncludesPlayer(ids: string[], player: Player): boolean {
  const queued = new Set(ids)
  return playerAliases(player).some((id) => queued.has(id))
}

/** Converts Sleeper/ESPN aliases to the ids used by the current draft pool. */
export function resolveQueuePlayerIds(ids: string[], players: Player[]): string[] {
  const aliases = new Map<string, string>()
  for (const player of players) for (const alias of playerAliases(player)) aliases.set(alias, player.id)
  return [...new Set(ids.map((id) => aliases.get(id) ?? id))]
}

export function moveQueueItem(ids: string[], id: string, direction: -1 | 1): string[] {
  const from = ids.indexOf(id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= ids.length) return ids
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  if (moved) next.splice(to, 0, moved)
  return next
}
