/**
 * Merges per-source projection boards into one per-player consensus.
 *
 * Identity is the same key the ranking collector uses (name|team|pos, defenses
 * by team). ESPN ids win when any source has one; stats are the per-key mean
 * of whoever published that key.
 */

import { averageNumber, averageStats, formatPoints, hasVolume, isWeeklyProjection, rejectOutlierSamples } from './projection-stats.mjs'
import { playerKey } from './text.mjs'

export function mergeProjectionSets(sets) {
  const players = new Map()

  for (const set of sets) {
    const sourceId = set.sourceId ?? set.id
    for (const row of set.rows ?? []) {
      const key = playerKey(row.name, row.team, row.position)
      if (!key || !hasVolume(row.stats)) continue
      let entry = players.get(key)
      if (!entry) {
        entry = {
          name: row.name,
          team: row.team ?? null,
          position: row.position,
          espnId: row.espnId ?? null,
          samples: [],
        }
        players.set(key, entry)
      }
      entry.espnId ??= row.espnId ?? null
      if (row.espnId && !entry.espnId) entry.espnId = row.espnId
      if (isWeeklyProjection(row)) continue
      entry.samples.push({
        sourceId,
        stats: row.stats,
        games: row.games ?? null,
        name: row.name,
      })
    }
  }

  return [...players.values()]
    .map((entry) => {
      const samples = rejectOutlierSamples(entry.samples)
      const stats = averageStats(samples.map((sample) => sample.stats))
      const sources = uniqueSources(samples)
      const sourceIds = sources.map((source) => source.id)
      return {
        name: entry.name,
        team: entry.team,
        position: entry.position,
        espnId: entry.espnId,
        games: averageNumber(samples.map((sample) => sample.games)),
        stats,
        ...formatPoints(stats),
        sourceIds,
        sourceCount: sourceIds.length,
        sources,
      }
    })
    .filter((player) => hasVolume(player.stats))
    .sort((a, b) => (b.pointsPpr ?? 0) - (a.pointsPpr ?? 0))
}

function uniqueSources(samples) {
  const byId = new Map()
  for (const sample of samples) {
    if (!sample.sourceId || !hasVolume(sample.stats)) continue
    byId.set(sample.sourceId, {
      id: sample.sourceId,
      stats: sample.stats,
      games: sample.games ?? null,
    })
  }
  return [...byId.values()]
}

export function attachEspnIds(sets, crosswalk) {
  if (!crosswalk?.size) return { sets, attached: 0 }
  let attached = 0
  for (const set of sets) {
    for (const row of set.rows ?? []) {
      if (row.espnId) continue
      const espnId = crosswalk.get(playerKey(row.name, row.team, row.position))
      if (!espnId) continue
      row.espnId = espnId
      attached += 1
    }
  }
  return { sets, attached }
}
