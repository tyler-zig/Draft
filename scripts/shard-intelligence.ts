/**
 * Rebuilds the sharded player-intelligence read path from the `latest.json`
 * that is already on disk.
 *
 * `sync:intelligence` writes the shards as part of a normal run, but that run
 * re-downloads several hundred megabytes of nflverse CSVs. This command exists
 * so an existing checkout can publish the sharded path on its own -- which is
 * all that is needed to stop the app downloading the 17 MB monolith.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { writePlayerShards, type ShardableArtifact } from './lib/intelligence-shards'

const root = resolve(import.meta.dirname, '..')
const source = resolve(root, 'public/intelligence/latest.json')

let artifact: ShardableArtifact
try {
  artifact = JSON.parse(await readFile(source, 'utf8')) as ShardableArtifact
} catch (error) {
  const reason = (error as NodeJS.ErrnoException)?.code === 'ENOENT'
    ? `${source} does not exist. Run npm run sync:intelligence first.`
    : String(error)
  throw new Error(`Cannot read the player-intelligence artifact: ${reason}`)
}
if (!Array.isArray(artifact.players) || !artifact.players.length) {
  throw new Error(`${source} carries no player records.`)
}

const result = await writePlayerShards(artifact, resolve(root, 'public'))
console.log(JSON.stringify({ source, ...result }, null, 2))
