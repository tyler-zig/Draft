/**
 * ESPN player crosswalk.
 *
 * This is not a ranking source. ESPN's public player feed returns identity
 * only -- no draft ranks or ADP without a league session, which is what the
 * browser extension path already covers. What it does give is every player id
 * ESPN uses, keyed to name/team/position, which lets matched rows carry an
 * espnId instead of relying on fuzzy name matching downstream.
 */

import { fetchJson, guard } from '../http.mjs'
import { clean, playerKey } from '../text.mjs'

const ORIGIN = 'https://lm-api-reads.fantasy.espn.com'

// Mirrors PRO_TEAMS / POSITION_BY_ID in src/espn/mapEspn.ts; keep in sync.
const PRO_TEAMS = {
  0: null, 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN',
  8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR',
  15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI',
  22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH',
  29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
}

/**
 * `defaultPositionId` is NOT the lineup-slot id space. Slots run 0=QB, 2=RB,
 * 4=WR, 6=TE, 17=K; default positions run as below. Verified against known
 * players: Josh Allen=1, Gibbs=2, Chase=3, Bowers=4, Butker=5, "Bills D/ST"=16.
 * Ids 7 and 9-13 are IDP and have no fantasy-relevant mapping here.
 */
const POSITION_BY_ID = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' }

function seasonFor(date = new Date()) {
  // The fantasy season is labelled by its starting calendar year, and the new
  // one is not published until well into the spring.
  return date.getUTCMonth() >= 4 ? date.getUTCFullYear() : date.getUTCFullYear() - 1
}

async function collect(options) {
  const season = options.season ?? seasonFor()
  const url = `${ORIGIN}/apis/v3/games/ffl/seasons/${season}/players?scoringPeriodId=0&view=players_wl`

  const verdict = await guard(url, options)
  if (!verdict.allowed) throw new Error(`robots.txt disallows the player feed (${verdict.reason})`)

  // Without an explicit filter the feed returns only the first 50 players.
  const filter = { players: { limit: 20_000, filterActive: { value: true } } }
  const players = await fetchJson(url, {
    timeoutMs: 60_000,
    headers: { 'x-fantasy-filter': JSON.stringify(filter) },
    onRetry: options.onRetry,
  })
  if (!Array.isArray(players)) throw new Error('player feed was not an array')

  const entries = []
  for (const player of players) {
    const name = clean(player.fullName)
    const position = POSITION_BY_ID[player.defaultPositionId]
    if (!name || !position || player.id == null) continue
    entries.push({
      espnId: String(player.id),
      name,
      team: PRO_TEAMS[player.proTeamId] ?? null,
      position,
    })
  }
  if (entries.length < 500) {
    throw new Error(`only ${entries.length} players parsed; feed shape may have changed`)
  }

  return { season, sourceUrl: url, fetchedAt: Date.now(), entries }
}

/**
 * Collapses the feed into a lookup keyed by normalized name|team|position.
 * Names that resolve to more than one distinct id are dropped rather than
 * guessed -- a wrong id is worse than a missing one.
 */
export function buildCrosswalk(entries) {
  const byKey = new Map()
  const collisions = new Set()

  for (const entry of entries) {
    const key = playerKey(entry.name, entry.team, entry.position)
    const existing = byKey.get(key)
    if (existing && existing !== entry.espnId) collisions.add(key)
    else byKey.set(key, entry.espnId)
  }
  for (const key of collisions) byKey.delete(key)
  return byKey
}

export function espnTask(options = {}) {
  return { id: 'espn-crosswalk', run: () => collect(options) }
}
