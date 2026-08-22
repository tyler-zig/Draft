import type { RankRow } from './types'

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') {
        quoted = false
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\n') {
      row.push(cell.trim())
      if (row.some((c) => c.length > 0)) rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') {
      cell += ch
    }
  }
  row.push(cell.trim())
  if (row.some((c) => c.length > 0)) rows.push(row)
  return rows
}

function headerKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

const NAME_KEYS = new Set(['name', 'player', 'playername', 'fullname'])
const TEAM_KEYS = new Set(['team', 'tm', 'nfl'])
const POS_KEYS = new Set(['pos', 'position'])
const RANK_KEYS = new Set(['rank', 'overall', 'overallrank', 'ecr', 'adp'])
const SCORE_KEYS = new Set(['score', 'points', 'grade', 'rating', 'value'])
const ADP_KEYS = new Set(['adp', 'averagedraftposition', 'avgpick'])
const TIER_KEYS = new Set(['tier'])
const BYE_KEYS = new Set(['bye', 'byeweek'])
const SLEEPER_KEYS = new Set(['sleeperid', 'sleeper'])
const ESPN_KEYS = new Set(['espnid', 'espn'])

function pick(map: Record<string, string>, keys: Set<string>): string | undefined {
  for (const key of Object.keys(map)) {
    if (keys.has(key) && map[key]) return map[key]
  }
  return undefined
}

function toNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = Number(raw.replace(/[^0-9.+-]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

export function rowsFromCsv(text: string): RankRow[] {
  const table = parseCsvRows(text)
  const header = table[0]
  if (!header || header.length < 2) {
    throw new Error('CSV needs a header row and at least one player row')
  }
  const keys = header.map(headerKey)
  const body = table.slice(1)
  return body.map((cells) => {
    const map: Record<string, string> = {}
    keys.forEach((key, i) => {
      map[key] = cells[i] ?? ''
    })
    return {
      name: pick(map, NAME_KEYS) ?? '',
      team: pick(map, TEAM_KEYS) ?? null,
      position: pick(map, POS_KEYS) ?? null,
      overall: toNumber(pick(map, RANK_KEYS)),
      // ADP stays its own column even when it also stands in for the rank.
      adp: toNumber(pick(map, ADP_KEYS)) ?? null,
      tier: toNumber(pick(map, TIER_KEYS)) ?? null,
      byeWeek: toNumber(pick(map, BYE_KEYS)) ?? null,
      score: toNumber(pick(map, SCORE_KEYS)),
      sleeperId: pick(map, SLEEPER_KEYS),
      espnId: pick(map, ESPN_KEYS),
    }
  }).filter((row) => row.name || row.sleeperId || row.espnId)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number') return String(value)
  return undefined
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return toNumber(value)
  return undefined
}

function rowFromObject(obj: Record<string, unknown>): RankRow | null {
  const lower: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) lower[headerKey(k)] = v
  const name = str(lower.name) ?? str(lower.player) ?? str(lower.playername)
  const sleeperId = str(lower.sleeperid) ?? str(lower.sleeper)
  const espnId = str(lower.espnid) ?? str(lower.espn)
  if (!name && !sleeperId && !espnId) return null
  return {
    name: name ?? '',
    team: str(lower.team) ?? str(lower.tm) ?? null,
    position: str(lower.pos) ?? str(lower.position) ?? null,
    overall: num(lower.rank) ?? num(lower.overall) ?? num(lower.ecr) ?? num(lower.adp),
    // ADP is kept as its own fact, not only as a stand-in rank. Folding it into
    // `overall` and dropping it meant an imported board with an ADP column
    // contributed no ADP at all.
    adp: num(lower.adp) ?? num(lower.averagedraftposition) ?? null,
    best: num(lower.best) ?? num(lower.rankmin) ?? num(lower.ecrbest),
    worst: num(lower.worst) ?? num(lower.rankmax) ?? num(lower.ecrworst),
    tier: num(lower.tier) ?? null,
    byeWeek: num(lower.bye) ?? num(lower.byeweek) ?? null,
    score: num(lower.score) ?? num(lower.points) ?? num(lower.grade) ?? num(lower.rating),
    sleeperId,
    espnId,
  }
}

export function rowsFromJson(text: string): RankRow[] {
  const parsed: unknown = JSON.parse(text)
  const list = Array.isArray(parsed)
    ? parsed
    : (asRecord(parsed)?.players ??
        asRecord(parsed)?.ranks ??
        asRecord(parsed)?.rows)
  if (!Array.isArray(list)) {
    throw new Error('JSON must be an array of players, or { players: [...] }')
  }
  return list
    .map((item) => {
      const obj = asRecord(item)
      return obj ? rowFromObject(obj) : null
    })
    .filter((row): row is RankRow => Boolean(row))
}

export function parseRankingFile(filename: string, text: string): RankRow[] {
  if (filename.toLowerCase().endsWith('.json')) return rowsFromJson(text)
  return rowsFromCsv(text)
}

/**
 * Converts a table copied from a public rankings page into import rows. This is
 * deliberately paste-only: the user remains in control of what is collected
 * and browser/CORS or access controls are never worked around.
 */
export function rowsFromPastedRankings(text: string): RankRow[] {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Paste a rankings table first')

  // Excel and most browser tables paste as TSV. Reuse the CSV parser after
  // converting it; values containing commas are not meaningful in these rank
  // tables, whereas names with spaces are.
  if (trimmed.includes('\t')) {
    const lines = trimmed.split(/\r?\n/).map((line) =>
      line
        .split('\t')
        .map((cell) => `"${cell.replaceAll('"', '""')}"`)
        .join(','),
    )
    const first = lines[0]?.toLowerCase() ?? ''
    const withHeader = /rank|player|name/.test(first)
      ? lines.join('\n')
      : ['rank,player,team,pos', ...lines.map((line) => {
          const cells = parseCsvRows(line)[0] ?? []
          return [cells[0], cells[1], cells[2], cells[3]].join(',')
        })].join('\n')
    return rowsFromCsv(withHeader).filter((row) => row.overall || row.name)
  }

  const rows: RankRow[] = []
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/\s+/g, ' ')
    // Common copied-page form: "12 Player Name WR TEAM" or "12 Player Name TEAM WR".
    const match = line.match(/^(\d{1,4})[. ):-]+(.+?)\s+(QB|RB|WR|TE|K|DST|DEF)\s+([A-Z]{2,3})\b/i)
    if (!match) continue
    rows.push({
      overall: Number(match[1]),
      name: match[2].trim(),
      position: match[3].toUpperCase() === 'DEF' ? 'DST' : match[3].toUpperCase(),
      team: match[4].toUpperCase(),
    })
  }
  if (rows.length === 0) {
    throw new Error('Could not read that paste. Copy the rank, player, position, and team columns together.')
  }
  return rows
}
