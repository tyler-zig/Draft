import type { Player } from '../providers/types'

const DB_NAME = 'draft-assistant'
const STORE = 'kv'
const PLAYERS_KEY = 'nfl-players-v3'
const TTL_MS = 24 * 60 * 60 * 1000

interface CachedPlayers {
  fetchedAt: number
  players: Player[]
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result as T | undefined)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return undefined
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const req = tx.objectStore(STORE).put(value, key)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch {
    // Cache is optional.
  }
}

export interface CachedPlayerRead {
  players: Player[]
  /** True once the copy is past its TTL: usable now, but worth refreshing. */
  stale: boolean
}

/**
 * The cached directory plus whether it has aged out.
 *
 * Callers are expected to serve a stale copy and refresh behind it. The
 * Sleeper player dump is ~3 MB and takes ~2s to fetch and map; blocking the
 * page on that every 24 hours bought freshness the directory does not need,
 * since it changes by the odd name or rookie rather than wholesale.
 */
export async function readPlayerCacheEntry(): Promise<CachedPlayerRead | null> {
  const cached = await idbGet<CachedPlayers>(PLAYERS_KEY)
  if (!cached?.players?.length) return null
  return { players: cached.players, stale: Date.now() - cached.fetchedAt > TTL_MS }
}

export async function readPlayerCache(): Promise<Player[] | null> {
  const cached = await readPlayerCacheEntry()
  return cached && !cached.stale ? cached.players : null
}

export function writePlayerCache(players: Player[]): Promise<void> {
  return idbSet(PLAYERS_KEY, {
    fetchedAt: Date.now(),
    players,
  } satisfies CachedPlayers)
}
