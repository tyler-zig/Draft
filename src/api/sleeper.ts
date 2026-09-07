const SLEEPER_PROXY = '/sleeper/v1'
const SLEEPER_DIRECT = 'https://api.sleeper.app/v1'

export interface SleeperUser {
  user_id: string
  username: string
  display_name: string
  avatar: string | null
}

export interface SleeperLeague {
  league_id: string
  name: string
  status: string
  season: string
  total_rosters: number
  draft_id: string | null
  avatar: string | null
  roster_positions: string[] | null
  scoring_settings?: Record<string, number>
  settings?: Record<string, number>
  metadata?: Record<string, string | undefined>
}

export interface SleeperLeagueUser {
  user_id: string
  username?: string
  display_name: string
  avatar: string | null
  metadata?: { team_name?: string; avatar?: string | null }
}

/** Sleeper stores hashes; custom team logos are already full URLs. */
export function sleeperAvatarUrl(idOrUrl: string | null | undefined): string | null {
  const value = idOrUrl?.trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  return `https://sleepercdn.com/avatars/thumbs/${encodeURIComponent(value)}`
}

export interface SleeperDraftSettings {
  teams?: number
  rounds?: number
  pick_timer?: number
  slots_qb?: number
  slots_rb?: number
  slots_wr?: number
  slots_te?: number
  slots_k?: number
  slots_flex?: number
  slots_super_flex?: number
  slots_def?: number
  slots_bn?: number
  /** 3 = 3rd-round reversal; 0 or omitted is a plain snake. */
  reversal_round?: number
}

export interface SleeperDraft {
  draft_id: string
  league_id: string | null
  type: string
  status: string
  sport: string
  season: string
  start_time: number | null
  last_picked?: number
  creators?: string[] | null
  settings: SleeperDraftSettings
  metadata?: {
    scoring_type?: string
    name?: string
    description?: string
    /** Sleeper's league type as a string; "3" is chopped. */
    league_type?: string
    /** Parent league for a `league_mock` room; the draft's own `league_id` is null. */
    league_id?: string
    /** `league_mock` for a cloned league mock; other mocks omit or say `mock`. */
    type?: string
  }
  draft_order: Record<string, number> | null
  slot_to_roster_id: Record<string, number> | null
}

export interface SleeperTradedPick {
  season?: string
  round: number
  /** Original owner of that round's pick. */
  roster_id: number
  previous_owner_id?: number
  /** Current owner after the trade. */
  owner_id: number
}

export interface SleeperPick {
  player_id?: string | number | null
  picked_by?: string | null
  /** Docs publish this as a string; mocks often send null. */
  roster_id?: number | string | null
  round?: number | null
  /** Board column. Docs omit it on some rows. */
  draft_slot?: number | null
  pick_no?: number | null
  is_keeper?: boolean | null
  metadata?: {
    player_id?: string | number
    first_name?: string
    last_name?: string
    position?: string
    team?: string
    injury_status?: string
  }
}

export interface SleeperPlayer {
  player_id?: string
  first_name?: string
  last_name?: string
  full_name?: string
  position?: string
  team?: string | null
  search_rank?: number | null
  injury_status?: string | null
  number?: string | number | null
  years_exp?: number | null
  active?: boolean | null
  status?: string | null
  fantasy_positions?: string[] | null
  bye_week?: number | null
  espn_id?: string | number | null
  yahoo_id?: string | number | null
  age?: number | null
  height?: string | null
  weight?: string | number | null
  depth_chart_order?: number | null
  depth_chart_position?: string | null
  gsis_id?: string | null
  sportradar_id?: string | null
  fantasy_data_id?: string | number | null
}

export class SleeperApiError extends Error {
  status: number
  constructor(status: number, path: string) {
    super(`Sleeper request failed (${status}) for ${path}`)
    this.name = 'SleeperApiError'
    this.status = status
  }
}

async function parseSleeperBody<T>(res: Response, path: string): Promise<T> {
  const text = await res.text()
  if (!text) return null as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new SleeperApiError(res.status || 502, path)
  }
}

async function sleeperFetch<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, init)
  if (res.status === 404) return null as T
  if (!res.ok) throw new SleeperApiError(res.status, path)
  return parseSleeperBody<T>(res, path)
}

/**
 * Sleeper's public API is CORS-open at api.sleeper.app. The app prefers the
 * `/sleeper` proxy so local/Vercel hosts stay same-origin, then falls back
 * to the documented host when the proxy returns HTML, a 404, or a network error.
 */
export async function sleeperGet<T>(path: string, init?: RequestInit): Promise<T> {
  let proxied: T | undefined
  try {
    proxied = await sleeperFetch<T>(SLEEPER_PROXY, path, init)
    if (proxied != null) return proxied
  } catch {
    proxied = undefined
  }
  try {
    const direct = await sleeperFetch<T>(SLEEPER_DIRECT, path, init)
    if (direct != null || proxied === undefined) return direct
  } catch (error) {
    if (proxied !== undefined) return proxied
    throw error
  }
  return proxied as T
}

