import type { Player } from '../providers/types'

/**
 * Sleeper stopped publishing `espn_id` for most of the 2026 board. This sheet
 * already has the Sleeper → ESPN (and Yahoo) map:
 * https://github.com/mayscopeland/ffb_ids
 */
export const PLAYER_ID_CROSSWALK_URL =
  'https://raw.githubusercontent.com/mayscopeland/ffb_ids/main/player_ids.csv'

export interface PlayerIdIds {
  espnId: string | null
  yahooId: string | null
}

export function parsePlayerIdCsv(text: string): Map<string, PlayerIdIds> {
  const map = new Map<string, PlayerIdIds>()
  const lines = text.split(/\r?\n/)
  const header = lines[0]
  if (!header) return map
  const cols = splitCsvLine(header)
  const sleeperIdx = cols.indexOf('sleeper_id')
  const espnIdx = cols.indexOf('espn_id')
  const yahooIdx = cols.indexOf('yahoo_id')
  if (sleeperIdx < 0) return map

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const cells = splitCsvLine(line)
    const sleeperId = cells[sleeperIdx]?.trim()
    if (!sleeperId) continue
    const espnId = cellId(cells[espnIdx])
    const yahooId = cellId(cells[yahooIdx])
    if (!espnId && !yahooId) continue
    map.set(sleeperId, { espnId, yahooId })
  }
  return map
}

/** Fills blank ESPN / Yahoo ids from a Sleeper-keyed map. Never overwrites. */
export function applyPlayerIdCrosswalk<T extends Pick<Player, 'id' | 'sleeperId' | 'espnId' | 'yahooId'>>(
  players: T[],
  map: Map<string, PlayerIdIds>,
): T[] {
  if (!map.size) return players
  let changed = false
  const next = players.map((player) => {
    const sleeperId = player.sleeperId ?? player.id
    const ids = sleeperId ? map.get(sleeperId) : undefined
    if (!ids) return player
    const espnId = player.espnId || ids.espnId || undefined
    const yahooId = player.yahooId || ids.yahooId || undefined
    if (espnId === player.espnId && yahooId === player.yahooId) return player
    changed = true
    return { ...player, espnId, yahooId }
  })
  return changed ? next : players
}

let pending: Promise<Map<string, PlayerIdIds>> | null = null
let loaded: Map<string, PlayerIdIds> | null = null

export function clearPlayerIdCrosswalkCache() {
  pending = null
  loaded = null
}

export async function loadPlayerIdCrosswalk(signal?: AbortSignal): Promise<Map<string, PlayerIdIds>> {
  if (loaded) return loaded
  pending ??= (async () => {
    try {
      const response = await fetch(PLAYER_ID_CROSSWALK_URL, { signal })
      if (!response.ok) return new Map()
      const map = parsePlayerIdCsv(await response.text())
      loaded = map
      return map
    } catch (error) {
      pending = null
      if (error instanceof Error && error.name === 'AbortError') throw error
      return new Map()
    }
  })()
  return pending
}

function cellId(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** Header-driven split that keeps quoted commas inside a field. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
        continue
      }
      quoted = !quoted
      continue
    }
    if (char === ',' && !quoted) {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  return cells
}
