import type { EspnSnapshot } from './mapEspn'
import { ESPN_APP_SOURCE, ESPN_BRIDGE_SOURCE, isEspnPracticeSnapshot, mergeEspnSnapshots } from './mapEspn'

export type EspnSuggestionRec = {
  id: string
  name: string
  position: string
  team: string | null
  reason: string
  rank: number
  liveAdp?: number | null
  adp?: number | null
  vorp?: number | null
  marketSource?: 'live ADP' | 'ADP' | null
  marketValue?: number | null
  vsPick?: number | null
}

export type EspnSuggestionsPayload = {
  leagueId: string
  season: string
  teamId: string
  currentPickNo: number
  until: number | null
  youAreOnClock: boolean
  pickStamp: string
  recs: EspnSuggestionRec[]
}
import { CURRENT_SEASON } from '../providers/types'
import type { ValuationTable } from '../extension/playerValuations'

const SNAPSHOT_STORAGE_KEY = 'draft-assistant:espn-snapshot'

function loadCachedSnapshot(): EspnSnapshot | null {
  try {
    const value = JSON.parse(localStorage.getItem(SNAPSHOT_STORAGE_KEY) ?? 'null') as EspnSnapshot | null
    if (!value?.league || !value.leagueId) return null
    // A leftover practice clone is not a league you can return to.
    if (isEspnPracticeSnapshot(value)) return null
    return value
  } catch {
    return null
  }
}

function cacheSnapshot(value: EspnSnapshot) {
  if (!value.league || !value.leagueId || value.error) return
  if (isEspnPracticeSnapshot(value)) return
  try {
    localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // The extension remains the source of truth when browser storage is full
    // or disabled; this cache only makes returning to the app resilient.
  }
}

let snapshot: EspnSnapshot | null = loadCachedSnapshot()
let installed = false
let hydrated = false
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function getEspnSnapshot(): EspnSnapshot | null {
  return snapshot
}

export function isEspnExtensionInstalled(): boolean {
  return installed
}

/** True after the extension has answered at least one snapshot request. */
export function isEspnBridgeHydrated(): boolean {
  return hydrated
}

/**
 * Ask the content script for its stored snapshot again. This matters after a
 * back/forward-cache restore, where the original startup response can be lost.
 */
export function requestEspnSnapshot() {
  window.postMessage(
    { source: ESPN_APP_SOURCE, type: 'GET_ESPN_SNAPSHOT' },
    '*',
  )
}

export function requestExitEspnPractice() {
  // Clear the live clone synchronously. The extension restores its saved real
  // league asynchronously, but exiting must still work after the ESPN tab or
  // extension relay has already been closed.
  snapshot = loadCachedSnapshot()
  hydrated = true
  notify()
  window.postMessage(
    { source: ESPN_APP_SOURCE, type: 'EXIT_ESPN_PRACTICE' },
    '*',
  )
}

export function subscribeEspnBridge(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export type EspnRef = {
  leagueId: string
  season: string
  teamId?: string
  url: string
}

export const ESPN_PRACTICE_LOBBY_URL = 'https://fantasy.espn.com/football/mockdraftlobby'

export function espnTeamPageUrl(
  leagueId: string,
  season = CURRENT_SEASON,
  teamId?: string,
) {
  const url = new URL('https://fantasy.espn.com/football/team')
  url.searchParams.set('leagueId', leagueId)
  url.searchParams.set('seasonId', season)
  if (teamId) {
    url.searchParams.set('teamId', teamId)
    url.searchParams.set('fromTeamId', teamId)
  }
  return url.toString()
}

export function espnDraftPageUrl(
  leagueId: string,
  season = CURRENT_SEASON,
  teamId?: string,
) {
  const url = new URL('https://fantasy.espn.com/football/draft')
  url.searchParams.set('leagueId', leagueId)
  url.searchParams.set('seasonId', season)
  if (teamId) url.searchParams.set('teamId', teamId)
  return url.toString()
}

export function parseEspnRef(input: string, fallbackSeason = CURRENT_SEASON): EspnRef | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const fromParams = (params: URLSearchParams, href?: string) => {
    const leagueId = params.get('leagueId') || params.get('leagueid')
    if (!leagueId) return null
    const season =
      params.get('seasonId') || params.get('seasonid') || fallbackSeason
    const teamId =
      params.get('teamId') || params.get('fromTeamId') || undefined
    return {
      leagueId,
      season,
      teamId: teamId || undefined,
      url: href || espnTeamPageUrl(leagueId, season, teamId || undefined),
    }
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      if (!url.hostname.endsWith('espn.com')) return null
      return fromParams(url.searchParams, url.toString())
    } catch {
      return null
    }
  }

  const embedded = trimmed.match(/leagueId=(\d+)/i)
  if (embedded) {
    const season = trimmed.match(/seasonId=(\d+)/i)?.[1] || fallbackSeason
    const teamId = trimmed.match(/(?:from)?teamId=(\d+)/i)?.[1]
    return {
      leagueId: embedded[1],
      season,
      teamId,
      url: espnTeamPageUrl(embedded[1], season, teamId),
    }
  }

  if (/^\d{3,}$/.test(trimmed)) {
    return {
      leagueId: trimmed,
      season: fallbackSeason,
      url: espnTeamPageUrl(trimmed, fallbackSeason),
    }
  }

  return null
}

