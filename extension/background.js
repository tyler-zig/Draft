/**
 * Any port on the loopback host, plus the hosted Vercel app. Vite moves to
 * 5174+ when 5173 is taken, so pinning one port silently broke the sync
 * whenever the dev server did not land where the extension expected it.
 */
importScripts('app-hosts.js')

async function extraAppOrigins() {
  try {
    const stored = await chrome.storage.local.get('appOrigins')
    return Array.isArray(stored.appOrigins) ? stored.appOrigins : []
  } catch {
    return []
  }
}

async function rememberAppOrigin(origin) {
  if (!origin || typeof origin !== 'string') return
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'https:' && !isLoopbackHost(parsed.hostname)) return
    const origins = await extraAppOrigins()
    if (origins[0] === parsed.origin) return
    await chrome.storage.local.set({
      appOrigins: [parsed.origin, ...origins.filter((value) => value !== parsed.origin)].slice(0, 8),
    })
  } catch {
    /* ignore a malformed origin from a tab that navigated away */
  }
}

function isEspnDraftTab(url) {
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.endsWith('espn.com')) return false
    return /\/(?:football\/)?draft(?:\/|$)/i.test(parsed.pathname)
  } catch {
    return false
  }
}

function isEspnTransientTab(url) {
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.endsWith('espn.com')) return false
    return /\/(?:football\/)?(?:draft|waitingroom|mockdraftlobby)(?:\/|$)/i.test(parsed.pathname)
  } catch {
    return false
  }
}

function isPracticePayload(payload) {
  if (payload?.isPractice) return true
  const name = String(payload?.league?.settings?.name ?? payload?.league?.name ?? '')
  if (/\b(?:practice|mock)\s+draft\b/i.test(name)) return true
  const subtype = payload?.league?.settings?.leagueSubType ?? payload?.league?.leagueSubType
  const normalized = typeof subtype === 'string' ? subtype.trim().toUpperCase().replace(/[ -]+/g, '_') : subtype
  if (typeof normalized === 'string' && (normalized.includes('MOCK') || normalized.includes('PRACTICE'))) return true
  if (Number(normalized) === 4 || Number(normalized) === 5) return true
  const subtypeId = payload?.league?.settings?.leagueSubTypeId ?? payload?.league?.leagueSubTypeId
  return Number(subtypeId) === 4 || Number(subtypeId) === 5
}
const ESPN_HOME = 'https://fantasy.espn.com/football/'
const SITE_HOME = {
  yahoo: 'https://football.fantasysports.yahoo.com/',
  nfl: 'https://fantasy.nfl.com/',
}
const SITE_QUERY = {
  yahoo: 'https://football.fantasysports.yahoo.com/*',
  nfl: 'https://fantasy.nfl.com/*',
}

function siteUrl(provider, { leagueId, season, teamId, url } = {}) {
  if (provider === 'yahoo') {
    if (url && url.includes('fantasysports.yahoo.com')) return url
    if (leagueId) return teamId
      ? `https://football.fantasysports.yahoo.com/f1/${leagueId}/${teamId}`
      : `https://football.fantasysports.yahoo.com/f1/${leagueId}`
    return SITE_HOME.yahoo
  }
  if (url && url.includes('fantasy.nfl.com')) return url
  if (leagueId) {
    const target = new URL(`https://fantasy.nfl.com/league/${leagueId}`)
    if (teamId) target.searchParams.set('teamId', teamId)
    if (season) target.searchParams.set('season', season)
    return target.toString()
  }
  return SITE_HOME.nfl
}

function espnUrl({ leagueId, season, teamId, url }) {
  if (url && url.startsWith('https://fantasy.espn.com/')) return url
  if (leagueId) {
    const target = new URL('https://fantasy.espn.com/football/team')
    target.searchParams.set('leagueId', leagueId)
    target.searchParams.set('seasonId', season || '2026')
    if (teamId) {
      target.searchParams.set('teamId', teamId)
      target.searchParams.set('fromTeamId', teamId)
    }
    return target.toString()
  }
  return ESPN_HOME
}

