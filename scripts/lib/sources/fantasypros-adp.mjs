/**
 * FantasyPros real-time ADP.
 *
 * The /nfl/real-time-adp/ page is a Vue app; the board is not embedded in the
 * HTML. Its bundle fetches partners.fantasypros.com/api/v1/expert-rankings.php
 * (expert id 7556) and prints `rank` plus `rank_adp_raw` as ADP. That request
 * is what a browser loading the page performs. The older consensus-rankings
 * feed is a different board: it has no `rank_adp_raw`, and storing its
 * `rank_ecr` as ADP is how Texans showed 83/108 instead of 105.6.
 *
 * Scoring must be the uppercase token the page sends (HALF/PPR/STD). The five
 * format dropdowns are type+scoring pairs; a `teams` query param is ignored,
 * so size-specific live ADP is collected from Draft Wizard as a fallback.
 *
 * `published` is the page's last-updated clock and sits before `players`, so
 * we can abort the download when it has not moved since adp-latest. Each row
 * also keeps Last 1 / Last 7 rolling ADP (`rank_last_one`, `rank_last_seven`)
 * so the app can draw a trend before two hourly snapshots exist.
 *
 * partners.fantasypros.com's robots.txt is `Disallow: /`. The page itself is
 * allowed; we still guard the page URL and fetch the same public payload the
 * page loads. Pass --ignore-robots to skip the check.
 *
 * Mirrors supabase/functions/_shared/ranking-collector.ts; keep the two in sync.
 */

import { fetchJsonUnlessPublished, guard } from '../http.mjs'
import { clean, normalizePos, normalizeTeam, toNumber } from '../text.mjs'

const PAGE_URL = 'https://www.fantasypros.com/nfl/real-time-adp/'
const API_ORIGIN = 'https://partners.fantasypros.com'
const EXPERT_ID = '7556'

/**
 * The five boards the page's format dropdown loads. `id` for half-PPR stays
 * `fantasypros-rtadp` so existing artifacts and ranking history keep matching.
 */
export const RT_ADP_BOARDS = [
  { id: 'fantasypros-rtadp', key: 'redraft-half', slug: '', label: 'FantasyPros Real-Time ADP (Half PPR)', scoring: 'half', type: 'adp', scoringParam: 'HALF', minRows: 100 },
  { id: 'fantasypros-rtadp-ppr', key: 'redraft-ppr', slug: 'ppr', label: 'FantasyPros Real-Time ADP (PPR)', scoring: 'ppr', type: 'adp', scoringParam: 'PPR', minRows: 100 },
  { id: 'fantasypros-rtadp-std', key: 'redraft-std', slug: 'std', label: 'FantasyPros Real-Time ADP (Standard)', scoring: 'standard', type: 'adp', scoringParam: 'STD', minRows: 100 },
  { id: 'fantasypros-rtadp-dynasty', key: 'dynasty', slug: 'dynasty', label: 'FantasyPros Real-Time ADP (Dynasty)', scoring: 'dynasty', type: 'dynadp', scoringParam: 'PPR', minRows: 100 },
  { id: 'fantasypros-rtadp-rookie', key: 'rookie', slug: 'rookie', label: 'FantasyPros Real-Time ADP (Rookie)', scoring: 'rookie', type: 'rkadp', scoringParam: 'HALF', minRows: 25 },
]

/**
 * The fantasy season is labelled by its starting calendar year, and the new
 * one is not published until well into the spring. (Same rule as the ESPN
 * crosswalk.) FantasyPros pins the season with window.FP.appSettings.adp_season,
 * so an over-early guess fails loudly below and --season fixes it.
 */
function seasonFor(date = new Date()) {
  return date.getUTCMonth() >= 4 ? date.getUTCFullYear() : date.getUTCFullYear() - 1
}

function boardFor(key) {
  return RT_ADP_BOARDS.find((board) => board.key === key || board.id === key) ?? RT_ADP_BOARDS[0]
}

export function buildUrl(season, boardKey = 'redraft-half', position = 'ALL') {
  const board = boardFor(boardKey)
  const params = new URLSearchParams({
    id: EXPERT_ID,
    year: String(season),
    position,
    type: board.type,
    scoring: board.scoringParam,
  })
  return `${API_ORIGIN}/api/v1/expert-rankings.php?${params.toString()}`
}

function pageUrl(board) {
  return board.slug ? `${PAGE_URL}${board.slug}/` : PAGE_URL
}

/** The page clock lives at the top of the ALL payload, before `players`. */
export function readPublished(text) {
  const match = String(text ?? '').match(/"published"\s*:\s*"([^"]+)"/)
  return match?.[1] ?? null
}

export function previousPublished(set) {
  return clean(set?.meta?.lastUpdated) || null
}

export function canReuseSet(set, minRows) {
  if (!Array.isArray(set?.rows) || set.rows.length < minRows) return false
  // A board stored before we kept Last 1 / Last 7 is not reusable: the
  // published stamp can match while those windows are still missing.
  return set.rows.some((row) => row.adpLastOne != null || row.adpLastSeven != null)
}

