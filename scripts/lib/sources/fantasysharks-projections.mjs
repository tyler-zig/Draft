/**
 * FantasySharks season projections.
 *
 * Each position is a public CSV (`?csv=1&Position=&Segment=`). Position 3 is
 * a dead slot that returns "Cache flushed"; WR is 4. The file is
 * header-driven so a column rename fails loudly instead of shifting stats
 * onto the wrong keys.
 *
 * Once kickoff week starts, omitting Segment defaults to Week 1 (Gibbs:
 * 63 rush yards). The season board is `{year} NFL Season` in the Period
 * dropdown (2026 = 874, then +32 per year). robots.txt allows the path
 * with Crawl-delay: 60. Honouring that is why this source runs on GitHub
 * Actions rather than an Edge Function.
 */

import { parse } from 'csv-parse/sync'
import { fetchText, guard } from '../http.mjs'
import { compactStats, flipLastFirst, hasVolume, isWeeklyProjection, pickNumber, seasonFor } from '../projection-stats.mjs'
import { clean, normalizePos, normalizeTeam } from '../text.mjs'

const ORIGIN = 'https://www.fantasysharks.com'
const PAGE = `${ORIGIN}/apps/bert/forecasts/projections.php`
/** Confirmed live Sept 2026. Later seasons increment by 32. */
const SEASON_SEGMENT = { year: 2026, id: 874 }

export const SHARK_BOARDS = [
  { id: 'fantasysharks-qb', positionId: 1, position: 'QB', minRows: 25 },
  { id: 'fantasysharks-rb', positionId: 2, position: 'RB', minRows: 40 },
  { id: 'fantasysharks-wr', positionId: 4, position: 'WR', minRows: 50 },
  { id: 'fantasysharks-te', positionId: 5, position: 'TE', minRows: 25 },
  { id: 'fantasysharks-def', positionId: 6, position: 'DEF', minRows: 20 },
  { id: 'fantasysharks-k', positionId: 7, position: 'K', minRows: 20 },
]

const COLUMNS = {
  pass_att: ['Att', 'Pass Att', 'PassAtt'],
  pass_cmp: ['Comp', 'Pass Comp', 'PassComp'],
  pass_yd: ['Pass Yds', 'PassYds', 'PYds'],
  pass_td: ['Pass TDs', 'PassTD', 'Pass TDs'],
  pass_int: ['Int'],
  rush_att: ['Rush', 'Rush Att', 'RushAtt'],
  rush_yd: ['Rush Yds', 'RushYds'],
  rush_td: ['Rush TDs', 'RushTD'],
  rec_tgt: ['Tgt', 'Targets'],
  rec: ['Rec'],
  rec_yd: ['Rec Yds', 'RecYds'],
  rec_td: ['Rec TDs', 'RecTD'],
  fum_lost: ['Fum Lost', 'FumLost', 'FL'],
  fgm: ['FG', 'FGM'],
  fga: ['FGA'],
  xpm: ['XP', 'XPM'],
  sack: ['Sacks', 'Sack', 'Scks'],
  int: ['Ints', 'INT', 'Int'],
  fum_rec: ['Fum Rec', 'FumRec'],
  def_td: ['Def TD', 'DefTD'],
  safe: ['Sfty', 'Safety', 'Safts'],
  pts_allow: ['Pts Allow', 'PtsAllow', 'PA', 'Pts Agn'],
}

function headerKey(name) {
  return String(name ?? '').replace(/^\uFEFF/, '').trim()
}

export function parseCsv(text, expectedPosition) {
  const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true })
  const parsed = []
  for (const row of rows) {
    const mapped = {}
    for (const [key, value] of Object.entries(row)) mapped[headerKey(key)] = value
    const result = toRow(mapped, expectedPosition)
    if (result) parsed.push(result)
  }
  return parsed
}

export function toRow(row, expectedPosition) {
  const rawName = clean(row['Player Name'] ?? row.Name ?? row.Player)
  const rawPosition = clean(row.Position ?? row.Pos ?? expectedPosition)
  const position = normalizePos(rawPosition === 'D' ? 'DEF' : rawPosition)
  if (!rawName || !position) return null
  if (expectedPosition && position !== expectedPosition) return null

  const name = position === 'DEF' ? rawName : flipLastFirst(rawName)
  const team = normalizeTeam(row.Team)
  const stats = compactStats(statsFromRow(row, position))
  if (!hasVolume(stats)) return null

  return {
    name: position === 'DEF' && team ? `${team} D/ST` : name,
    team,
    position,
    games: pickNumber(row, 'G', 'GP', 'Games'),
    stats,
    fantasySharksId: clean(row['Player ID'] ?? row.ID) || undefined,
  }
}