async function focusWindow(windowId) {
  if (windowId == null) return
  try {
    await chrome.windows.update(windowId, { focused: true })
  } catch {
    /* ignore */
  }
}

function samePage(tabUrl, targetUrl) {
  try {
    const left = new URL(tabUrl)
    const right = new URL(targetUrl)
    return left.origin === right.origin && left.pathname === right.pathname && left.search === right.search
  } catch {
    return tabUrl === targetUrl
  }
}

async function showAndRefreshTab(existing, url) {
  if (existing?.id) {
    if (samePage(existing.url, url)) {
      await chrome.tabs.update(existing.id, { active: true })
      await focusWindow(existing.windowId)
      await chrome.tabs.reload(existing.id)
      return
    }
    await chrome.tabs.update(existing.id, { active: true, url })
    await focusWindow(existing.windowId)
    return
  }
  await chrome.tabs.create({ url, active: true })
}

async function returnToAppTab(sender) {
  if (!sender?.tab?.id) return
  try {
    await chrome.tabs.update(sender.tab.id, { active: true })
    await focusWindow(sender.tab.windowId)
  } catch {
    /* the app tab may have closed while the league page loaded */
  }
}

async function openEspn(opts, sender) {
  const url = espnUrl(opts || {})
  const tabs = await chrome.tabs.query({ url: 'https://fantasy.espn.com/*' })
  const lasting = tabs.filter((tab) => tab.url && !isEspnTransientTab(tab.url))
  const leagueId = opts?.leagueId
  if (leagueId) {
    const existing = lasting.find(
      (tab) => tab.url && tab.url.includes(`leagueId=${leagueId}`),
    )
    if (existing?.id) {
      await showAndRefreshTab(existing, url)
      if (opts?.returnToApp) await returnToAppTab(sender)
      return { ok: true }
    }
  }
  const requestedPath = (() => {
    try { return new URL(url).pathname } catch { return '' }
  })()
  if (opts?.url || requestedPath.includes('mockdraftlobby') || requestedPath.includes('/draft')) {
    const existing = tabs.find((tab) => {
      if (!tab.url) return false
      try { return new URL(tab.url).pathname === requestedPath } catch { return tab.url.includes(requestedPath) }
    })
    await showAndRefreshTab(existing, url)
    if (opts?.returnToApp) await returnToAppTab(sender)
    return { ok: true }
  }
  // Never reuse a dead practice/draft tab — that keeps the app on the clone.
  const existing = lasting.find(
    (tab) => tab.url && tab.url.includes('fantasy.espn.com/football'),
  )
  await showAndRefreshTab(existing, url)
  if (opts?.returnToApp) await returnToAppTab(sender)
  return { ok: true }
}

async function openSite(provider, opts, sender) {
  const url = siteUrl(provider, opts || {})
  const tabs = await chrome.tabs.query({ url: SITE_QUERY[provider] })
  const leagueId = opts?.leagueId
  const match = leagueId
    ? tabs.find((tab) => tab.url && (tab.url.includes(`/f1/${leagueId}`) || tab.url.includes(`/league/${leagueId}`) || tab.url.includes(`leagueId=${leagueId}`)))
    : tabs[0]
  await showAndRefreshTab(match, url)
  if (opts?.returnToApp) await returnToAppTab(sender)
  return { ok: true }
}

function siteStorageKey(provider) {
  return provider === 'yahoo' ? 'yahooSnapshot' : 'nflSnapshot'
}

async function saveSiteSnapshot(provider, payload) {
  const key = siteStorageKey(provider)
  try {
    await chrome.storage.session.set({ [key]: payload })
  } catch (error) {
    console.warn('[draft-assistant] could not persist site snapshot:', error)
  }
  await broadcast({ type: 'SITE_SNAPSHOT', provider, payload })
  return { ok: true }
}
const RANKING_URLS = [
  'https://www.cbssports.com/fantasy/football/rankings/',
  'https://www.rotowire.com/football/rankings.php',
  'https://www.rotowire.com/football/expert-rankings.php',
]
const RANKING_ALARM = 'scrape-open-rankings'

