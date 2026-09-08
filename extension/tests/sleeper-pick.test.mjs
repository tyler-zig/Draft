/**
 * Verifies the Sleeper pick path never leaks the session token and refuses to
 * send anything it was not asked to send.
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import vm from 'node:vm'

const src = readFileSync(new URL('../sleeper-inject.js', import.meta.url), 'utf8')
const ORIGIN = 'https://sleeper.com'

function boot({ fetchImpl } = {}) {
  const posted = []
  const listeners = []
  const fetchCalls = []

  const win = {
    location: { origin: ORIGIN },
    postMessage: (data) => posted.push(data),
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn) },
    fetch: fetchImpl ?? (async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) })),
  }
  const ctx = {
    window: win,
    XMLHttpRequest: { prototype: { setRequestHeader() {} } },
    Headers: class Headers {
      constructor(init) { this.map = new Map(Object.entries(init ?? {})) }
      get(name) { return this.map.get(name) ?? this.map.get(String(name).toLowerCase()) ?? null }
    },
    JSON,
    Number,
    String,
    Boolean,
    Object,
    Array,
    console,
    setTimeout,
  }
  ctx.globalThis = ctx
  vm.createContext(ctx)
  vm.runInContext(src, ctx)

  const deliver = (data) => {
    for (const fn of listeners) fn({ source: win, origin: ORIGIN, data })
  }
  // Wrap fetch after boot so the script's own patch is exercised first.
  const originalFetch = win.fetch
  win.fetch = async (...args) => { fetchCalls.push(args); return originalFetch(...args) }
  return { win, posted, deliver, fetchCalls, ctx }
}

function pickCommand(over = {}) {
  return {
    source: 'draft-assistant-sleeper-cmd',
    type: 'DRAFT_PICK',
    requestId: 'r1',
    draftId: '42',
    playerId: '7564',
    pickNo: 13,
    ...over,
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// Without an observed token there is nothing to authenticate with, so the
// script must say so rather than send an unauthenticated write.
{
  const { posted, deliver } = boot()
  deliver(pickCommand())
  await settle()
  assert.equal(posted.length, 1)
  assert.equal(posted[0].ok, false)
  assert.match(posted[0].error, /signed in to Sleeper/i)
}

// A malformed request is rejected before any network call.
{
  const { posted, deliver, fetchCalls } = boot()
  deliver(pickCommand({ pickNo: 0 }))
  await settle()
  assert.equal(posted[0].ok, false)
  assert.match(posted[0].error, /malformed/i)
  assert.equal(fetchCalls.length, 0)
}

// The token is captured from the page's own request and used for the mutation
// -- and it is never included in anything posted back out of the page.
{
  let sent = null
  const { win, posted, deliver } = boot({
    fetchImpl: async (url, init) => {
      sent = { url, init }
      return { ok: true, status: 200, json: async () => ({ data: { draft_pick_player: { pick_no: 13 } } }) }
    },
  })
  // sleeper.com makes its own GraphQL call, carrying the session token.
  await win.fetch('https://sleeper.com/graphql', { headers: { authorization: 'secret-token' } })
  deliver(pickCommand())
  await settle()

  assert.equal(sent.url, 'https://sleeper.com/graphql')
  assert.equal(sent.init.headers.authorization, 'secret-token')
  const body = JSON.parse(sent.init.body)
  assert.equal(body.variables.draft_id, '42')
  assert.equal(body.variables.player_id, '7564')
  assert.equal(body.variables.pick_no, 13)

  const result = posted.at(-1)
  assert.equal(result.ok, true)
  assert.equal(result.requestId, 'r1')
  assert.ok(!JSON.stringify(posted).includes('secret-token'), 'token must never be posted out of the page')
}

// A GraphQL-level rejection is reported, not swallowed as success.
{
  const { win, posted, deliver } = boot({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: 'Not your pick.' }] }) }),
  })
  await win.fetch('https://sleeper.com/graphql', { headers: { authorization: 'tok-long-enough' } })
  deliver(pickCommand())
  await settle()
  const result = posted.at(-1)
  assert.equal(result.ok, false)
  assert.equal(result.error, 'Not your pick.')
}

// Messages from another source are ignored outright.
{
  const { win, posted, deliver } = boot()
  await win.fetch('https://sleeper.com/graphql', { headers: { authorization: 'tok-long-enough' } })
  deliver({ ...pickCommand(), source: 'somebody-else' })
  await settle()
  assert.equal(posted.filter((data) => data.type === 'DRAFT_PICK_RESULT').length, 0)
}

// The badge is told when picking becomes possible -- as a boolean, never the
// token that made it possible.
{
  const { win, posted, deliver } = boot()
  assert.equal(posted.length, 0, 'nothing is announced before a token is seen')

  deliver({ source: 'draft-assistant-sleeper-cmd', type: 'PICK_STATUS_QUERY' })
  await settle()
  assert.deepEqual(
    posted.map((data) => [data.type, data.ready]),
    [['PICK_STATUS', false]],
    'a cold page reports not-ready rather than staying silent',
  )

  await win.fetch('https://sleeper.com/graphql', { headers: { authorization: 'secret-token-value' } })
  await settle()
  // Spread first: the script builds this object with the vm context's own
  // Object.prototype, which a strict deep-equal counts as a different shape.
  assert.deepEqual({ ...posted.at(-1) }, {
    source: 'draft-assistant-sleeper-page',
    type: 'PICK_STATUS',
    ready: true,
  })
  assert.ok(!JSON.stringify(posted).includes('secret-token-value'), 'status must not carry the token')

  // Observing further requests must not re-announce on every call.
  const before = posted.length
  await win.fetch('https://sleeper.com/graphql', { headers: { authorization: 'secret-token-value' } })
  await settle()
  assert.equal(posted.length, before)
}

console.log('sleeper-pick.test.mjs ok')
