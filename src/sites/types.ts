import type { DraftStatus, DraftType, ScoringType } from '../providers/types'

export const SITE_BRIDGE_SOURCE = 'draft-assistant-extension'
export const SITE_APP_SOURCE = 'draft-assistant-app'
export type SiteProviderId = 'yahoo' | 'nfl'

export interface SiteAvailableLeague {
  leagueId: string
  name?: string
  season: string
}

export interface SiteTeam {
  id: string
  name: string
  isYou?: boolean
  draftSlot?: number
}

export interface SitePick {
  playerId: string
  playerName?: string
  teamId: string
  pickNo: number
  round: number
  isKeeper?: boolean
}

export interface SiteLeague {
  name: string
  teamCount: number
  scoringType: ScoringType
  draftType: DraftType
  draftStatus: DraftStatus
  pickTimer?: number | null
  keeperCount?: number | null
  teams: SiteTeam[]
  picks?: SitePick[]
}

export interface SiteSnapshot {
  provider: SiteProviderId
  leagueId?: string
  season?: string
  teamId?: string
  pageUrl?: string
  fetchedAt: number
  error?: string
  waiting?: boolean
  league?: SiteLeague
  availableLeagues?: SiteAvailableLeague[]
}
