/**
 * CBS Sports rest-of-season projection tables.
 *
 * Once kickoff week starts, `/season/projections/` is Week 1 (gp=1, ~90
 * rush yards for Gibbs). The season-long board moves to
 * `/restofseason/projections/ppr/`. Volume is the same on the standard
 * board; we collect PPR so one request per position is enough. Half-PPR
 * is not published (those slugs 301). robots.txt allows `/fantasy/`.
 */

import { fetchText, guard } from '../http.mjs'
import { compactStats, hasVolume, isWeeklyProjection, seasonFor } from '../projection-stats.mjs'
import { clean, normalizePos, normalizeTeam, toNumber } from '../text.mjs'

const ORIGIN = 'https://www.cbssports.com'

export const CBS_BOARDS = [
  { id: 'cbs-qb', position: 'QB', minRows: 25 },
  { id: 'cbs-rb', position: 'RB', minRows: 40 },
  { id: 'cbs-wr', position: 'WR', minRows: 40 },
  { id: 'cbs-te', position: 'TE', minRows: 25 },
  { id: 'cbs-k', position: 'K', minRows: 20 },
  { id: 'cbs-dst', position: 'DST', minRows: 20 },
]

/**
 * Body cells after the player column, in document order. Names that are not
 * STAT_KEYS (avg, fpts, …) are ignored when compacting.
 */
export const CBS_COLUMNS = {
  QB: ['gp', 'pass_att', 'pass_cmp', 'pass_yd', 'pass_ypg', 'pass_td', 'pass_int', 'passer_rating', 'rush_att', 'rush_yd', 'rush_avg', 'rush_td', 'fum_lost', 'fpts', 'fppg'],
  RB: ['gp', 'rush_att', 'rush_yd', 'rush_avg', 'rush_td', 'rec_tgt', 'rec', 'rec_yd', 'rec_ypg', 'rec_avg', 'rec_td', 'fum_lost', 'fpts', 'fppg'],
  WR: ['gp', 'rec_tgt', 'rec', 'rec_yd', 'rec_ypg', 'rec_avg', 'rec_td', 'rush_att', 'rush_yd', 'rush_avg', 'rush_td', 'fum_lost', 'fpts', 'fppg'],
  TE: ['gp', 'rec_tgt', 'rec', 'rec_yd', 'rec_ypg', 'rec_avg', 'rec_td', 'fum_lost', 'fpts', 'fppg'],
  K: ['gp', 'fgm', 'fga', 'lng', 'fg_1_19', 'fg_1_19a', 'fg_20_29', 'fg_20_29a', 'fg_30_39', 'fg_30_39a', 'fg_40_49', 'fg_40_49a', 'fg_50', 'fg_50a', 'xpm', 'xpa', 'fpts', 'fppg'],
  DST: ['int', 'safe', 'sack', 'tk', 'fum_rec', 'fum', 'def_td', 'pts_allow', 'ppg', 'pass_yd_allow', 'rush_yd_allow', 'yds_allow', 'ypg', 'fpts', 'fppg'],
}

export function boardUrl(position, season) {
  const slug = position === 'DEF' ? 'DST' : position
  return `${ORIGIN}/fantasy/football/stats/${slug}/${season}/restofseason/projections/ppr/`
}

function cellNumbers(block) {
  return [...block.matchAll(/TableBase-bodyTd--number[^>]*>([\s\S]*?)<\/td>/g)]
    .map((match) => toNumber(match[1].replace(/<[^>]+>/g, '')))
}

function playerFromRow(block) {
  const long = block.match(/CellPlayerName--long[\s\S]*?href="\/nfl\/players\/(\d+)\/[^"]*"[^>]*>([^<]+)<[\s\S]*?CellPlayerName-position[^>]*>([\s\S]*?)<\/span>[\s\S]*?CellPlayerName-team[^>]*>([\s\S]*?)<\/span>/)
  if (long) {
    return {
      cbsId: long[1],
      name: clean(long[2]),
      position: normalizePos(long[3]),
      team: normalizeTeam(long[4]),
    }
  }
  // DST rows use a team lockup, not a player name cell.
  const teamLink = block.match(/TeamName[\s\S]*?href="\/nfl\/teams\/([A-Z]{2,3})\/[^"]*"[^>]*>([^<]+)</)
  if (teamLink) {
    return {
      cbsId: teamLink[1],
      name: clean(teamLink[2]),
      position: 'DEF',
      team: normalizeTeam(teamLink[1]),
    }
  }
  return null
}

export function parseBoard(html, position) {
  const columns = CBS_COLUMNS[position === 'DEF' ? 'DST' : position]
  if (!columns) throw new Error(`no CBS column map for ${position}`)

  const rows = []
  for (const block of html.split('<tr').slice(1)) {
    if (!block.includes('TableBase-bodyTr') && !block.includes('TableBase-bodyTd')) continue
    const player = playerFromRow(block)
    if (!player?.name) continue
    const expected = position === 'DST' ? 'DEF' : position
    const pos = player.position ?? expected
    if (pos !== expected) continue

    const values = cellNumbers(block)
    if (values.length < 4) continue
    const stats = {}
    let games = null
    for (let i = 0; i < columns.length && i < values.length; i += 1) {
      const key = columns[i]
      const amount = values[i]
      if (amount == null) continue
      if (key === 'gp') games = amount
      else stats[key] = amount
    }
    const compact = compactStats(stats)
    if (!hasVolume(compact)) continue
    rows.push({
      name: pos === 'DEF' && player.team ? `${player.team} D/ST` : player.name,
      team: player.team,
      position: pos,
      games,
      stats: compact,
      cbsId: player.cbsId,
    })
  }
  return rows
}

async function collectBoard(board, options) {
  const season = options.season ?? seasonFor()
  const url = boardUrl(board.position, season)
  const verdict = await guard(url, options)
  if (!verdict.allowed) throw new Error(`robots.txt disallows CBS projections (${verdict.reason})`)

  const { text } = await fetchText(url, { timeoutMs: 40_000, onRetry: options.onRetry })
  const rows = parseBoard(text, board.position)
  if (rows.length < board.minRows) {
    throw new Error(`only ${rows.length} CBS ${board.position} rows; the table may have changed`)
  }
  const weekly = rows.filter((row) => isWeeklyProjection(row)).length
  if (weekly > rows.length / 2) {
    throw new Error(`CBS ${board.position} board looks weekly (${weekly}/${rows.length} rows); expected rest-of-season`)
  }

  return {
    id: board.id,
    label: `CBS ${board.position === 'DST' ? 'DEF' : board.position}`,
    sourceId: 'cbs',
    sourceUrl: url,
    fetchedAt: Date.now(),
    rows,
  }
}

export function cbsProjectionTasks(options = {}) {
  return CBS_BOARDS.map((board) => ({
    id: board.id,
    run: () => collectBoard(board, options),
  }))
}

export const __test__ = { parseBoard, boardUrl, playerFromRow, CBS_BOARDS, CBS_COLUMNS }
