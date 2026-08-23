import { CURRENT_SEASON } from '../providers/types'
import { SITE_APP_SOURCE, SITE_BRIDGE_SOURCE, type SiteProviderId, type SiteSnapshot } from './types'

const STORAGE_KEY: Record<SiteProviderId, string> = {
  yahoo: 'draft-assistant:yahoo-snapshot',
  nfl: 'draft-assistant:nfl-snapshot',
}

const HOME: Record<SiteProviderId, string> = {
  yahoo: 'https://football.fantasysports.yahoo.com/',
  nfl: 'https://fantasy.nfl.com/',
}

function loadCached(provider: SiteProviderId): SiteSnapshot | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY[provider]) ?? 'null') as SiteSnapshot | null
    return value?.provider === provider && value.league && value.leagueId ? value : null
  } catch {
    return null
  }
}

function cacheSnapshot(provider: SiteProviderId, value: SiteSnapshot) {
  try {
    localStorage.setItem(STORAGE_KEY[provider], JSON.stringify(value))
  } catch {
    /* extension remains the source of truth */
  }
}

const snapshots: Record<SiteProviderId, SiteSnapshot | null> = {
  yahoo: loadCached('yahoo'),
  nfl: loadCached('nfl'),
}
const installed = { yahoo: false, nfl: false }
const hydrated = { yahoo: false, nfl: false }
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function getSiteSnapshot(provider: SiteProviderId) {
  return snapshots[provider]
}

export function isSiteExtensionInstalled(provider: SiteProviderId) {
  return installed[provider]
}

export function isSiteBridgeHydrated(provider: SiteProviderId) {
  return hydrated[provider]
}

export function requestSiteSnapshot(provider: SiteProviderId) {
  window.postMessage({ source: SITE_APP_SOURCE, type: 'GET_SITE_SNAPSHOT', provider }, '*')
}

export function subscribeSiteBridge(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function siteTeamPageUrl(provider: SiteProviderId, leagueId: string, season = CURRENT_SEASON, teamId?: string) {
  if (provider === 'yahoo') {
    return teamId
      ? `https://football.fantasysports.yahoo.com/f1/${leagueId}/${teamId}`
      : `https://football.fantasysports.yahoo.com/f1/${leagueId}`
  }
  const url = new URL(`https://fantasy.nfl.com/league/${leagueId}`)
  if (teamId) url.searchParams.set('teamId', teamId)
  if (season) url.searchParams.set('season', season)
  return url.toString()
}

export function parseSiteRef(provider: SiteProviderId, input: string, fallbackSeason = CURRENT_SEASON) {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (provider === 'yahoo') {
    if (/^https?:\/\//i.test(trimmed)) {
      try {
        const url = new URL(trimmed)
        if (!url.hostname.includes('yahoo.com')) return null
      } catch {
        return null
      }
    }
    const fromUrl = trimmed.match(/\/f1\/(\d+)/i)
    const fromKey = trimmed.match(/(?:^|[^\d])(\d{4,})\.l\.(\d+)/i)
    const leagueId = fromUrl?.[1] || fromKey?.[2] || (/^\d{3,}$/.test(trimmed) ? trimmed : null)
    if (!leagueId) return null
    const teamId = trimmed.match(/\/f1\/\d+\/(\d+)/)?.[1]
    return { leagueId, season: fallbackSeason, teamId, url: siteTeamPageUrl(provider, leagueId, fallbackSeason, teamId) }
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      if (!url.hostname.includes('nfl.com')) return null
      const leagueId = url.searchParams.get('leagueId') || url.pathname.match(/\/league\/(\d+)/)?.[1]
      if (!leagueId) return null
      const teamId = url.searchParams.get('teamId') || undefined
      const season = url.searchParams.get('season') || fallbackSeason
      return { leagueId, season, teamId, url: siteTeamPageUrl(provider, leagueId, season, teamId) }
    } catch {
      return null
    }
  }
  if (/^\d{3,}$/.test(trimmed)) {
    return { leagueId: trimmed, season: fallbackSeason, url: siteTeamPageUrl(provider, trimmed, fallbackSeason) }
  }
  return null
}

export function requestOpenSite(provider: SiteProviderId, opts?: {
  leagueId?: string
  season?: string
  teamId?: string
  page?: 'home' | 'team'
  url?: string
  /** Refresh the league tab, then come back so the draft room can ingest it. */
  returnToApp?: boolean
}) {
  const season = opts?.season ?? CURRENT_SEASON
  const leagueId = opts?.leagueId?.trim()
  const teamId = opts?.teamId?.trim()
  const page = opts?.page ?? (leagueId ? 'team' : 'home')
  const allowedHost = provider === 'yahoo' ? 'fantasysports.yahoo.com' : 'fantasy.nfl.com'
  const url = opts?.url && opts.url.includes(allowedHost)
    ? opts.url
    : !leagueId || page === 'home'
      ? HOME[provider]
      : siteTeamPageUrl(provider, leagueId, season, teamId)

  let acked = false
  function onAck(event: MessageEvent) {
    if (event.origin !== window.location.origin) return
    const data = event.data as { source?: string; type?: string; provider?: string }
    if (data?.source === SITE_BRIDGE_SOURCE && data.type === 'OPEN_SITE_ACK' && data.provider === provider) acked = true
  }
  window.addEventListener('message', onAck)
  window.postMessage({ source: SITE_APP_SOURCE, type: 'OPEN_SITE', provider, leagueId, season, teamId, url, returnToApp: Boolean(opts?.returnToApp) }, '*')
  window.setTimeout(() => {
    window.removeEventListener('message', onAck)
    if (!acked) window.open(url, `${provider}-draft-assistant`)
  }, 250)
}

export function ingestSiteBridgeMessage(data: unknown) {
  if (!data || typeof data !== 'object') return
  const msg = data as { source?: string; type?: string; installed?: boolean; provider?: SiteProviderId; snapshot?: SiteSnapshot | null }
  if (msg.source !== SITE_BRIDGE_SOURCE) return
  if (msg.type === 'STATUS' && msg.installed) {
    if (msg.provider === 'yahoo' || msg.provider === 'nfl') installed[msg.provider] = true
    else {
      installed.yahoo = true
      installed.nfl = true
    }
  }
  if (msg.type === 'SITE_SNAPSHOT' && (msg.provider === 'yahoo' || msg.provider === 'nfl')) {
    installed[msg.provider] = true
    if (msg.snapshot) {
      snapshots[msg.provider] = { ...msg.snapshot, provider: msg.provider }
      cacheSnapshot(msg.provider, snapshots[msg.provider]!)
    }
    hydrated[msg.provider] = true
    notify()
  }
}

export function listenForSiteExtension() {
  function onMessage(event: MessageEvent) {
    if (event.origin !== window.location.origin) return
    ingestSiteBridgeMessage(event.data)
  }
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}
