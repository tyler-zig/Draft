/**
 * Relays a pick request from the service worker into sleeper.com's page.
 *
 * Yahoo and NFL relay page -> extension; this one runs the other way, so it
 * carries a `requestId` and answers exactly once. The page holds the Sleeper
 * credential (see sleeper-inject.js); only the intent and the outcome cross
 * this boundary.
 */
const CMD_SOURCE = 'draft-assistant-sleeper-cmd'
const PAGE_SOURCE = 'draft-assistant-sleeper-page'
const PICK_TIMEOUT_MS = 10_000

let nextRequestId = 0

function submitPick(command) {
  return new Promise((resolve) => {
    const requestId = `pick-${Date.now()}-${nextRequestId++}`
    let settled = false

    const finish = (result) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
      resolve(result)
    }

    function onMessage(event) {
      if (event.source !== window) return
      if (event.data?.source !== PAGE_SOURCE) return
      if (event.data.type !== 'DRAFT_PICK_RESULT') return
      if (event.data.requestId !== requestId) return
      finish({ ok: Boolean(event.data.ok), error: event.data.error ?? null, pickNo: event.data.pickNo ?? null })
    }

    const timer = setTimeout(
      () => finish({ ok: false, error: 'Sleeper did not answer in time. Check the draft board before retrying.' }),
      PICK_TIMEOUT_MS,
    )
    window.addEventListener('message', onMessage)
    window.postMessage(
      {
        source: CMD_SOURCE,
        type: 'DRAFT_PICK',
        requestId,
        draftId: command.draftId,
        playerId: command.playerId,
        pickNo: command.pickNo,
      },
      window.location.origin,
    )
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'SLEEPER_DRAFT_PICK') return false
  submitPick(message).then(sendResponse)
  return true
})
