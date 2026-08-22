const PAGE_SOURCE = 'draft-assistant-yahoo-page'

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.data?.source !== PAGE_SOURCE) return
  chrome.runtime.sendMessage({ type: 'SITE_SNAPSHOT', provider: 'yahoo', payload: event.data }).catch(() => {})
})
