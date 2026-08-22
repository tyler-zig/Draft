const PAGE_SOURCE = 'draft-assistant-nfl-page'

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.data?.source !== PAGE_SOURCE) return
  chrome.runtime.sendMessage({ type: 'SITE_SNAPSHOT', provider: 'nfl', payload: event.data }).catch(() => {})
})
