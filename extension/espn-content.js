const PAGE_SOURCE = 'draft-assistant-espn-page'
const BRIDGE_SOURCE = 'draft-assistant-espn-bridge'

let lastPlayers = []

function mergeSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return payload
  if (Array.isArray(payload.players) && payload.players.length) {
    lastPlayers = payload.players
  }
  return {
    ...payload,
    players: Array.isArray(payload.players) ? payload.players : lastPlayers,
  }
}

function applySnapshot(payload) {
  const snapshot = mergeSnapshot(payload)
  globalThis.DraftAssistantOverlay?.updateFromSnapshot(snapshot)
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.data?.source !== PAGE_SOURCE) return
  applySnapshot(event.data)
  chrome.runtime
    .sendMessage({ type: 'ESPN_SNAPSHOT', payload: event.data })
    .then((response) => {
      // The worker lost its cached player list (most likely it was reloaded).
      // Tell the page to refetch instead of waiting out its refresh interval.
      if (response?.needPlayers) {
        window.postMessage({ source: BRIDGE_SOURCE, type: 'RESEND_PLAYERS' }, '*')
      }
    })
    .catch(() => {
      /* worker asleep or reloading; the next poll will retry */
    })
})

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'ESPN_VALUATIONS') {
    globalThis.DraftAssistantOverlay?.updateValuations(message.payload ?? null)
  }
})

function requestStored(type, apply) {
  chrome.runtime.sendMessage({ type }, (payload) => {
    if (chrome.runtime.lastError) return
    apply(payload)
  })
}

requestStored('GET_ESPN_SNAPSHOT', (payload) => {
  if (payload) applySnapshot(payload)
})
requestStored('GET_ESPN_VALUATIONS', (payload) => {
  if (payload) globalThis.DraftAssistantOverlay?.updateValuations(payload)
})

if (globalThis.DraftAssistantOverlay?.isDraftPath()) {
  globalThis.DraftAssistantOverlay.mount()
}
