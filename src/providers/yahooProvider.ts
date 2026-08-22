import { getSiteSnapshot } from '../sites/bridge'
import { mapSiteLeague, mapSitePicks, mapSiteSession, parseSiteDraftId, siteDraftId } from '../sites/mapSite'
import type { DraftProvider } from './types'
import { sleeperProvider } from './sleeperProvider'

function requireSnapshot(draftId?: string) {
  const snapshot = getSiteSnapshot('yahoo')
  if (!snapshot?.league) {
    throw new Error(snapshot?.error ?? 'No Yahoo draft is synced. Install the Chrome extension and open your Yahoo league.')
  }
  if (draftId) {
    const expected = siteDraftId(snapshot.season || '2026', snapshot.leagueId || '')
    if (draftId !== expected) throw new Error(`The extension is syncing Yahoo league ${snapshot.leagueId}, not ${draftId}.`)
  }
  return snapshot
}

export const yahooProvider: DraftProvider = {
  id: 'yahoo',
  label: 'Yahoo',
  capabilities: { draftPick: false, autoPick: false },

  async getLeagues() {
    const snapshot = requireSnapshot()
    const league = mapSiteLeague(snapshot)
    const you = league.teams?.find((team) => team.isYou)
    return {
      user: { userId: you?.id ?? 'yahoo', username: 'yahoo', displayName: you?.name ?? 'Yahoo' },
      leagues: [league],
    }
  },

  async getDraft(draftId, yourUserId) {
    const snapshot = requireSnapshot(draftId)
    parseSiteDraftId(draftId)
    return mapSiteSession(snapshot, yourUserId)
  },

  async getPicks(draftId) {
    const snapshot = requireSnapshot(draftId)
    return mapSitePicks(snapshot, await sleeperProvider.getPlayers())
  },

  async getPlayers() {
    return sleeperProvider.getPlayers()
  },
}
