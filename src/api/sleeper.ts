const SLEEPER_BASE = '/sleeper/v1'

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
  settings: SleeperDraftSettings
  metadata?: {
    scoring_type?: string
    name?: string
    description?: string
  }
  draft_order: Record<string, number> | null
  slot_to_roster_id: Record<string, number> | null
}

export interface SleeperPick {
  player_id: string
  picked_by: string
  roster_id: number | string | null
  round: number
  draft_slot: number
  pick_no: number
  is_keeper: boolean | null
  metadata?: {
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

export async function sleeperGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SLEEPER_BASE}${path}`)
  if (res.status === 404) {
    return null as T
  }
  if (!res.ok) {
    throw new SleeperApiError(res.status, path)
  }
  return res.json() as Promise<T>
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

export function getDraft(draftId: string) {
  return sleeperGet<SleeperDraft>(`/draft/${encodeURIComponent(draftId)}`)
}

export function getDraftPicks(draftId: string) {
  return sleeperGet<SleeperPick[]>(`/draft/${encodeURIComponent(draftId)}/picks`)
}

export function getNflPlayers() {
  return sleeperGet<Record<string, SleeperPlayer>>('/players/nfl')
}
