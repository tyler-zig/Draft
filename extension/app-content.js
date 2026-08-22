(() => {
if (globalThis.__draftAssistantAppRelayInstalled) return
globalThis.__draftAssistantAppRelayInstalled = true

const SOURCE = 'draft-assistant-extension'
const APP_SOURCE = 'draft-assistant-app'
const HOSTED_APP_HOSTS = new Set(['draft-bice-omega.vercel.app'])
const isAppPage = Boolean(document.querySelector('meta[name="draft-assistant-app"]'))
  || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  || (location.protocol === 'https:' && HOSTED_APP_HOSTS.has(location.hostname))

if (isAppPage) {
  chrome.runtime.sendMessage({ type: 'REGISTER_APP_ORIGIN', origin: location.origin }, () => {
    void chrome.runtime.lastError
  })
}

function publish(payload) {
  window.postMessage(
    {
      source: SOURCE,
      type: 'STATUS',
      installed: true,
      snapshot: payload,
    },
    '*',
  )
}

function publishPracticeExit(payload) {
  window.postMessage(
    {
      source: SOURCE,
      type: 'STATUS',
      installed: true,
      exitedPractice: true,
      snapshot: payload ?? null,
    },
    '*',
  )
}

function requestStoredSnapshot() {
  chrome.runtime.sendMessage({ type: 'GET_ESPN_SNAPSHOT' }, (payload) => {
    // Reading lastError prevents Chrome from logging an uncaught callback
    // error while the MV3 worker is waking up. The app retries the handshake.
    if (chrome.runtime.lastError) return
    publish(payload ?? null)
  })
}

function requestStoredSiteSnapshot(provider) {
  chrome.runtime.sendMessage({ type: 'GET_SITE_SNAPSHOT', provider }, (payload) => {
    if (chrome.runtime.lastError) return
    window.postMessage({ source: SOURCE, type: 'SITE_SNAPSHOT', provider, snapshot: payload ?? null }, '*')
  })
}

function requestStoredSnapshots() {
  requestStoredSnapshot()
  requestStoredSiteSnapshot('yahoo')
  requestStoredSiteSnapshot('nfl')
}

window.addEventListener('message', (event) => {
  if (!isAppPage) return
  if (event.source !== window) return
  if (event.data?.source !== APP_SOURCE) return
  if (event.data.type === 'GET_ESPN_SNAPSHOT') {
    requestStoredSnapshot()
    return
  }
  if (event.data.type === 'EXIT_ESPN_PRACTICE') {
    chrome.runtime.sendMessage({ type: 'EXIT_ESPN_PRACTICE' }, (result) => {
      if (chrome.runtime.lastError) return
      window.postMessage({ source: SOURCE, type: 'EXIT_ESPN_PRACTICE_ACK', result }, '*')
    })
    return
  }
  if (event.data.type === 'GET_SITE_SNAPSHOT') {
    chrome.runtime.sendMessage({ type: 'GET_SITE_SNAPSHOT', provider: event.data.provider }, (payload) => {
      if (chrome.runtime.lastError) return
      window.postMessage({ source: SOURCE, type: 'SITE_SNAPSHOT', provider: event.data.provider, snapshot: payload ?? null }, '*')
    })
    return
  }
  if (event.data.type === 'OPEN_SITE') {
    chrome.runtime.sendMessage({
      type: 'OPEN_SITE',
      provider: event.data.provider,
      leagueId: event.data.leagueId,
      season: event.data.season,
      teamId: event.data.teamId,
      url: event.data.url,
    })
    window.postMessage({ source: SOURCE, type: 'OPEN_SITE_ACK', provider: event.data.provider }, '*')
    return
  }
  if (event.data.type === 'OPEN_ESPN') {
    chrome.runtime.sendMessage({
      type: 'OPEN_ESPN',
      leagueId: event.data.leagueId,
      season: event.data.season,
      teamId: event.data.teamId,
      url: event.data.url,
    })
    window.postMessage({ source: SOURCE, type: 'OPEN_ESPN_ACK' }, '*')
    return
  }
  if (event.data.type === 'PUBLISH_ESPN_SUGGESTIONS') {
    chrome.runtime.sendMessage({
      type: 'PUBLISH_ESPN_SUGGESTIONS',
      payload: event.data.payload ?? null,
    })
  }
  if (event.data.type === 'PUBLISH_ESPN_VALUATIONS') {
    chrome.runtime.sendMessage({
      type: 'PUBLISH_ESPN_VALUATIONS',
      payload: event.data.payload ?? null,
    })
  }
})

chrome.runtime.onMessage.addListener((message) => {
  if (!isAppPage) return
  if (message?.type === 'ESPN_SNAPSHOT') {
    publish(message.payload ?? null)
  }
  if (message?.type === 'ESPN_PRACTICE_EXITED') {
    publishPracticeExit(message.payload ?? null)
  }
  if (message?.type === 'SITE_SNAPSHOT') {
    window.postMessage({
      source: SOURCE,
      type: 'SITE_SNAPSHOT',
      provider: message.provider,
      snapshot: message.payload ?? null,
    }, '*')
  }
  if (message?.type === 'RANKINGS_SNAPSHOT') {
    window.postMessage({ source: SOURCE, type: 'RANKINGS_SNAPSHOT', payload: message.payload }, '*')
  }
})

if (!isAppPage) return

requestStoredSnapshots()

// Chrome may restore the app document from bfcache without rerunning this
// script. Re-publish the stored snapshot whenever that document becomes live.
window.addEventListener('pageshow', requestStoredSnapshots)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestStoredSnapshots()
})

chrome.runtime.sendMessage({ type: 'GET_RANKINGS_SNAPSHOT' }, (payload) => {
  window.postMessage({ source: SOURCE, type: 'RANKINGS_SNAPSHOT', payload }, '*')
})

window.postMessage({ source: SOURCE, type: 'STATUS', installed: true }, '*')
})()
