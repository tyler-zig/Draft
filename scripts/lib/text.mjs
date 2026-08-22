/**
 * Normalizers mirroring src/rankings/normalize.ts. They are duplicated rather
 * than imported because this script runs in plain Node with no TypeScript
 * build step; keep the two in sync when either changes.
 */

const SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b/g
const PUNCT = /[.'’`-]/g

const TEAM_ALIASES = {
  JAC: 'JAX',
  WAS: 'WSH',
  WASHINGTON: 'WSH',
  LA: 'LAR',
  STL: 'LAR',
  SD: 'LAC',
  OAK: 'LV',
  ARZ: 'ARI', // RotoWire's code for Arizona.
  BLT: 'BAL',
  CLV: 'CLE',
  HST: 'HOU',
}

export function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function normalizeName(value) {
  return clean(value)
    .toLowerCase()
    .replace(PUNCT, '')
    .replace(SUFFIX, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeTeam(value) {
  const team = clean(value).toUpperCase()
  if (!team || team === 'FA' || team === 'DST' || team === 'DEF') return null
  return TEAM_ALIASES[team] ?? team
}

export function normalizePos(value) {
  const pos = clean(value).toUpperCase()
  if (!pos) return null
  if (pos === 'DST' || pos === 'D/ST' || pos === 'DEF') return 'DEF'
  if (pos === 'PK') return 'K'
  return pos
}

/**
 * Stable identity for cross-source dedupe and merging.
 *
 * Team defenses are keyed on the team alone: sources name them inconsistently
 * ("Houston Texans", "Texans D/ST", "Houston D/ST") but there is exactly one
 * per team, so the name carries no information the team does not. A defense
 * with no team falls back to its name rather than collapsing into one bucket.
 */
export function playerKey(name, team, pos) {
  const position = normalizePos(pos) ?? ''
  const club = normalizeTeam(team)
  if (position === 'DEF' && club) return `|${club}|DEF`
  return `${normalizeName(name)}|${club ?? ''}|${position}`
}

/**
 * Parses a scraped cell into a number, or null when there is no number in it.
 *
 * The empty-string guard is the whole point: `Number('')` is 0, so a blank
 * table cell used to parse as a real zero. A blank ADP column then read as
 * "drafted first overall", and because the expert artifact merges boards with
 * last-write-wins, one blank cell overwrote every good value for that player.
 */
export function toNumber(value) {
  if (value == null) return null
  const digits = String(value).replace(/[^0-9.-]/g, '')
  if (!digits || !/[0-9]/.test(digits)) return null
  const n = Number(digits)
  return Number.isFinite(n) ? n : null
}
