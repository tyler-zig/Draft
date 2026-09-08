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
  /**
   * Per-season durability, when the producer has it. Only the recent window
   * reaches the index; the full history stays in the bucket.
   *
   * Every field past `season` is optional because not every producer declares
   * one: the hosted schedule refresh re-publishes records it only partly
   * types. A season missing either count contributes no availability rather
   * than a zero, so a narrow producer degrades to "unknown" instead of
   * publishing an index that says nobody has ever been hurt.
   */
  seasons?: Array<{
    season: number
    gamesPlayed?: number
    durability?: { gamesMissed?: number } | null
    weekly?: Array<{ fantasyPointsPpr?: number }>
  }>
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
  /**
   * Recent availability, flattened as `[season, played, missed, ...]`, most
   * recent season first, at most `AVAILABILITY_SEASONS` of them.
   *
   * This is the one piece of a player's history the draft board needs for
   * every player at once, so it rides in the index rather than the bucket:
   * scoring a 500-player pool cannot fetch 128 buckets, and a value the
   * engine cannot see is a value that silently does not count. Absent on an
   * index published before this field existed, which readers must treat as
   * "unknown" rather than "never missed a game".
   */
  a?: number[]
  /**
   * Week-to-week scoring consistency, as `[coefficient of variation, weeks]`
   * from the most recent season with a usable sample.
   *
   * A survival format is decided by a team's worst week, not its best, and
   * nothing else published here measures that. The engine had been reading
   * `rankStdDev` as a floor proxy, which is expert disagreement about draft
   * position -- a different quantity entirely, and one the ADP source may not
   * publish at all. This is the real thing: how much a player's own scoring
   * actually moves, week to week. Absent when he has too few games to say.
   */
  c?: [number, number]
}

/** Seasons of durability carried in the index. Three spans a typical NFL peak-to-decline window without bloating a file every visit downloads. */
export const AVAILABILITY_SEASONS = 3

/**
 * Weeks a season needs before its scoring spread means anything. Below this a
 * coefficient of variation is mostly noise about a small sample, and a player
 * with four loud games would read as either a metronome or a lottery ticket
 * depending on which four.
 */
export const CONSISTENCY_MIN_WEEKS = 8

/**
 * Coefficient of variation of weekly scoring, from the most recent season with
 * a usable sample, paired with the number of weeks behind it.
 *
 * One season, not a blend: a player's role is the thing being measured, and
 * roles change between seasons often enough that averaging two of them
 * describes a player who no longer exists. PPR is used for every league
 * because the question is the shape of his weekly distribution, not its
 * scale, and the shape barely moves with the scoring format.
 */
export function consistencyFrom(player: ShardablePlayer): [number, number] | undefined {
  const seasons = (player.seasons ?? [])
    .filter((season) => season && Number.isFinite(season.season) && Array.isArray(season.weekly))
    .sort((a, b) => b.season - a.season)
  for (const season of seasons) {
    const points = (season.weekly ?? [])
      .map((week) => week?.fantasyPointsPpr)
      .filter((value): value is number => Number.isFinite(value))
    if (points.length < CONSISTENCY_MIN_WEEKS) continue
    const mean = points.reduce((sum, value) => sum + value, 0) / points.length
    // A replacement-level scorer's ratio explodes on a near-zero mean and
    // says nothing about anyone's floor, so he simply gets no reading.
    if (mean < 6) continue
    const variance = points.reduce((sum, value) => sum + (value - mean) ** 2, 0) / points.length
    return [Math.round((Math.sqrt(variance) / mean) * 1000) / 1000, points.length]
  }
  return undefined
}

/**
 * The flat `[season, played, missed, ...]` triples for the index, most recent
 * first. A season with no durability row is skipped rather than recorded as a
 * clean one -- "we did not measure" and "he played every game" are different
 * claims, and only the second is worth scoring.
 */
export function availabilityTriples(player: ShardablePlayer): number[] | undefined {
  const seasons = (player.seasons ?? [])
    .filter((season) => season && Number.isFinite(season.season)
      && Number.isFinite(season.gamesPlayed) && Number.isFinite(season.durability?.gamesMissed))
    .sort((a, b) => b.season - a.season)
    .slice(0, AVAILABILITY_SEASONS)
  if (!seasons.length) return undefined
  return seasons.flatMap((season) => [season.season, season.gamesPlayed!, season.durability!.gamesMissed!])
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
    const entry: ShardIndexEntry = {
      g: player.ids.gsis,
      e: player.ids.espn || null,
      s: player.ids.sleeper || null,
      n: normalizedPlayerName(player.name),
      p: player.position,
      d: shard,
    }
    const availability = availabilityTriples(player)
    if (availability) entry.a = availability
    const consistency = consistencyFrom(player)
    if (consistency) entry.c = consistency
    return entry
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
