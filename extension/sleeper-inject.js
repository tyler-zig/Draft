/**
 * Submits a draft pick to Sleeper from inside sleeper.com's own page.
 *
 * Sleeper's GraphQL API is read-open but write-closed: `draft_pick_player`
 * answers `{"code":"unauthorized"}` without an `authorization` header, and
 * `"Your token is invalid."` with a bad one. The app itself is served from
 * localhost / the Vercel deploy and has no Sleeper session, so it cannot make
 * that call -- and asking a user to paste a session token into the app would
 * put a full-account bearer credential in `localStorage`.
 *
 * So the call is made here instead, in the MAIN world of a tab the user is
 * already logged into. The token is read by observing the header sleeper.com
 * already sends on its own requests, and it never leaves this page: the
 * content script relays an intent ("pick player X at pick N") and a result,
 * never the credential. Nothing is stored, and nothing crosses an origin.
 */
(() => {
if (window.__draftAssistantSleeperPickInstalled) return
window.__draftAssistantSleeperPickInstalled = true

const CMD_SOURCE = 'draft-assistant-sleeper-cmd'
const PAGE_SOURCE = 'draft-assistant-sleeper-page'
const GRAPHQL = 'https://sleeper.com/graphql'

const PICK_MUTATION =
  'mutation draft_pick_player($sport: String!, $draft_id: String!, $player_id: String!, $pick_no: Int!) {' +
  ' draft_pick_player(sport: $sport, draft_id: $draft_id, player_id: $player_id, pick_no: $pick_no) {' +
  ' pick_no player_id }' +
  '}'

/**
 * The `authorization` value sleeper.com last sent for itself.
 *
 * Held only in this closure. It is deliberately not posted to the content
 * script, the service worker, or the app.
 */
let observedToken = null

function rememberToken(value) {
  if (typeof value === 'string' && value.length > 8) observedToken = value
}

function headerFrom(init, input) {
  const fromInit = init && init.headers
  if (fromInit) {
    if (typeof Headers !== 'undefined' && fromInit instanceof Headers) return fromInit.get('authorization')
    if (Array.isArray(fromInit)) {
      const row = fromInit.find((entry) => String(entry?.[0]).toLowerCase() === 'authorization')
      return row ? row[1] : null
    }
    for (const key of Object.keys(fromInit)) {
      if (key.toLowerCase() === 'authorization') return fromInit[key]
    }
  }
  if (input && typeof input.headers?.get === 'function') return input.headers.get('authorization')
  return null
}

// Patched the same way espn-inject.js observes ESPN's draft socket: wrap the
// native, read what the page was going to send anyway, change nothing.
const nativeFetch = window.fetch
if (typeof nativeFetch === 'function') {
  window.fetch = function observedFetch(input, init) {
    try {
      const url = String((typeof input === 'string' ? input : input?.url) || '')
      if (url.includes('/graphql')) rememberToken(headerFrom(init, input))
    } catch {
      /* never let observation break the page's own request */
    }
    return nativeFetch.apply(this, arguments)
  }
}

const nativeSetHeader = XMLHttpRequest.prototype.setRequestHeader
XMLHttpRequest.prototype.setRequestHeader = function observedSetHeader(name, value) {
  try {
    if (String(name).toLowerCase() === 'authorization') rememberToken(value)
  } catch {
    /* as above */
  }
  return nativeSetHeader.apply(this, arguments)
}

function reply(requestId, result) {
  window.postMessage({ source: PAGE_SOURCE, type: 'DRAFT_PICK_RESULT', requestId, ...result }, window.location.origin)
}

async function submitPick(requestId, command) {
  const draftId = String(command.draftId || '')
  const playerId = String(command.playerId || '')
  const pickNo = Number(command.pickNo)
  if (!draftId || !playerId || !Number.isInteger(pickNo) || pickNo < 1) {
    reply(requestId, { ok: false, error: 'Malformed pick request.' })
    return
  }
  if (!observedToken) {
    reply(requestId, {
      ok: false,
      error: 'Not signed in to Sleeper in this tab yet. Open your draft on sleeper.com, then try again.',
    })
    return
  }
  try {
    const res = await nativeFetch.call(window, GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: observedToken },
      body: JSON.stringify({
        query: PICK_MUTATION,
        variables: { sport: 'nfl', draft_id: draftId, player_id: playerId, pick_no: pickNo },
      }),
      cache: 'no-store',
    })
    const body = await res.json().catch(() => null)
    const failure = body?.errors?.[0]
    if (failure) {
      reply(requestId, { ok: false, error: String(failure.message || 'Sleeper rejected the pick.') })
      return
    }
    if (!res.ok || !body?.data?.draft_pick_player) {
      reply(requestId, { ok: false, error: `Sleeper rejected the pick (${res.status}).` })
      return
    }
    reply(requestId, { ok: true, pickNo: body.data.draft_pick_player.pick_no })
  } catch (error) {
    reply(requestId, { ok: false, error: String(error?.message || 'Could not reach Sleeper.') })
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.origin !== window.location.origin) return
  if (event.data?.source !== CMD_SOURCE) return
  if (event.data.type !== 'DRAFT_PICK') return
  void submitPick(event.data.requestId, event.data)
})
})()
