/**
 * Shard layout for the player-intelligence artifact.
 *
 * The monolithic `intelligence/latest.json` is ~17 MB and was downloaded in
 * full to read one player's record -- every visit paid the whole dataset, plus
 * a main-thread `JSON.parse` of it, to render a single panel. The sharded
 * layout ships a small identity index plus the one bucket the selected player
 * lives in, so a visit costs tens of kilobytes instead of tens of megabytes.
 *
 * Every producer and the client import this module, so the bucket a record is
 * written to is always the bucket the client looks in. The hosted cron
 * (`supabase/functions/sync-intelligence`), the local Node sync, and the
 * browser all share `buildPlayerShards` and differ only in how they do IO.
 */

/**
 * 128 buckets puts ~22 players and ~130 KB of raw JSON in each. Fewer buckets
 * makes a lookup download more than it needs; many more turns each publish
 * into thousands of Storage uploads for no further gain at this dataset size.
 */
export const SHARD_COUNT = 128

/** Zero-padded so the object listing sorts the way a human reads it. */
export function shardName(shard: number): string {
  return String(shard).padStart(3, '0')
}

export function shardPath(shard: number): string {
  return `intelligence/players/${shardName(shard)}.json`
}

export const SHARD_INDEX_PATH = 'intelligence/players/index.json'

/**
 * FNV-1a. Chosen for being short enough to keep in one place and identical in
 * Node and the browser -- the two sides must agree exactly or a lookup reads
 * the wrong bucket and reports a player as missing.
 */
export function shardFor(id: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % SHARD_COUNT
}

/** Shared fallback identity, for records whose provider ids don't line up. */
export const normalizedPlayerName = (value: string) =>
  value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ')

export interface ShardablePlayer {
  ids: { gsis: string; espn: string | null; sleeper: string | null; pfr: string | null }
  name: string
  position: string
}

export interface ShardableArtifact<P extends ShardablePlayer = ShardablePlayer> {
  generatedAt: string
  attribution?: string
  methodology?: Record<string, string>
  players: P[]
}

export interface ShardIndexEntry {
  g: string
  e: string | null
  s: string | null
  n: string
  p: string
  d: number
}

export interface BuiltShards<P extends ShardablePlayer> {
  index: {
    schemaVersion: number
    generatedAt: string
    attribution: string
    methodology: Record<string, string>
    shardCount: number
    players: ShardIndexEntry[]
  }
  /** One entry per bucket, in shard order; empty buckets are written too. */
  buckets: Array<{ shard: number; path: string; body: { schemaVersion: number; generatedAt: string; players: P[] } }>
}

/**
 * The pure half of publishing: decides what goes in which bucket and builds
 * the index. Callers write the result wherever they publish to, so the hosted
 * cron and the local script cannot drift apart in how they shard.
 */
export function buildPlayerShards<P extends ShardablePlayer>(artifact: ShardableArtifact<P>): BuiltShards<P> {
  const buckets: P[][] = Array.from({ length: SHARD_COUNT }, () => [])
  const players: ShardIndexEntry[] = artifact.players.map((player) => {
    const shard = shardFor(player.ids.gsis)
    buckets[shard].push(player)
    return {
      g: player.ids.gsis,
      e: player.ids.espn || null,
      s: player.ids.sleeper || null,
      n: normalizedPlayerName(player.name),
      p: player.position,
      d: shard,
    }
  })
  return {
    index: {
      schemaVersion: 1,
      generatedAt: artifact.generatedAt,
      attribution: artifact.attribution ?? '',
      methodology: artifact.methodology ?? {},
      shardCount: SHARD_COUNT,
      players,
    },
    buckets: buckets.map((bucketPlayers, shard) => ({
      shard,
      path: shardPath(shard),
      body: { schemaVersion: 1, generatedAt: artifact.generatedAt, players: bucketPlayers },
    })),
  }
}
