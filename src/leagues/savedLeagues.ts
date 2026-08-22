import type { LeagueSummary, ProviderId, ScoringType } from '../providers/types'

const LEGACY_KEY = 'draft-assistant:saved-leagues'

export interface SavedLeague {
  provider: ProviderId
  leagueId: string
  season: string
  name: string
  draftId: string | null
  /** Your identity on the league site: a Sleeper user id, an ESPN team id. */
  externalUserId: string
  /** Your team in that league, when the site names it. */
  teamName: string | null
  scoringType: ScoringType
  teamCount: number
  lastOpenedAt: number
}

/** Identity of a league to one user: the same league in two seasons is two rows. */
export function savedLeagueKey(league: Pick<SavedLeague, 'provider' | 'leagueId' | 'season'>): string {
  return `${league.provider}:${league.leagueId}:${league.season}`
}

const SCORING: ScoringType[] = ['ppr', 'half_ppr', 'std', 'unknown']

function isSavedLeague(value: unknown): value is SavedLeague {
  if (!value || typeof value !== 'object') return false
  const league = value as Partial<SavedLeague>
  return (
    (league.provider === 'sleeper' || league.provider === 'espn' || league.provider === 'yahoo' || league.provider === 'nfl') &&
    typeof league.leagueId === 'string' && league.leagueId.length > 0 &&
    typeof league.season === 'string' && league.season.length > 0 &&
    typeof league.name === 'string'
  )
}

function normalize(league: SavedLeague): SavedLeague {
  return {
    provider: league.provider,
    leagueId: league.leagueId,
    season: league.season,
    name: league.name,
    draftId: league.draftId ?? null,
    externalUserId: league.externalUserId ?? '',
    teamName: league.teamName ?? null,
    scoringType: SCORING.includes(league.scoringType) ? league.scoringType : 'unknown',
    teamCount: Number.isFinite(league.teamCount) ? league.teamCount : 0,
    lastOpenedAt: Number.isFinite(league.lastOpenedAt) ? league.lastOpenedAt : 0,
  }
}

/** Most recently opened first -- the league you want is nearly always the last one. */
export function sortSavedLeagues(leagues: SavedLeague[]): SavedLeague[] {
  return [...leagues].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt || a.name.localeCompare(b.name))
}

export function parseSavedLeagues(value: unknown): SavedLeague[] {
  if (!Array.isArray(value)) return []
  return sortSavedLeagues(value.filter(isSavedLeague).map(normalize))
}

/**
 * One-time lift of leagues that used to live in localStorage.
 * Reads the legacy key, then deletes it so the device is no longer a store.
 */
export function takeLegacySavedLeagues(): SavedLeague[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null') as unknown
    const rows = parseSavedLeagues(parsed)
    localStorage.removeItem(LEGACY_KEY)
    return rows
  } catch {
    try { localStorage.removeItem(LEGACY_KEY) } catch { /* ignore */ }
    return []
  }
}

export function upsertSavedLeague(leagues: SavedLeague[], league: SavedLeague): SavedLeague[] {
  const key = savedLeagueKey(league)
  const without = leagues.filter((item) => savedLeagueKey(item) !== key)
  return sortSavedLeagues([...without, normalize(league)])
}

export function removeSavedLeague(leagues: SavedLeague[], key: string): SavedLeague[] {
  return leagues.filter((item) => savedLeagueKey(item) !== key)
}

/** Newest write per league wins. Used only to import leftover device rows into the account. */
export function mergeSavedLeagues(left: SavedLeague[], right: SavedLeague[]): SavedLeague[] {
  const byKey = new Map<string, SavedLeague>()
  for (const league of [...left, ...right].map(normalize)) {
    const key = savedLeagueKey(league)
    const existing = byKey.get(key)
    if (!existing || league.lastOpenedAt > existing.lastOpenedAt) byKey.set(key, league)
  }
  return sortSavedLeagues([...byKey.values()])
}

/** Builds a saved row from a provider's league summary plus your seat in it. */
export function savedLeagueFrom(
  provider: ProviderId,
  league: LeagueSummary,
  externalUserId: string,
  teamName: string | null = null,
  at: number = Date.now(),
): SavedLeague {
  return normalize({
    provider,
    leagueId: league.id,
    season: league.season,
    name: league.name,
    draftId: league.draftId,
    externalUserId,
    teamName,
    scoringType: league.scoringType,
    teamCount: league.teamCount,
    lastOpenedAt: at,
  })
}

/** The Draft Room link for a saved league, or null when it has no draft yet. */
export function savedLeagueHref(league: SavedLeague): string | null {
  if (!league.draftId) return null
  return `/draft/${league.provider}/${encodeURIComponent(league.draftId)}?userId=${encodeURIComponent(league.externalUserId)}`
}