export function requestOpenEspn(opts?: {
  leagueId?: string
  season?: string
  teamId?: string
  page?: 'home' | 'team' | 'draft' | 'practice'
  url?: string
  /** Refresh the league tab, then come back so the draft room can ingest it. */
  returnToApp?: boolean
}) {
  const season = opts?.season ?? CURRENT_SEASON
  const leagueId = opts?.leagueId?.trim()
  const teamId = opts?.teamId?.trim()
  const page = opts?.page ?? (leagueId ? 'team' : 'home')
  const url =
    opts?.url && opts.url.startsWith('https://fantasy.espn.com/')
      ? opts.url
      : page === 'practice'
        ? ESPN_PRACTICE_LOBBY_URL
        : !leagueId || page === 'home'
          ? 'https://fantasy.espn.com/football/'
          : page === 'draft'
            ? espnDraftPageUrl(leagueId, season, teamId)
            : espnTeamPageUrl(leagueId, season, teamId)

  let acked = false
  function onAck(event: MessageEvent) {
    if (event.origin !== window.location.origin) return
    const data = event.data
    if (data?.source === ESPN_BRIDGE_SOURCE && data.type === 'OPEN_ESPN_ACK') {
      acked = true
    }
  }
  window.addEventListener('message', onAck)
  window.postMessage(
    {
      source: ESPN_APP_SOURCE,
      type: 'OPEN_ESPN',
      leagueId,
      season,
      teamId,
      url,
      returnToApp: Boolean(opts?.returnToApp),
    },
    '*',
  )
  window.setTimeout(() => {
    window.removeEventListener('message', onAck)
    if (!acked) window.open(url, 'espn-draft-assistant')
  }, 250)
}

export function ingestEspnBridgeMessage(data: unknown) {
  if (!data || typeof data !== 'object') return
  const msg = data as {
    source?: string
    type?: string
    installed?: boolean
    exitedPractice?: boolean
    snapshot?: EspnSnapshot | null
  }
  if (msg.source !== ESPN_BRIDGE_SOURCE) return
  installed = true
  if (msg.exitedPractice) {
    // Leaving a practice room returns to the real league, so this is a
    // different draft and merging would be wrong.
    snapshot = msg.snapshot ?? null
    if (snapshot?.league) cacheSnapshot(snapshot)
    hydrated = true
    notify()
    return
  }
  if (msg.snapshot !== undefined) {
    // A delayed empty response must not erase a newer broadcast or the last
    // usable local snapshot. A real snapshot replaces and refreshes the cache.
    if (msg.snapshot) {
      if (msg.snapshot.league) {
        // Merged against what we already hold, so a snapshot taken while the
        // draft tab was disconnected cannot wipe the board on a refresh.
        const merged = mergeEspnSnapshots(snapshot ?? loadCachedSnapshot(), msg.snapshot)
        snapshot = merged
        cacheSnapshot(merged)
      } else if (msg.snapshot.error) {
        const home = loadCachedSnapshot()
        snapshot = home ?? msg.snapshot
      } else {
        snapshot = msg.snapshot
      }
    }
    hydrated = true
  }
  notify()
}

/**
 * Hand the extension the numbers it cannot compute for itself.
 *
 * Not finished recommendations: the overlay has to answer the instant a pick
 * lands, and the app polls on a timer, so pushing recs meant the overlay was
 * always a beat behind and fell back to a weaker local scorer. Valuations move
 * slowly -- projections, VORP, live ADP, tiers -- so the extension caches these
 * and scores against its own live board with the same shared code.
 */
export function publishEspnValuations(table: ValuationTable | null) {
  window.postMessage(
    { source: ESPN_APP_SOURCE, type: 'PUBLISH_ESPN_VALUATIONS', payload: table },
    '*',
  )
}

export function publishEspnSuggestions(payload: EspnSuggestionsPayload | null) {
  window.postMessage(
    {
      source: ESPN_APP_SOURCE,
      type: 'PUBLISH_ESPN_SUGGESTIONS',
      payload,
    },
    '*',
  )
}

export function listenForEspnExtension() {
  function onMessage(event: MessageEvent) {
    if (event.origin !== window.location.origin) return
    ingestEspnBridgeMessage(event.data)
  }
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}
