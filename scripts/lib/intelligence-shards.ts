import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { SHARD_COUNT, SHARD_INDEX_PATH, buildPlayerShards, type ShardableArtifact, type ShardablePlayer } from '../../src/intelligence/shards'

export type { ShardableArtifact, ShardablePlayer }

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value)}\n`)
  await rename(temporary, path)
}

/**
 * Writes the sharded read path to `public/`, for local development and for the
 * one-time seed of a fresh Supabase project.
 *
 * Routine publishing does not go through here: the hosted cron
 * (`supabase/functions/sync-intelligence`) rebuilds the same buckets from the
 * same `buildPlayerShards`, so a deployed install never needs a manual upload.
 *
 * The bucket directory is cleared first: a shrinking dataset must not leave a
 * previous run's records behind for the client to find.
 */
export async function writePlayerShards<P extends ShardablePlayer>(
  artifact: ShardableArtifact<P>,
  publicDir: string,
) {
  const { index, buckets } = buildPlayerShards(artifact)

  const shardDir = resolve(publicDir, 'intelligence/players')
  await rm(shardDir, { recursive: true, force: true })
  await mkdir(shardDir, { recursive: true })
  for (const bucket of buckets) {
    await atomicJson(resolve(publicDir, bucket.path), bucket.body)
  }
  await atomicJson(resolve(publicDir, SHARD_INDEX_PATH), index)
  return { shards: SHARD_COUNT, players: index.players.length, dir: shardDir }
}
