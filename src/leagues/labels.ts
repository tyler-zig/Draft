import type { LeagueSummary, ScoringType } from '../providers/types'
import type { SavedLeague } from './savedLeagues'

export function scoringLabel(scoring: ScoringType | Pick<SavedLeague, 'scoringType'> | Pick<LeagueSummary, 'scoringType'>) {
  const value = typeof scoring === 'string' ? scoring : scoring.scoringType
  if (value === 'ppr') return 'PPR'
  if (value === 'half_ppr') return 'Half PPR'
  if (value === 'std') return 'Standard'
  return 'Unknown scoring'
}

export function providerLabel(provider: SavedLeague['provider'] | 'sleeper' | 'espn' | 'yahoo' | 'nfl' | 'demo') {
  if (provider === 'espn') return 'ESPN'
  if (provider === 'yahoo') return 'Yahoo'
  if (provider === 'nfl') return 'NFL.com'
  if (provider === 'demo') return 'Demo'
  return 'Sleeper'
}

export function openedLabel(at: number) {
  if (!at) return 'Not opened yet'
  const days = Math.floor((Date.now() - at) / 86_400_000)
  if (days <= 0) return 'Opened today'
  if (days === 1) return 'Opened yesterday'
  if (days < 30) return `Opened ${days} days ago`
  return `Opened ${new Date(at).toLocaleDateString()}`
}

export function draftStatusLabel(league: Pick<LeagueSummary, 'draftStatus' | 'status' | 'isPractice'>) {
  if (league.isPractice && league.draftStatus === 'drafting') return 'Practice'
  if (league.isPractice && league.draftStatus === 'complete') return 'Practice done'
  if (league.draftStatus === 'drafting') return 'Live'
  if (league.draftStatus === 'complete') return 'Complete'
  if (league.draftStatus === 'paused') return 'Paused'
  if (league.draftStatus === 'pre_draft') return league.isPractice ? 'Practice' : 'Pre-draft'
  return league.status.replaceAll('_', ' ')
}

export function playersHrefForSavedLeague(league: SavedLeague) {
  const params = new URLSearchParams()
  if (league.scoringType !== 'unknown') params.set('scoring', league.scoringType)
  if (league.draftId) {
    params.set('provider', league.provider)
    params.set('leagueId', league.leagueId)
    params.set('draftId', league.draftId)
  }
  const query = params.toString()
  return query ? `/players?${query}` : '/players'
}