/**
 * The injector omits `players` when the list has not changed since its last
 * post, so most snapshots are a few KB instead of megabytes. Rehydrate from
 * the stored copy here, so the app always receives a complete snapshot and
 * needs no knowledge of this optimisation.
 */
const IGNORED_PRACTICE_KEY = 'espnIgnoredPracticeLeagueIds'
/** Enough to cover a session's worth of throwaway clones without growing forever. */
const IGNORED_PRACTICE_LIMIT = 20

/**
 * Practice clones the user has explicitly left.
 *
 * In `local`, not `session`: an MV3 worker unloads after about thirty seconds
 * idle, and session storage does not survive that. A still-open practice tab
 * polls on its own schedule, so a forgotten flag meant the next poll walked the
 * app straight back into the room it had just been told to leave.
 *
 * A list rather than one id, because leaving a second clone must not un-ignore
 * the first while its tab is still sitting there polling.
 */
async function readIgnoredPractice() {
  const [saved, legacy] = await Promise.all([
    chrome.storage.local.get(IGNORED_PRACTICE_KEY),
    chrome.storage.session.get('espnIgnoredPracticeLeagueId'),
  ])
  const ids = Array.isArray(saved?.[IGNORED_PRACTICE_KEY]) ? saved[IGNORED_PRACTICE_KEY].map(String) : []
  // Carried over from the single-value key an older build wrote.
  const previous = legacy?.espnIgnoredPracticeLeagueId
  if (previous && !ids.includes(String(previous))) ids.push(String(previous))
  return ids
}

async function ignorePracticeLeague(leagueId) {
  if (!leagueId) return
  const id = String(leagueId)
  const ids = await readIgnoredPractice()
  const next = [id, ...ids.filter((value) => value !== id)].slice(0, IGNORED_PRACTICE_LIMIT)
  try {
    await chrome.storage.local.set({ [IGNORED_PRACTICE_KEY]: next })
  } catch (error) {
    console.warn('[draft-assistant] could not remember the exited practice draft:', error)
  }
}

/** Only on a deliberate return -- never as a side effect of any other snapshot. */
async function clearIgnoredPractice() {
  try {
    await chrome.storage.local.set({ [IGNORED_PRACTICE_KEY]: [] })
    await chrome.storage.session.set({ espnIgnoredPracticeLeagueId: null })
  } catch (error) {
    console.warn('[draft-assistant] could not clear the practice ignore list:', error)
  }
}

async function saveSnapshot(payload) {
  const stored = await chrome.storage.session.get(['espnSnapshot', 'espnHomeSnapshot'])
  const previous = stored.espnSnapshot
  const home = stored.espnHomeSnapshot
  const merged = { ...payload }
  if (!Array.isArray(merged.players)) {
    merged.players = Array.isArray(previous?.players) && previous.players.length
      ? previous.players
      : (Array.isArray(home?.players) ? home.players : [])
  }

  const practice = isPracticePayload(merged) || isPracticePayload(previous)
  if (isPracticePayload(merged) && merged.leagueId) {
    const ignored = await readIgnoredPractice()
    if (ignored.includes(String(merged.leagueId))) {
      return { needPlayers: false, ignored: true }
    }
  }
  const failed = Boolean(merged.error && !merged.league)
  if (failed && practice && home?.league) {
    try {
      await chrome.storage.session.set({ espnSnapshot: home })
    } catch (error) {
      console.warn('[draft-assistant] could not persist ESPN snapshot:', error)
    }
    await broadcast({ type: 'ESPN_SNAPSHOT', payload: home })
    return { needPlayers: !home.players?.length }
  }

  try {
    // Deliberately does not clear the practice ignore list: a real league's
    // snapshot arriving is not the user asking to rejoin a clone they left.
    const next = { espnSnapshot: merged }
    if (merged.league && !isPracticePayload(merged)) next.espnHomeSnapshot = merged
    await chrome.storage.session.set(next)
  } catch (error) {
    // Quota failures used to be silent, leaving the app on a stale snapshot
    // with nothing to explain it. Keep serving the live one either way.
    console.warn('[draft-assistant] could not persist ESPN snapshot:', error)
  }

  await broadcast({ type: 'ESPN_SNAPSHOT', payload: merged })

  // Session storage is dropped when this worker is reloaded. If that happened
  // while the ESPN tab kept running, nobody holds a player list any more and
  // the injector would not refetch for another ten minutes -- so ask for one.
  return { needPlayers: merged.players.length === 0 }
}

