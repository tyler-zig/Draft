import { resolveNameAlias } from './aliases'

const SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b/g
const PUNCT = /[.'’`-]/g

/**
 * The one spelling of a player's name every matcher compares on.
 *
 * Aliases resolve last, after punctuation and suffixes are gone, so the table
 * only has to carry one form of each nickname rather than one per suffix and
 * apostrophe variant.
 */
export function normalizeName(value: string): string {
  const base = value
    .toLowerCase()
    .replace(PUNCT, '')
    .replace(SUFFIX, '')
    .replace(/\s+/g, ' ')
    .trim()
  return resolveNameAlias(base)
}

export function normalizeTeam(value: string | null | undefined): string | null {
  if (!value) return null
  const t = value.toUpperCase().trim()
  const aliases: Record<string, string> = {
    JAC: 'JAX',
    WAS: 'WSH',
    WSH: 'WSH',
    WASHINGTON: 'WSH',
    LAR: 'LAR',
    LA: 'LAR',
    STL: 'LAR',
    SD: 'LAC',
    LAC: 'LAC',
    OAK: 'LV',
    LV: 'LV',
    DST: '',
    DEF: '',
  }
  return aliases[t] ?? t
}

export function normalizePos(value: string | null | undefined): string | null {
  if (!value) return null
  const p = value.toUpperCase().trim()
  if (p === 'DST' || p === 'D/ST' || p === 'DEF') return 'DEF'
  if (p === 'PK') return 'K'
  return p
}

/**
 * Stable identity for matching a ranking row to a directory player.
 *
 * Team defenses are keyed on the team alone: sources name them inconsistently
 * ("Houston Texans", "Texans D/ST", "Houston D/ST") but there is exactly one
 * per team. Mirrors scripts/lib/text.mjs.
 */
export function playerKey(name: string, team: string | null | undefined, pos: string | null | undefined): string {
  const position = normalizePos(pos) ?? ''
  const club = normalizeTeam(team)
  if (position === 'DEF' && club) return `|${club}|DEF`
  return `${normalizeName(name)}|${club ?? ''}|${position}`
}
