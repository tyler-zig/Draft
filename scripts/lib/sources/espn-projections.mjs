/**
 * ESPN default-league season projections.
 *
 * leaguedefaults/3 is the public PPR board. A limit without a sort is 400;
 * sortDraftRanks + limit returns the full pool with season totals on
 * statSourceId=1, scoringPeriodId=0, statSplitTypeId=0.
 *
 * Stat ids below are the player.stats blob (not scoringSettings.scoringItems).
 * 24 is season rush yards; 40 on the same blob is yards per game and must
 * not be folded in. Identity ids match the existing ESPN crosswalk.
 */

import { fetchJson, guard } from '../http.mjs'
import { compactStats, hasVolume, seasonFor } from '../projection-stats.mjs'
import { clean, normalizePos } from '../text.mjs'

const ORIGIN = 'https://lm-api-reads.fantasy.espn.com'

const PRO_TEAMS = {
  0: null, 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN',
  8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR',
  15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI',
  22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH',
  29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
}

const POSITION_BY_ID = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' }

/** player.stats keys -> our volume keys. Per-game aliases are omitted. */
export const ESPN_STAT_IDS = {
  0: 'pass_att',
  1: 'pass_cmp',
  3: 'pass_yd',
  4: 'pass_td',
  19: 'pass_2pt',
  20: 'pass_int',
  23: 'rush_att',
  24: 'rush_yd',
  25: 'rush_td',
  26: 'rush_2pt',
  42: 'rec_yd',
  43: 'rec_td',
  53: 'rec',
  72: 'fum_lost',
  80: 'fgm',
  81: 'fga',
  86: 'xpm',
  95: 'int',
  96: 'fum_rec',
  99: 'sack',
  120: 'pts_allow',
}

const SEASON_FILTER = {
  players: {
    limit: 2_000,
    sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'PPR' },
  },
}

export function buildUrl(season) {
  return `${ORIGIN}/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info&scoringPeriodId=0`
}

export function seasonStats(stats) {
  if (!Array.isArray(stats)) return null
  return stats.find((entry) => (
    entry
    && entry.scoringPeriodId === 0
    && entry.statSourceId === 1
    && (entry.statSplitTypeId === 0 || entry.statSplitTypeId == null)
    && entry.stats
    && typeof entry.stats === 'object'
  )) ?? null
}

export function statsFromEspn(blob) {
  const stats = {}
  if (!blob || typeof blob !== 'object') return stats
  for (const [id, key] of Object.entries(ESPN_STAT_IDS)) {
    const amount = blob[id] ?? blob[Number(id)]
    if (typeof amount === 'number' && Number.isFinite(amount)) stats[key] = amount
  }
  return compactStats(stats)
}

export function toRow(entry, season) {
  const player = entry?.player && typeof entry.player === 'object' ? entry.player : entry
  if (!player) return null
  const name = clean(player.fullName)
  const position = POSITION_BY_ID[player.defaultPositionId]
  if (!name || !position || player.id == null) return null

  const line = seasonStats(player.stats)
  const mapped = line ? statsFromEspn(line.stats) : {}
  if (!hasVolume(mapped)) return null

  const games = typeof line?.stats?.[210] === 'number' ? line.stats[210]
    : typeof line?.stats?.['210'] === 'number' ? line.stats['210']
      : null

  return {
    name,
    team: PRO_TEAMS[player.proTeamId] ?? null,
    position: normalizePos(position),
    espnId: String(player.id),
    games,
    stats: mapped,
    season: season != null ? String(season) : undefined,
  }
}

async function collect(options = {}) {
  const season = options.season ?? seasonFor()
  const url = buildUrl(season)
  const verdict = await guard(url, options)
  if (!verdict.allowed) throw new Error(`robots.txt disallows the ESPN projection feed (${verdict.reason})`)

  const payload = await fetchJson(url, {
    timeoutMs: 60_000,
    headers: { 'x-fantasy-filter': JSON.stringify(SEASON_FILTER) },
    onRetry: options.onRetry,
  })
  const players = Array.isArray(payload) ? payload : payload?.players
  if (!Array.isArray(players)) throw new Error('ESPN projection feed was not an array')

  const rows = players.map((entry) => toRow(entry, season)).filter(Boolean)
  if (rows.length < 200) {
    throw new Error(`only ${rows.length} ESPN projection rows; the feed shape may have changed`)
  }

  return {
    id: 'espn-projections',
    label: 'ESPN',
    sourceId: 'espn',
    sourceUrl: url,
    fetchedAt: Date.now(),
    rows,
  }
}

export function espnProjectionTasks(options = {}) {
  return [{ id: 'espn-projections', run: () => collect(options) }]
}

export const __test__ = {
  toRow, seasonStats, statsFromEspn, buildUrl, ESPN_STAT_IDS, POSITION_BY_ID, PRO_TEAMS, SEASON_FILTER,
}