async function exitEspnPractice() {
  const stored = await chrome.storage.session.get(['espnSnapshot', 'espnHomeSnapshot'])
  const current = stored.espnSnapshot
  const currentIsPractice = isPracticePayload(current)
  const homeCandidate = stored.espnHomeSnapshot?.league ? stored.espnHomeSnapshot : null
  const home = homeCandidate && !isPracticePayload(homeCandidate) && (!currentIsPractice || String(homeCandidate.leagueId) !== String(current?.leagueId))
    ? homeCandidate
    : null
  const ignoredPracticeLeagueId = currentIsPractice
    ? String(current?.leagueId || '') || null
    : null
  await chrome.storage.session.set({
    espnSnapshot: home,
    espnIgnoredPracticeLeagueId: ignoredPracticeLeagueId,
    espnSuggestions: null,
  })
  await ignorePracticeLeague(ignoredPracticeLeagueId)
  await broadcast({ type: 'ESPN_PRACTICE_EXITED', payload: home })
  return { ok: true, restoredLeagueId: home?.leagueId ?? null }
}

async function broadcast(message) {
  const extras = await extraAppOrigins()
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (!tab.id || !tab.url || !isAppTab(tab.url, extras)) continue
    try {
      await chrome.tabs.sendMessage(tab.id, message)
    } catch {
      // Reloading an unpacked extension invalidates content scripts in tabs
      // that were already open. Restore the app relay and retry instead of
      // making the user refresh Draft Assistant during a live draft.
      if (!chrome.scripting?.executeScript) continue
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['app-content.js'],
        })
        await chrome.tabs.sendMessage(tab.id, message)
      } catch {
        /* The tab may have navigated or closed between query and delivery. */
      }
    }
  }
}

async function broadcastEspnSuggestions(payload) {
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (!tab.id || !tab.url || !isEspnDraftTab(tab.url)) continue
    chrome.tabs.sendMessage(tab.id, { type: 'ESPN_SUGGESTIONS', payload }).catch(() => {})
  }
}

async function broadcastEspnValuations(payload) {
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (!tab.id || !tab.url || !isEspnDraftTab(tab.url)) continue
    chrome.tabs.sendMessage(tab.id, { type: 'ESPN_VALUATIONS', payload }).catch(() => {})
  }
}

/**
 * The app's player valuations -- projections, VORP, live ADP, tiers.
 *
 * `local`, not `session`, because these barely change during a draft and the
 * overlay's whole point is to keep working when the app tab is closed. Losing
 * them on a browser restart would silently drop the overlay back to ESPN's
 * editorial rank, which is the thing this replaced.
 */
async function saveEspnValuations(payload) {
  try {
    await chrome.storage.local.set({ espnValuations: payload })
  } catch (error) {
    console.warn('[draft-assistant] could not persist ESPN valuations:', error)
  }
  await broadcastEspnValuations(payload)
  return { ok: true }
}

async function saveEspnSuggestions(payload) {
  try {
    await chrome.storage.session.set({ espnSuggestions: payload })
  } catch (error) {
    console.warn('[draft-assistant] could not persist ESPN suggestions:', error)
  }
  await broadcastEspnSuggestions(payload)
  return { ok: true }
}

async function saveRankings(payload) {
  try {
    await chrome.storage.session.set({ rankingsSnapshot: payload })
  } catch (error) {
    console.warn('[draft-assistant] could not persist rankings snapshot:', error)
  }
  await broadcast({ type: 'RANKINGS_SNAPSHOT', payload })
}

function supportedRankingTab(url) {
  return Boolean(url && RANKING_URLS.some((prefix) => url.startsWith(prefix)))
}

