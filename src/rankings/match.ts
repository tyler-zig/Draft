import type { Player } from '../providers/types'
import { normalizeName, normalizePos, normalizeTeam, playerKey } from './normalize'
import type { MatchedRankRow, RankRow } from './types'

export interface PlayerIndex {
  bySleeper: Map<string, Player>
  byEspn: Map<string, Player>
  byNameTeamPos: Map<string, Player>
  byNamePos: Map<string, Player>
  byName: Map<string, Player[]>
}

export function buildPlayerIndex(players: Player[]): PlayerIndex {
  const bySleeper = new Map<string, Player>()
  const byEspn = new Map<string, Player>()
  const byNameTeamPos = new Map<string, Player>()
  const byNamePos = new Map<string, Player>()
  const byName = new Map<string, Player[]>()

  for (const player of players) {
    if (player.sleeperId) bySleeper.set(player.sleeperId, player)
    else if (!player.espnId) bySleeper.set(player.id, player)
    if (player.espnId) byEspn.set(player.espnId, player)

    const name = normalizeName(player.fullName)
    const team = normalizeTeam(player.team)
    const pos = normalizePos(player.position)
    if ((pos === 'DEF' && team) || (name && team && pos)) byNameTeamPos.set(playerKey(player.fullName, player.team, player.position), player)
    // Prefer a rostered player for name+pos. A free agent may still own the
    // slot when they are the only one -- August directories often have a
    // blank team on real players, and hiding those dropped them off the board.
    if (name && pos) {
      const key = `${name}|${pos}`
      const existing = byNamePos.get(key)
      if (!existing || (!existing.team && team)) byNamePos.set(key, player)
    }
    const bucket = byName.get(name) ?? []
    bucket.push(player)
    byName.set(name, bucket)
  }

  return { bySleeper, byEspn, byNameTeamPos, byNamePos, byName }
}

export function matchRow(row: RankRow, index: PlayerIndex): Player | null {
  if (row.sleeperId && index.bySleeper.has(row.sleeperId)) {
    return index.bySleeper.get(row.sleeperId) ?? null
  }
  if (row.espnId && index.byEspn.has(row.espnId)) {
    return index.byEspn.get(row.espnId) ?? null
  }
  const name = normalizeName(row.name)
  const team = normalizeTeam(row.team)
  const pos = normalizePos(row.position)
  if ((pos === 'DEF' && team) || (name && team && pos)) {
    const hit = index.byNameTeamPos.get(playerKey(row.name, row.team, row.position))
    if (hit) return hit
  }
  if (name && pos) {
    const hit = index.byNamePos.get(`${name}|${pos}`)
    if (hit) return hit
  }
  if (name) {
    const bucket = index.byName.get(name) ?? []
    if (bucket.length === 1) return bucket[0] ?? null
  }
  return null
}

export function matchRows(
  rows: RankRow[],
  players: Player[],
): { matched: MatchedRankRow[]; unmatched: string[] } {
  const index = buildPlayerIndex(players)
  const matched: MatchedRankRow[] = []
  const unmatched: string[] = []

  for (const row of rows) {
    const player = matchRow(row, index)
    if (!player) {
      unmatched.push(row.name || row.sleeperId || row.espnId || 'unknown')
      continue
    }
    matched.push({
      ...row,
      overall: row.overall ?? 0,
      sleeperId: player.sleeperId,
      espnId: player.espnId,
      playerId: player.id,
    })
  }

  return { matched, unmatched }
}
