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
  submitPick(message).then((result) => {
    showBadgeResult(result)
    sendResponse(result)
  })
  return true
})

/* ---------------------------------------------------------------- badge --- */

/**
 * A small "connected" marker on Sleeper's own draft page.
 *
 * Without it there is no way to tell, from the tab you are actually drafting
 * in, whether the assistant can reach this draft -- and the failure mode is
 * silent until you try to pick and it does not work. It reports the honest
 * distinction: installed, versus armed and able to submit.
 *
 * Palette and shadow-DOM host mirror espn-overlay.js so the two look like one
 * product.
 */
const HOST_ID = 'draft-assistant-sleeper-badge'
const BADGE_STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, Segoe UI, sans-serif; }
  .badge {
    position: fixed; left: 16px; bottom: 16px; z-index: 2147483646;
    display: flex; align-items: center; gap: 7px;
    padding: 7px 11px; border-radius: 999px;
    background: #101820; border: 1px solid #2a3646;
    box-shadow: 0 8px 28px rgba(0,0,0,.45);
    color: #e8eef7; font-size: 11px; font-weight: 650; letter-spacing: .01em;
    pointer-events: auto; transition: opacity .2s ease;
  }
  .dot { width: 7px; height: 7px; border-radius: 999px; background: #8b9bb4; flex: none; }
  .badge.ready .dot { background: #3ee0a0; box-shadow: 0 0 0 3px rgba(62,224,160,.16); }
  .badge.sent .dot { background: #3ee0a0; }
  .badge.failed .dot { background: #f0a3a3; }
  .label { white-space: nowrap; }
  .sub { color: #8b9bb4; font-weight: 600; }
`

let host = null
let badgeEl = null
let labelEl = null
let subEl = null
let ready = false
let transient = null
let transientTimer = null

/** Sleeper's draft rooms: /draft/nfl/{id} and the in-league board. */
function isDraftPath() {
  return /\/draft\//.test(location.pathname) || /\/leagues\/\d+\/(?:draft|drafts)/.test(location.pathname)
}

function mountBadge() {
  if (host || !isDraftPath() || !document.documentElement) return
  host = document.createElement('div')
  host.id = HOST_ID
  host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483646;width:0;height:0;overflow:visible;pointer-events:none;'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = BADGE_STYLE
  badgeEl = document.createElement('div')
  badgeEl.className = 'badge'
  const dot = document.createElement('span')
  dot.className = 'dot'
  labelEl = document.createElement('span')
  labelEl.className = 'label'
  subEl = document.createElement('span')
  subEl.className = 'sub'
  badgeEl.append(dot, labelEl, subEl)
  shadow.append(style, badgeEl)
  document.documentElement.appendChild(host)
  renderBadge()
}

function unmountBadge() {
  host?.remove()
  host = null
  badgeEl = null
  labelEl = null
  subEl = null
}

function renderBadge() {
  if (!badgeEl) return
  const state = transient?.state ?? (ready ? 'ready' : '')
  badgeEl.className = `badge ${state}`.trim()
  labelEl.textContent = 'Draft Assistant'
  subEl.textContent = transient
    ? transient.text
    : ready
      ? '· ready to pick'
      : '· connecting'
}

function flashBadge(state, text) {
  transient = { state, text }
  renderBadge()
  clearTimeout(transientTimer)
  transientTimer = setTimeout(() => { transient = null; renderBadge() }, 4000)
}

function showBadgeResult(result) {
  if (result?.ok) flashBadge('sent', '· pick sent')
  else flashBadge('failed', '· pick failed')
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.data?.source !== PAGE_SOURCE) return
  if (event.data.type !== 'PICK_STATUS') return
  ready = Boolean(event.data.ready)
  renderBadge()
})

function syncBadge() {
  if (isDraftPath()) mountBadge()
  else unmountBadge()
}

// Sleeper is a single-page app, so the draft room is entered and left without
// a document load. Polling the path is cheaper and steadier than guessing at
// their router.
syncBadge()
setInterval(syncBadge, 1000)
window.postMessage({ source: CMD_SOURCE, type: 'PICK_STATUS_QUERY' }, window.location.origin)

