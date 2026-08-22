import type { DraftSession, DraftType, ProviderId, ScoringType, SlotCounts } from '../providers/types'

const STORAGE_KEY = 'draft-assistant:current-draft'

export interface CurrentDraftContext {
  provider: ProviderId
  draftId: string
  leagueId: string
  leagueName: string
  season: string
  scoringType: ScoringType
  draftType: DraftType
  receptionPremium: DraftSession['receptionPremium']
  /** Roster shape and team count, so Players-page VORP can match the draft room. */
  teams?: number
  slots?: SlotCounts
  scoringSettings?: Record<string, number> | null
  userId: string
  href: string
  updatedAt: number
}

function valid(value: unknown): value is CurrentDraftContext {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<CurrentDraftContext>
  return (
    (item.provider === 'sleeper' || item.provider === 'espn' || item.provider === 'yahoo' || item.provider === 'nfl' || item.provider === 'demo') &&
    typeof item.draftId === 'string' && item.draftId.length > 0 &&
    typeof item.leagueName === 'string' &&
    typeof item.userId === 'string' &&
    typeof item.href === 'string' && item.href.startsWith('/draft/') &&
    typeof item.updatedAt === 'number'
  )
}

export function draftRoomHref(provider: ProviderId, draftId: string, userId: string) {
  return `/draft/${provider}/${encodeURIComponent(draftId)}?userId=${encodeURIComponent(userId)}`
}

export function currentDraftFromSession(session: DraftSession, updatedAt = Date.now()): CurrentDraftContext {
  return {
    provider: session.provider,
    draftId: session.draftId,
    leagueId: session.leagueId,
    leagueName: session.name,
    season: session.season,
    scoringType: session.scoringType,
    draftType: session.type,
    receptionPremium: session.receptionPremium ?? null,
    teams: session.teams,
    slots: session.slots,
    scoringSettings: session.scoringSettings ?? null,
    userId: session.yourUserId,
    href: draftRoomHref(session.provider, session.draftId, session.yourUserId),
    updatedAt,
  }
}

export function saveCurrentDraft(session: DraftSession): CurrentDraftContext {
  const context = currentDraftFromSession(session)
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(context)) } catch { /* in-memory draft still works */ }
  return context
}

export function loadCurrentDraft(): CurrentDraftContext | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown
    return valid(value) ? value : null
  } catch {
    return null
  }
}

export function clearCurrentDraft() {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* already clear in memory-only mode */ }
}

export function scoringLabel(scoring: ScoringType) {
  if (scoring === 'ppr') return 'PPR'
  if (scoring === 'half_ppr') return 'Half PPR'
  if (scoring === 'std') return 'Standard'
  return 'Unknown scoring'
}

export function playerIntelligenceHref(context: CurrentDraftContext, playerId?: string) {
  const params = new URLSearchParams({
    scoring: context.scoringType,
    provider: context.provider,
    leagueId: context.leagueId,
    draftId: context.draftId,
  })
  if (playerId) params.set('playerId', playerId)
  return `/players?${params}`
}

export function playerIntelligenceHrefForSession(session: DraftSession, playerId?: string) {
  return playerIntelligenceHref(currentDraftFromSession(session, 0), playerId)
}
