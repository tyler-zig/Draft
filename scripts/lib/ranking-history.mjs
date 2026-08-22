import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { playerKey } from './text.mjs'

const SNAPSHOT_NAME = /^\d{4}-\d{2}-\d{2}T.*\.json$/

/**
 * Snapshots before this instant used the wrong FantasyPros feed (consensus
 * rank stored as ADP) and a digest `adp` that mixed that number with season
 * boards. Market history starts here so those observations cannot draw an
 * ADP or live-ADP trend. Keep in sync with ranking-collector.ts.
 */
export const MARKET_ADP_HISTORY_START = Date.parse('2026-08-22T19:00:00.000Z')

export function recordsMarketAdp(fetchedAt) {
  return Number.isFinite(fetchedAt) && fetchedAt >= MARKET_ADP_HISTORY_START
}

/**
 * Live ADP per digest player, from the FantasyPros real-time ADP board when
 * the snapshot collected it. Snapshot history predates the board, so older
 * observations simply carry null and the tracker falls back to reported ADP.
 */
function liveAdpIndex(snapshot) {
  const set = (snapshot.sets ?? []).find((entry) => entry?.id === 'fantasypros-rtadp')
  const byEspn = new Map()
  const byKey = new Map()
  for (const row of set?.rows ?? []) {
    if (typeof row.adp !== 'number' || row.adp <= 0) continue
    if (row.espnId != null && row.espnId !== '') byEspn.set(String(row.espnId), row.adp)
    byKey.set(playerKey(row.name, row.team, row.position), row.adp)
  }
  return (player) => {
    if (player.espnId != null && player.espnId !== '' && byEspn.has(String(player.espnId))) return byEspn.get(String(player.espnId))
    return byKey.get(playerKey(player.name, player.team, player.position)) ?? null
  }
}

export function historyPlayerKey(player) {
  if (player.espnId != null && player.espnId !== '') return `espn:${player.espnId}`
  return `name:${String(player.name ?? '').trim().toLowerCase()}|${String(player.team ?? '').trim().toUpperCase()}|${String(player.position ?? '').trim().toUpperCase()}`
}

export function compactSnapshots(snapshots) {
  const unique = new Map()
  for (const snapshot of snapshots) {
    if (!snapshot || !Array.isArray(snapshot.players) || !Number.isFinite(snapshot.fetchedAt)) continue
    unique.set(snapshot.fetchedAt, snapshot)
  }
  const ordered = [...unique.values()].sort((a, b) => a.fetchedAt - b.fetchedAt)
  const players = new Map()
  for (const snapshot of ordered) {
    const liveAdpFor = liveAdpIndex(snapshot)
    for (const player of snapshot.players) {
      const key = historyPlayerKey(player)
      let record = players.get(key)
      if (!record) {
        record = { key, name: player.name, team: player.team ?? null, position: player.position ?? null, espnId: player.espnId == null ? null : String(player.espnId), points: [] }
        players.set(key, record)
      }
      const keepMarket = recordsMarketAdp(snapshot.fetchedAt)
      record.points.push({
        at: snapshot.fetchedAt,
        rank: Number.isFinite(player.median) ? player.median : null,
        adp: keepMarket && Number.isFinite(player.adp) ? player.adp : null,
        liveAdp: keepMarket ? liveAdpFor(player) : null,
        low: Number.isFinite(player.best) ? player.best : null,
        high: Number.isFinite(player.worst) ? player.worst : null,
        sourceCount: Number.isFinite(player.sampleCount) ? player.sampleCount : 0,
      })
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: Date.now(),
    series: 'Collected ranking median',
    snapshots: ordered.map((snapshot) => ({ at: snapshot.fetchedAt })),
    players: [...players.values()].sort((a, b) => a.name.localeCompare(b.name)),
  }
}

export async function compactRankingHistory({ inputDir, outputFile }) {
  const names = (await readdir(inputDir)).filter((name) => SNAPSHOT_NAME.test(name)).sort()
  const snapshots = []
  for (const name of names) {
    try {
      snapshots.push(JSON.parse(await readFile(resolve(inputDir, name), 'utf8')))
    } catch (error) {
      throw new Error(`Could not read ranking snapshot ${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const payload = compactSnapshots(snapshots)
  await mkdir(dirname(outputFile), { recursive: true })
  const temporary = resolve(dirname(outputFile), `.${basename(outputFile)}.${process.pid}.tmp`)
  await writeFile(temporary, `${JSON.stringify(payload)}\n`)
  await rename(temporary, outputFile)
  return { snapshots: payload.snapshots.length, players: payload.players.length, output: outputFile }
}
