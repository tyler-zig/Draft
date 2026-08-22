import type { DraftProvider } from './types'
import { getEspnSnapshot } from '../espn/bridge'
import {
  espnDraftId,
  mapEspnKeepers,
  mapEspnLeague,
  mapEspnPicks,
  mapEspnPlayers,
  mapEspnSession,
  parseEspnDraftId,
} from '../espn/mapEspn'

function requireSnapshot(draftId?: string) {
  const snapshot = getEspnSnapshot()
  if (!snapshot || !snapshot.league) {
    throw new Error(
      snapshot?.error ??
        'No ESPN draft is synced. Install the Chrome extension and click Open ESPN Fantasy.',
    )
  }
  if (draftId) {
    const expected = espnDraftId(
      snapshot.season || '2026',
      snapshot.leagueId || '',
    )
    if (draftId !== expected) {
      throw new Error(
        `The extension is syncing ESPN league ${snapshot.leagueId}, not ${draftId}.`,
      )
    }
  }
  return snapshot
}

export const espnProvider: DraftProvider = {
  id: 'espn',
  label: 'ESPN',
  capabilities: { draftPick: false, autoPick: false },

  async getLeagues() {
    const snapshot = requireSnapshot()
    const league = mapEspnLeague(snapshot)
    const you = league.teams?.find((t) => t.isYou)
    return {
      user: {
        userId: you?.id ?? 'espn',
        username: 'espn',
        displayName: you?.name ?? 'ESPN',
      },
      leagues: [league],
    }
  },

  async getDraft(draftId, yourUserId) {
    const snapshot = requireSnapshot(draftId)
    parseEspnDraftId(draftId)
    return mapEspnSession(snapshot, yourUserId)
  },

  async getPicks(draftId) {
    const snapshot = requireSnapshot(draftId)
    return mapEspnPicks(snapshot)
  },

  async getPlayers(draftId) {
    const snapshot = requireSnapshot(draftId)
    return mapEspnPlayers(snapshot)
  },

  async getKeepers(draftId) {
    const snapshot = requireSnapshot(draftId)
    return mapEspnKeepers(snapshot)
  },
}
