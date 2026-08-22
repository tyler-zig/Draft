import { getSiteSnapshot } from '../sites/bridge'
import { mapSiteLeague, mapSitePicks, mapSiteSession, parseSiteDraftId, siteDraftId } from '../sites/mapSite'
import type { DraftProvider } from './types'
import { sleeperProvider } from './sleeperProvider'

function requireSnapshot(draftId?: string) {
  const snapshot = getSiteSnapshot('nfl')
  if (!snapshot?.league) {
    throw new Error(snapshot?.error ?? 'No NFL.com draft is synced. Install the Chrome extension and open your NFL Fantasy league.')
  }
  if (draftId) {
    const expected = siteDraftId(snapshot.season || '2026', snapshot.leagueId || '')
    if (draftId !== expected) throw new Error(`The extension is syncing NFL.com league ${snapshot.leagueId}, not ${draftId}.`)
  }
  return snapshot
}

export const nflProvider: DraftProvider = {
  id: 'nfl',
  label: 'NFL.com',
  capabilities: { draftPick: false, autoPick: false },

  async getLeagues() {
    const snapshot = requireSnapshot()
    const league = mapSiteLeague(snapshot)
    const you = league.teams?.find((team) => team.isYou)
    return {
      user: { userId: you?.id ?? 'nfl', username: 'nfl', displayName: you?.name ?? 'NFL.com' },
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
