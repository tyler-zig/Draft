/**
 * RotoWire expert ranking boards.
 *
 * rankings.php ships one pre-rendered panel and pulls the rest from
 * /football/ajax/get-rankings-board.php. Each board is capped at ten rows with
 * no pagination, so breadth has to come from the matrix instead: seven expert
 * sources x three scoring formats x five positions. The page embeds an
 * availability map telling us which source/format pairs actually exist --
 * asking for a pair that does not silently returns a *different* board, so we
 * both consult the map up front and verify what the server echoes back.
 *
 * Each row carries ADP and a stable RotoWire player id, which is worth more
 * for matching than the name alone.
 */

import { fetchJson, fetchText, guard } from '../http.mjs'
import { clean, normalizePos, normalizeTeam, toNumber } from '../text.mjs'

const ORIGIN = 'https://www.rotowire.com'
const PAGE = `${ORIGIN}/football/rankings.php`
const ENDPOINT = `${ORIGIN}/football/ajax/get-rankings-board.php`

const POSITIONS = ['OV', 'QB', 'RB', 'WR', 'TE']

const SOURCE_LABELS = {
  consensus: 'Consensus',
  official: 'RotoWire Official',
  gremminger: 'Gremminger',
  hartitz: 'Hartitz',
  may: 'May',
  erickson: 'Erickson',
  coventry: 'Coventry',
}

const SCORING_BY_FORMAT = { ppr: 'ppr', 'half-ppr': 'half', standard: 'standard' }

/** Reads the availability matrix the page embeds for its own tab controller. */
export function parseAvailability(html) {
  const marker = 'rhBoardAvailability"'
  const start = html.indexOf(marker)
  if (start === -1) return null
  const open = html.indexOf('>', start)
  const close = html.indexOf('</script>', open)
  if (open === -1 || close === -1) return null
  try {
    return JSON.parse(html.slice(open + 1, close))
  } catch {
    return null
  }
}

/**
 * Rows are structured markup, not a flat table, so pull each field from its
 * own class rather than regexing a joined cell string.
 */
export function parseBoard(boardHtml) {
  const rows = []
  const blocks = boardHtml.split('<tr').slice(1)

  for (const block of blocks) {
    const rank = toNumber((block.match(/rh-board__col--rank"[^>]*>([^<]*)</) ?? [])[1])
    const nameMatch = block.match(/rh-player__name"[^>]*href="([^"]*)"[^>]*>([^<]+)</)
    if (!rank || !nameMatch) continue

    const name = clean(nameMatch[2])
    const position = (block.match(/rh-player__pos--([A-Z]+)/) ?? [])[1]
    // The team abbreviation is the bare text after the (optional) logo img.
    const teamCell = (block.match(/rh-player__team"[^>]*>([\s\S]*?)<\/span>/) ?? [])[1] ?? ''
    const team = clean(teamCell.replace(/<[^>]*>/g, ''))
    const adp = toNumber((block.match(/rh-board__col--adp"[^>]*>([^<]*)</) ?? [])[1])
    const trendRaw = clean(((block.match(/rh-trend[^>]*>([^<]*)</) ?? [])[1] ?? '').replace(/&[a-z]+;/g, ''))

    // The profile href ends in a stable numeric id: /football/player/slug-16808
    const rotowireId = (nameMatch[1].match(/-(\d+)(?:\?|$)/) ?? [])[1]

    rows.push({
      name,
      team: normalizeTeam(team),
      position: normalizePos(position),
      overall: rank,
      adp,
      trend: trendRaw && trendRaw !== '—' ? trendRaw : null,
      rotowireId,
    })
  }
  return rows
}

async function fetchMatrix(options) {
  const verdict = await guard(PAGE, options)
  if (!verdict.allowed) throw new Error(`robots.txt disallows the rankings page (${verdict.reason})`)
  const { text } = await fetchText(PAGE, { onRetry: options.onRetry })
  const availability = parseAvailability(text)
  if (!availability) throw new Error('availability matrix not found; page layout may have changed')
  return availability
}

async function collectBoard({ source, format, pos }, options) {
  const url = `${ENDPOINT}?source=${source}&format=${format}&pos=${pos}`
  const verdict = await guard(url, options)
  if (!verdict.allowed) throw new Error(`robots.txt disallows the board endpoint (${verdict.reason})`)

  const payload = await fetchJson(url, { onRetry: options.onRetry })
  if (!payload?.success) throw new Error('board endpoint reported failure')

  // The server moves us off combinations it cannot serve, so the reply may not
  // describe the request. Anything that drifted is a duplicate of another cell.
  if (payload.source !== source || payload.format !== format || payload.pos !== pos) {
    return { skipped: `server served ${payload.source}/${payload.format}/${payload.pos}` }
  }

  const rows = parseBoard(payload.boardHTML ?? '')
  if (rows.length === 0) return { skipped: 'no rows in board' }

  const label = `RotoWire ${SOURCE_LABELS[source] ?? source} ${format.toUpperCase()} ${pos}`
  return {
    set: {
      id: `rotowire-${source}-${format}-${pos.toLowerCase()}`,
      label,
      scoring: SCORING_BY_FORMAT[format] ?? 'unknown',
      sourceUrl: url,
      fetchedAt: Date.now(),
      meta: { expert: source, position: pos, boardTitle: clean(payload.boardTitle) || null },
      rows,
    },
  }
}

/**
 * Expands the availability matrix into one task per valid board. Positions are
 * not in the matrix (it is keyed by source|format), so every position is tried
 * and empty ones are skipped at collection time.
 */
export async function rotowireTasks(options = {}) {
  const availability = await fetchMatrix(options)
  const tasks = []

  for (const [key, available] of Object.entries(availability)) {
    if (!available) continue
    const [source, format] = key.split('|')
    if (!source || !format) continue
    for (const pos of POSITIONS) {
      tasks.push({
        id: `rotowire-${source}-${format}-${pos.toLowerCase()}`,
        run: () => collectBoard({ source, format, pos }, options),
      })
    }
  }
  return tasks
}