export function getUser(usernameOrId: string) {
  return sleeperGet<SleeperUser | null>(
    `/user/${encodeURIComponent(usernameOrId.trim())}`,
  )
}

export function getUserLeagues(userId: string, season: string) {
  return sleeperGet<SleeperLeague[]>(
    `/user/${encodeURIComponent(userId)}/leagues/nfl/${encodeURIComponent(season)}`,
  )
}

export function getLeague(leagueId: string) {
  return sleeperGet<SleeperLeague>(`/league/${encodeURIComponent(leagueId)}`)
}

export function getLeagueUsers(leagueId: string) {
  return sleeperGet<SleeperLeagueUser[]>(
    `/league/${encodeURIComponent(leagueId)}/users`,
  )
}

export function getLeagueDrafts(leagueId: string) {
  return sleeperGet<SleeperDraft[]>(
    `/league/${encodeURIComponent(leagueId)}/drafts`,
  )
}

/** `GET /user/{id}/drafts/nfl/{season}` — includes league mocks that `getLeagues` omits. */
export function getUserDrafts(userId: string, season: string) {
  return sleeperGet<SleeperDraft[]>(
    `/user/${encodeURIComponent(userId)}/drafts/nfl/${encodeURIComponent(season)}`,
  )
}

/**
 * Reads an endpoint the draft room polls, bypassing every cache in front of it.
 *
 * `fetch(..., { cache: 'no-store' })` only skips the *browser* cache. Sleeper
 * publishes the live draft endpoints as
 * `cache-control: public, s-maxage=30, stale-while-revalidate=300`, so its own
 * Cloudflare edge answers repeat polls with a `cf-cache-status: HIT` -- the
 * identical body, byte for byte, for 30s and up to 5 more minutes of
 * revalidate-in-the-background staleness. A request `Cache-Control: no-cache`
 * does not bust a shared cache. On Vercel the `/sleeper` rewrite honours the
 * same `s-maxage`, stacking a second edge cache on top.
 *
 * The result is a room that polls every 2s and still sees picks arrive in
 * 30s-plus clumps. A unique query param makes each poll its own cache key, so
 * both edges miss and the origin answers. Sleeper ignores the extra param.
 */
function sleeperGetLive<T>(path: string): Promise<T> {
  const separator = path.includes('?') ? '&' : '?'
  return sleeperGet<T>(`${path}${separator}_=${Date.now()}`, { cache: 'no-store' })
}

export function getDraft(draftId: string) {
  return sleeperGetLive<SleeperDraft>(`/draft/${encodeURIComponent(draftId)}`)
}

const SLEEPER_GRAPHQL = 'https://sleeper.com/graphql'

/**
 * The picks query Sleeper's own web client runs.
 *
 * `draft_picks` publishes no `round`, `draft_slot` or `roster_id` -- the web
 * app derives the board position from `pick_no`, and so does
 * `normalizePickSlots`. `metadata` is identical to the REST row, so the
 * existing mapper reads either source unchanged.
 */
const DRAFT_PICKS_QUERY =
  'query draft_picks($draft_id: String!) {' +
  ' draft_picks(draft_id: $draft_id) { pick_no player_id picked_by is_keeper metadata }' +
  '}'

/**
 * Reads picks over Sleeper's GraphQL endpoint rather than the public REST API.
 *
 * The REST board is edge-cached (`s-maxage=30, stale-while-revalidate=300`),
 * so a poll can be answered from a shared cache that no request header busts.
 * `sleeper.com/graphql` answers `cache-control: max-age=0, private,
 * must-revalidate` with `cf-cache-status: DYNAMIC` -- never cached at any
 * layer -- and is CORS-open (`access-control-allow-origin: *`) and
 * unauthenticated, so the browser calls it directly with no proxy hop. This is
 * the endpoint Sleeper's own draft room reads.
 *
 * It is undocumented, so anything unexpected falls back to the REST board
 * rather than emptying the room.
 */
async function getDraftPicksGraphql(draftId: string): Promise<SleeperPick[] | null> {
  const res = await fetch(SLEEPER_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: DRAFT_PICKS_QUERY, variables: { draft_id: draftId } }),
    cache: 'no-store',
  })
  if (!res.ok) return null
  const body = (await res.json()) as {
    data?: { draft_picks?: SleeperPick[] | null }
    errors?: unknown[]
  }
  if (body.errors?.length) return null
  const picks = body.data?.draft_picks
  return Array.isArray(picks) ? picks : null
}

export async function getDraftPicks(draftId: string): Promise<SleeperPick[] | null> {
  try {
    const live = await getDraftPicksGraphql(draftId)
    if (live) return live
  } catch {
    // Fall through to the documented endpoint.
  }
  return sleeperGetLive<SleeperPick[] | null>(`/draft/${encodeURIComponent(draftId)}/picks`)
}

export function getDraftTradedPicks(draftId: string) {
  return sleeperGetLive<SleeperTradedPick[]>(
    `/draft/${encodeURIComponent(draftId)}/traded_picks`,
  )
}

export function getNflPlayers() {
  return sleeperGet<Record<string, SleeperPlayer>>('/players/nfl')
}