async function scrapeOpenRankingTabs() {
  const tabs = await chrome.tabs.query({})
  const targets = tabs.filter((tab) => tab.id && supportedRankingTab(tab.url))
  const results = await Promise.all(targets.map(async (tab) => {
    try {
      return await chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_RANKINGS' })
    } catch {
      return { ok: false }
    }
  }))
  return { ok: results.some((result) => result?.ok), count: results.reduce((sum, result) => sum + (result?.count || 0), 0) }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(RANKING_ALARM, { periodInMinutes: 360 })
})

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(RANKING_ALARM, { periodInMinutes: 360 })
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RANKING_ALARM) void scrapeOpenRankingTabs()
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'ESPN_SNAPSHOT' && message.payload) {
    saveSnapshot(message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch(() => sendResponse({ ok: false }))
    return true
  }
  if (message?.type === 'GET_ESPN_SNAPSHOT') {
    chrome.storage.session.get('espnSnapshot').then((data) => {
      sendResponse(data.espnSnapshot ?? null)
    })
    return true
  }
  if (message?.type === 'EXIT_ESPN_PRACTICE') {
    exitEspnPractice().then(sendResponse).catch(() => sendResponse({ ok: false }))
    return true
  }
  if (message?.type === 'RANKINGS_SNAPSHOT' && message.payload) {
    void saveRankings(message.payload)
    sendResponse({ ok: true })
    return true
  }
  if (message?.type === 'GET_RANKINGS_SNAPSHOT') {
    chrome.storage.session.get('rankingsSnapshot').then((data) => sendResponse(data.rankingsSnapshot ?? null))
    return true
  }
  if (message?.type === 'SCRAPE_CURRENT_RANKINGS') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab?.id) return sendResponse({ ok: false, error: 'No active tab' })
      chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_RANKINGS' })
        .then((result) => sendResponse(result))
        .catch(() => sendResponse({ ok: false, error: 'Open a supported public CBS or RotoWire rankings page first.' }))
    })
    return true
  }
  if (message?.type === 'SCRAPE_OPEN_RANKINGS') {
    scrapeOpenRankingTabs().then(sendResponse)
    return true
  }
  if (message?.type === 'OPEN_ESPN') {
    const resetIgnoredPractice = String(message.url || '').includes('mockdraftlobby')
      ? clearIgnoredPractice()
      : Promise.resolve()
    resetIgnoredPractice
      .then(() => openEspn(message, sender))
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }))
    return true
  }
  if (message?.type === 'SITE_SNAPSHOT' && message.payload && (message.provider === 'yahoo' || message.provider === 'nfl')) {
    saveSiteSnapshot(message.provider, message.payload)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false }))
    return true
  }
  if (message?.type === 'GET_SITE_SNAPSHOT') {
    const key = siteStorageKey(message.provider)
    chrome.storage.session.get(key).then((data) => sendResponse(data[key] ?? null))
    return true
  }
  if (message?.type === 'OPEN_SITE' && (message.provider === 'yahoo' || message.provider === 'nfl')) {
    openSite(message.provider, message, sender).then(sendResponse).catch(() => sendResponse({ ok: false }))
    return true
  }
  if (message?.type === 'PUBLISH_ESPN_SUGGESTIONS') {
    saveEspnSuggestions(message.payload ?? null)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false }))
    return true
  }
  if (message?.type === 'GET_ESPN_SUGGESTIONS') {
    chrome.storage.session.get('espnSuggestions').then((data) => {
      sendResponse(data.espnSuggestions ?? null)
    })
    return true
  }
  if (message?.type === 'PUBLISH_ESPN_VALUATIONS') {
    saveEspnValuations(message.payload ?? null)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false }))
    return true
  }
  if (message?.type === 'GET_ESPN_VALUATIONS') {
    chrome.storage.local.get('espnValuations').then((data) => {
      sendResponse(data.espnValuations ?? null)
    })
    return true
  }
  if (message?.type === 'REGISTER_APP_ORIGIN' && message.origin) {
    rememberAppOrigin(message.origin).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }))
    return true
  }
  return false
})