function statsFromRow(row, position) {
  const stats = {}
  for (const [key, names] of Object.entries(COLUMNS)) {
    if (key === 'pass_int' && position !== 'QB') continue
    if (key === 'int' && position === 'QB') continue
    if (key === 'rush_att' && position === 'QB') {
      const amount = pickNumber(row, 'Rush', 'Rush Att', 'RushAtt')
      if (amount != null) stats.rush_att = amount
      continue
    }
    if (key === 'pass_att' && position !== 'QB') continue
    if (key === 'fga' && position === 'K') {
      const attempts = pickNumber(row, 'Att', 'FGA')
      if (attempts != null) stats.fga = attempts
      continue
    }
    if (key === 'fum_rec' && position === 'DEF') {
      const recovered = pickNumber(row, 'Fum', 'Fum Rec', 'FumRec')
      if (recovered != null) stats.fum_rec = recovered
      continue
    }
    const amount = pickNumber(row, ...names)
    if (amount != null) stats[key] = amount
  }
  return stats
}

export function seasonSegmentGuess(season) {
  return SEASON_SEGMENT.id + (Number(season) - SEASON_SEGMENT.year) * 32
}

export function parseSegments(html) {
  const block = String(html ?? '').match(/<select[^>]*name=["']Segment["'][^>]*>([\s\S]*?)<\/select>/i)
  if (!block) return []
  const options = []
  for (const match of block[1].matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/gi)) {
    const value = match[1].match(/value=["'](\d+)["']/i)
    if (!value) continue
    const label = clean(match[2].replace(/&nbsp;/gi, ' ').replace(/<[^>]+>/g, ''))
    if (label) options.push({ id: Number(value[1]), label })
  }
  return options
}

export function pickSeasonSegment(options, season) {
  const year = String(season)
  const seasonRow = options.find((row) => new RegExp(`^${year}\\s+NFL Season$`, 'i').test(row.label))
  if (seasonRow) return seasonRow.id
  const ros = options.find((row) => new RegExp(`^${year}\\s+Rest of Year$`, 'i').test(row.label))
  return ros?.id ?? null
}

export function boardUrl(board, segment) {
  const params = new URLSearchParams({ csv: '1', Position: String(board.positionId) })
  if (segment != null) params.set('Segment', String(segment))
  return `${PAGE}?${params}`
}

async function resolveSeasonSegment(options) {
  if (options.segment != null) return Number(options.segment)
  const season = options.season ?? seasonFor()
  const fallback = seasonSegmentGuess(season)
  try {
    const verdict = await guard(PAGE, options)
    if (!verdict.allowed) return fallback
    const { text } = await fetchText(PAGE, { onRetry: options.onRetry })
    return pickSeasonSegment(parseSegments(text), season) ?? fallback
  } catch {
    return fallback
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function collectBoard(board, options) {
  const segment = options.segment ?? await resolveSeasonSegment(options)
  const url = boardUrl(board, segment)
  const verdict = await guard(url, options)
  if (!verdict.allowed) throw new Error(`robots.txt disallows FantasySharks projections (${verdict.reason})`)

  let lastFlush = null
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const { text } = await fetchText(url, { accept: 'text/csv,text/plain,*/*', onRetry: options.onRetry })
    if (/cache flushed/i.test(text)) {
      lastFlush = `FantasySharks position ${board.positionId} flushed its cache`
      if (attempt === 4) throw new Error(lastFlush)
      const wait = 8_000 * attempt
      options.onRetry?.({ url, attempt, status: null, waitMs: wait, error: lastFlush })
      await sleep(wait)
      continue
    }

    const rows = parseCsv(text, board.position)
    if (rows.length < board.minRows) {
      throw new Error(`only ${rows.length} FantasySharks ${board.position} rows; the board may have changed`)
    }
    const weekly = rows.filter((row) => isWeeklyProjection(row)).length
    if (weekly > rows.length / 2) {
      throw new Error(`FantasySharks ${board.position} board looks weekly (${weekly}/${rows.length} rows); expected season Segment`)
    }

    return {
      id: board.id,
      label: `FantasySharks ${board.position}`,
      sourceId: 'fantasysharks',
      sourceUrl: url,
      fetchedAt: Date.now(),
      rows,
    }
  }

  throw new Error(lastFlush ?? `FantasySharks ${board.position} produced no rows`)
}

export function fantasySharksProjectionTasks(options = {}) {
  const segmentReady = options.segment != null
    ? Promise.resolve(Number(options.segment))
    : resolveSeasonSegment(options)
  return SHARK_BOARDS.map((board) => ({
    id: board.id,
    run: async () => collectBoard(board, { ...options, segment: await segmentReady }),
  }))
}

export const __test__ = { parseCsv, toRow, SHARK_BOARDS, COLUMNS, boardUrl, parseSegments, pickSeasonSegment, seasonSegmentGuess }
