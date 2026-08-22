/**
 * FantasyPros expert consensus rankings.
 *
 * The board is embedded in the page as a `var ecrData = {...}` literal, which
 * carries the whole field -- several hundred players with per-expert spread --
 * so the allowed HTML page yields strictly more than scraping a rendered
 * table would. (Their /api/ and /json/ endpoints serve the same payload but
 * are robots-disallowed, and would not add a single row.)
 */

import { fetchText, guard } from '../http.mjs'
import { clean, normalizePos, normalizeTeam, toNumber } from '../text.mjs'

const BOARDS = [
  { id: 'fantasypros-ppr', label: 'FantasyPros ECR (PPR)', scoring: 'ppr', path: '/nfl/rankings/ppr-cheatsheets.php' },
  { id: 'fantasypros-half', label: 'FantasyPros ECR (Half PPR)', scoring: 'half', path: '/nfl/rankings/half-point-ppr-cheatsheets.php' },
  { id: 'fantasypros-standard', label: 'FantasyPros ECR (Standard)', scoring: 'standard', path: '/nfl/rankings/cheatsheets.php' },
]

const ORIGIN = 'https://www.fantasypros.com'
const BACKSLASH = 92

function extractEcrData(html) {
  const start = html.indexOf('var ecrData')
  if (start === -1) throw new Error('ecrData block not found; page layout may have changed')
  const open = html.indexOf('{', start)
  if (open === -1) throw new Error('ecrData block was not an object')

  // Brace-match rather than regex: the payload contains nested objects and
  // escaped quotes, and a lazy regex stops at the first `};` inside a string.
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = open; i < html.length; i += 1) {
    const char = html[i]
    if (escaped) { escaped = false; continue }
    if (char.charCodeAt(0) === BACKSLASH) { escaped = true; continue }
    if (char === '"') { inString = !inString; continue }
    if (inString) continue
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return JSON.parse(html.slice(open, i + 1))
    }
  }
  throw new Error('ecrData block was not terminated')
}

function toRow(entry) {
  const name = clean(entry.player_name)
  const overall = toNumber(entry.rank_ecr)
  if (!name || !overall) return null

  const positionRank = clean(entry.pos_rank)
  return {
    name,
    team: normalizeTeam(entry.player_team_id),
    position: normalizePos(entry.player_position_id),
    overall,
    // Per-expert spread: how much disagreement sits behind this rank.
    best: toNumber(entry.rank_min),
    worst: toNumber(entry.rank_max),
    average: toNumber(entry.rank_ave),
    stdDev: toNumber(entry.rank_std),
    tier: toNumber(entry.tier),
    positionRank: positionRank || null,
    byeWeek: toNumber(entry.player_bye_week),
    fantasyProsId: entry.player_id != null ? String(entry.player_id) : undefined,
  }
}

async function collectBoard(board, options) {
  const url = `${ORIGIN}${board.path}`
  const verdict = await guard(url, options)
  if (!verdict.allowed) throw new Error(`robots.txt disallows ${board.path} (${verdict.reason})`)

  const { text } = await fetchText(url, { onRetry: options.onRetry })
  const data = extractEcrData(text)
  const players = Array.isArray(data.players) ? data.players : []
  const rows = players.map(toRow).filter(Boolean)
  if (rows.length < 50) {
    throw new Error(`only ${rows.length} rows parsed; page layout may have changed`)
  }

  return {
    id: board.id,
    label: board.label,
    scoring: board.scoring,
    sourceUrl: url,
    fetchedAt: Date.now(),
    meta: {
      experts: toNumber(data.total_experts),
      lastUpdated: clean(data.last_updated) || null,
      season: clean(data.year) || null,
    },
    rows,
  }
}

export function fantasyProsTasks(options = {}) {
  return BOARDS.map((board) => ({
    id: board.id,
    run: () => collectBoard(board, options),
  }))
}

export const __test__ = { extractEcrData, toRow }