/**
 * FantasyPros stamps this in Eastern. August is EDT; a one-hour winter
 * offset only moves the inferred 1-day / 7-day chart points, not ADP.
 */
export function parsePublishedAt(value) {
  const match = String(value ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/)
  if (!match) return null
  const parsed = Date.parse(`${match[1]}T${match[2]}-04:00`)
  return Number.isFinite(parsed) ? parsed : null
}

export function previousSetsById(sets) {
  const map = new Map()
  for (const set of Array.isArray(sets) ? sets : []) {
    if (set?.id) map.set(set.id, set)
  }
  return map
}

export function reusePreviousSet(previous, published) {
  const now = Date.now()
  return {
    ...previous,
    fetchedAt: now,
    meta: {
      ...previous.meta,
      lastUpdated: published ?? previous.meta?.lastUpdated ?? null,
      reused: true,
      checkedAt: now,
    },
  }
}

function toRow(entry) {
  const name = clean(entry.player_name)
  const overall = toNumber(entry.rank) ?? toNumber(entry.rank_adp_overall)
  if (!name || !overall) return null
  // The page prints parseFloat(rank_adp_raw) || parseInt(rank).
  const adp = toNumber(entry.rank_adp_raw) ?? overall

  return {
    name,
    team: normalizeTeam(entry.player_team_id),
    position: normalizePos(entry.player_position_id ?? entry.player_positions),
    overall,
    adp,
    // Rolling windows the page prints as Last 1 / Last 7. vs = window - now,
    // so a positive vs means the player is being drafted earlier than that
    // window (Texans 114.9 → 105.6 is vs_last_one 9.3).
    adpLastOne: toNumber(entry.rank_last_one),
    adpLastSeven: toNumber(entry.rank_last_seven),
    adpVsLastOne: toNumber(entry.rank_vs_last_one),
    adpVsLastSeven: toNumber(entry.rank_vs_last_seven),
    best: toNumber(entry.rank_ecr_min ?? entry.rank_min),
    worst: toNumber(entry.rank_ecr_max ?? entry.rank_max),
    average: adp,
    stdDev: toNumber(entry.rank_std),
    tier: null,
    positionRank: clean(entry.pos_rank) || null,
    byeWeek: toNumber(entry.bye_week ?? entry.player_bye_week),
    fantasyProsId: entry.player_id != null ? String(entry.player_id) : undefined,
    ownedAvg: toNumber(entry.player_owned_avg),
    ownedEspn: toNumber(entry.player_owned_espn),
    ownedYahoo: toNumber(entry.player_owned_yahoo),
  }
}

function boardFromPayload(board, data, rows) {
  return {
    id: board.id,
    label: board.label,
    scoring: board.scoring,
    sourceUrl: pageUrl(board),
    fetchedAt: Date.now(),
    meta: {
      format: board.key,
      season: clean(data.year) || null,
      lastUpdated: clean(data.published) || null,
      type: clean(data.type) || null,
      scoringParam: clean(data.scoring) || null,
      positionId: clean(data.position_id) || null,
      count: toNumber(data.count),
      availableAdp: data.available_adp && typeof data.available_adp === 'object' ? data.available_adp : null,
    },
    rows,
  }
}

async function collectBoard(board, options) {
  const season = options.season ?? seasonFor()
  const url = buildUrl(season, board.key)
  const previous = options.previousById?.get(board.id)
  const knownPublished = canReuseSet(previous, board.minRows) ? previousPublished(previous) : null

  const verdict = await guard(pageUrl(board), options)
  if (!verdict.allowed) throw new Error(`robots.txt disallows ${new URL(pageUrl(board)).pathname} (${verdict.reason})`)

  const result = await fetchJsonUnlessPublished(url, knownPublished, {
    headers: { referer: pageUrl(board) },
    onRetry: options.onRetry,
    readPublished,
  })
  if (result.unchanged) {
    return { set: reusePreviousSet(previous, result.published), skipped: `unchanged since ${result.published}` }
  }

  const data = result.data
  if (typeof data.message === 'string') throw new Error(`FantasyPros API: ${data.message}`)

  const players = Array.isArray(data.players) ? data.players : []
  const rows = players.map(toRow).filter(Boolean)
  if (rows.length < board.minRows) {
    throw new Error(`only ${rows.length} rows parsed from ${board.key}; the board may be empty for season ${season}`)
  }

  return boardFromPayload(board, data, rows)
}

export function fantasyProsAdpTasks(options = {}) {
  const previousById = options.previousById ?? previousSetsById(options.previousSets)
  return RT_ADP_BOARDS.map((board) => ({
    id: board.id,
    run: () => collectBoard(board, { ...options, previousById }),
  }))
}

export const __test__ = {
  buildUrl, toRow, seasonFor, boardFor, RT_ADP_BOARDS, EXPERT_ID,
  readPublished, previousPublished, canReuseSet, parsePublishedAt, reusePreviousSet, previousSetsById,
}
