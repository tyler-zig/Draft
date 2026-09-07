/** Runs extension/espn-inject.js against a stubbed ESPN page. */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const src = readFileSync(new URL('../espn-inject.js', import.meta.url), 'utf8')

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`) }
}

// One fat kona_player_info record, like the real feed returns.
const fatPlayer = (id) => ({
  player: {
    id,
    defaultPositionId: 1,
    firstName: 'A', lastName: `B${id}`, fullName: `A B${id}`,
    proTeamId: 2, jersey: '9', injuryStatus: 'ACTIVE',
    draftRanksByRankType: { PPR: { rank: id } },
    stats: Array.from({ length: 40 }, (_, i) => ({ i, blob: 'x'.repeat(200) })),
    ownership: { percentOwned: 12.3, averageDraftPosition: 4.5 },
    outlooks: { outlooksByWeek: { 1: 'y'.repeat(500) } },
  },
})

function stubDocument(extra = {}) {
  return {
    cookie: extra.cookie ?? 'SWID=abc',
    referrer: extra.referrer ?? '',
    querySelector: extra.querySelector ?? (() => null),
    querySelectorAll: extra.querySelectorAll ?? (() => []),
    ...extra,
  }
}

function run({ picksByCall, withWebSocket = false, document: doc, pickTimeout = 90 }) {
  const posted = []
  const messageListeners = []
  const sockets = []
  let call = 0
  let poll = null

  class FakeWebSocket {
    constructor(url) {
      this.url = url
      this.listeners = new Map()
      sockets.push(this)
    }
    addEventListener(type, fn) {
      const list = this.listeners.get(type) ?? []
      list.push(fn)
      this.listeners.set(type, list)
    }
    emit(type, data) {
      for (const fn of this.listeners.get(type) ?? []) fn({ data })
    }
  }

  const ctx = {
    console, URL, URLSearchParams, Date, JSON, Math, Buffer, Error,
    setTimeout, clearTimeout,
    location: { href: 'https://fantasy.espn.com/football/draft?leagueId=123&seasonId=2026', pathname: '/football/draft', origin: 'https://fantasy.espn.com' },
    document: doc ?? stubDocument(),
    history: { pushState() {}, replaceState() {} },
    fetch: async (url) => {
      const isPlayers = String(url).includes('kona_player_info')
      if (isPlayers) {
        return { ok: true, status: 200, json: async () => ({ players: Array.from({ length: 50 }, (_, i) => fatPlayer(i)) }) }
      }
      const picks = picksByCall[Math.min(call, picksByCall.length - 1)]
      call += 1
      return {
        ok: true, status: 200,
        json: async () => ({
          settings: {
            scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] },
            draftSettings: { pickTimeout },
          },
          teams: [{ id: 1 }, { id: 2 }],
          draftDetail: { drafted: false, inProgress: true, picks },
        }),
      }
    },
  }
  ctx.window = {
    postMessage: (msg) => { if (msg?.source === 'draft-assistant-espn-page') posted.push(msg) },
    addEventListener: (type, fn) => { if (type === 'message') messageListeners.push(fn) },
    setInterval: (fn) => { if (!poll) poll = fn; return 1 },
    clearInterval: () => {},
    setTimeout,
  }
  ctx.window.window = ctx.window
  if (withWebSocket) ctx.window.WebSocket = FakeWebSocket
  vm.createContext(ctx)
  vm.runInContext(src, ctx)
  return { posted, messageListeners, ctx, sockets, poll: () => poll() }
}

const tick = () => new Promise((r) => setTimeout(r, 30))

console.log('\ndedupe: identical league state must not re-post')
{
  const picks = [{ overallPickNumber: 1, playerId: 7 }]
  const h = run({ picksByCall: [picks, picks, picks] })
  const { posted } = h
  await tick()
  check('first poll posts', posted.length === 1, `got ${posted.length}`)
  check('first poll carries players', Array.isArray(posted[0]?.players) && posted[0].players.length === 50)

  // Two more polls with an unchanged board.
  h.poll(); await tick()
  h.poll(); await tick()
  check('unchanged state posts nothing further', posted.length === 1, `got ${posted.length}`)
}

console.log('\na new pick posts again, without resending players')
{
  const p1 = [{ overallPickNumber: 1, playerId: 7 }]
  const p2 = [{ overallPickNumber: 1, playerId: 7 }, { overallPickNumber: 2, playerId: 9 }]
  const h = run({ picksByCall: [p1, p2] })
  const { posted } = h
  await tick()
  h.poll(); await tick()
  check('second post happened', posted.length === 2, `got ${posted.length}`)
  check('second post omits players', posted[1]?.players === undefined)
  check('second post carries the new pick', posted[1]?.league.draftDetail.picks.length === 2)
}

console.log('\nESPN websocket: SELECTED fills the API lag window')
{
  const stale = [{ overallPickNumber: 1, roundId: 1, roundPickNumber: 1, teamId: 1, playerId: 7 }]
  const h = run({ picksByCall: [stale, stale, stale], withWebSocket: true })
  await tick()
  const socket = new h.ctx.window.WebSocket('wss://fantasydraft.espn.com/league/123')
  socket.emit('message', 'SELECTED 2 9 4\n')
  await tick()
  const picks = h.posted.at(-1)?.league?.draftDetail?.picks ?? []
  check('socket selection posts immediately', h.posted.length === 2, `got ${h.posted.length}`)
  check('adds the selected player while mDraftDetail is stale', picks.some((pick) => pick.playerId === 9 && pick.teamId === 2))
  check('assigns the next overall pick', picks.find((pick) => pick.playerId === 9)?.overallPickNumber === 2)
}

console.log('\nESPN websocket: future keeper does not advance the live pick counter')
{
  const keeperOnly = [
    { overallPickNumber: 10, roundId: 5, roundPickNumber: 2, teamId: 2, playerId: 50, reservedForKeeper: true },
  ]
  const h = run({ picksByCall: [keeperOnly, keeperOnly], withWebSocket: true })
  await tick()
  const socket = new h.ctx.window.WebSocket('wss://fantasydraft.espn.com/league/123')
  socket.emit('message', 'SELECTED 1 9 4\n')
  await tick()
  const picks = h.posted.at(-1)?.league?.draftDetail?.picks ?? []
  check('assigns the first open pick, not keeper + 1', picks.find((pick) => pick.playerId === 9)?.overallPickNumber === 1)
  check('preserves the future keeper reservation', picks.find((pick) => pick.playerId === 50)?.overallPickNumber === 10)
}

console.log('\nESPN websocket: an unstamped keeper still holds its board slot')
{
  // Keepers that are reserved but not yet published carry round / round-pick
  // and no overallPickNumber. The slot is still spoken for.
  const keeperOnly = [
    { roundId: 1, roundPickNumber: 2, teamId: 2, playerId: 50, keeper: true },
  ]
  const h = run({ picksByCall: [keeperOnly, keeperOnly, keeperOnly], withWebSocket: true })
  await tick()
  const socket = new h.ctx.window.WebSocket('wss://fantasydraft.espn.com/league/123')
  socket.emit('message', 'SELECTED 1 9 4\n')
  await tick()
  socket.emit('message', 'SELECTED 1 11 4\n')
  await tick()
  const picks = h.posted.at(-1)?.league?.draftDetail?.picks ?? []
  check('first live pick takes pick 1', picks.find((pick) => pick.playerId === 9)?.overallPickNumber === 1)
  check('next live pick skips the keeper slot', picks.find((pick) => pick.playerId === 11)?.overallPickNumber === 3)
  check('does not overwrite the keeper row', picks.filter((pick) => pick.playerId === 50).length === 1)
}

console.log('\nESPN websocket: a drafted team defense is a real pick')
{
  // ESPN ids team defenses negatively (-16034 is the Texans D/ST) and uses
  // -1 for a pick nobody has made. Only the latter is scaffolding.
  const board = [{ overallPickNumber: 1, roundId: 1, roundPickNumber: 1, teamId: 1, playerId: -1 }]
  const h = run({ picksByCall: [board, board, board], withWebSocket: true })
  await tick()
  const socket = new h.ctx.window.WebSocket('wss://fantasydraft.espn.com/league/123')
  socket.emit('message', 'SELECTED 2 -16034 4\n')
  await tick()
  const picks = h.posted.at(-1)?.league?.draftDetail?.picks ?? []
  check('parses a negative player id off the socket', picks.some((pick) => pick.playerId === -16034))
  check('gives the defense a real pick number', picks.find((pick) => pick.playerId === -16034)?.overallPickNumber === 1)
  // The placeholder must not block the live pick from taking slot 1 (checked
  // above) and must not survive beside it either: one row per board slot, or
  // the cached snapshot stores a duplicate for every pick of the draft.
  check('replaces the -1 placeholder instead of doubling the slot', picks.filter((pick) => pick.overallPickNumber === 1).length === 1)
}

console.log('\npayload size')
{
  const picks = [{ overallPickNumber: 1, playerId: 7 }]
  const { posted } = run({ picksByCall: [picks] })
  await tick()
  const sent = posted[0].players
  const rawBytes = Buffer.byteLength(JSON.stringify(Array.from({ length: 50 }, (_, i) => fatPlayer(i))))
  const trimBytes = Buffer.byteLength(JSON.stringify(sent))
  const keys = Object.keys(sent[0].player).sort().join(',')
  check('stats/outlooks stripped, ADP kept', keys === 'defaultPositionId,draftRanksByRankType,firstName,fullName,id,injuryStatus,jersey,lastName,ownership,proTeamId', keys)
  check('ownership trimmed to ADP alone', JSON.stringify(sent[0].player.ownership) === '{"averageDraftPosition":4.5}', JSON.stringify(sent[0].player.ownership))
  check('draft ranks preserved', sent[0].player.draftRanksByRankType.PPR.rank === 0)
  check(`trimmed ${(rawBytes / 1024).toFixed(0)}KB -> ${(trimBytes / 1024).toFixed(0)}KB`, trimBytes < rawBytes * 0.15)
}

console.log('\npractice draft: mRoster 401 falls back like a 400')
{
  const posted = []
  const ctx = {
    console, URL, URLSearchParams, Date, JSON, Math, Buffer, Error,
    setTimeout, clearTimeout,
    location: {
      href: 'https://fantasy.espn.com/football/draft?leagueId=650239158&seasonId=2026&teamId=19&memberId={605B6653-A8B8-403F-85DA-E4618F649E74}',
      pathname: '/football/draft',
      origin: 'https://fantasy.espn.com',
    },
    document: stubDocument({ cookie: '' }),
    history: { pushState() {}, replaceState() {} },
    fetch: async (url) => {
      const href = String(url)
      if (href.includes('kona_player_info')) {
        return { ok: true, status: 200, json: async () => ({ players: [fatPlayer(1)] }) }
      }
      if (href.includes('mRoster')) {
        return { ok: false, status: 401, json: async () => ({ messages: ['You are not authorized to view this League.'] }) }
      }
      return {
        ok: true, status: 200,
        json: async () => ({
          settings: { leagueSubType: '5', scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] } },
          teams: [{ id: 19 }, { id: 2 }],
          draftDetail: { drafted: false, inProgress: false, picks: [] },
        }),
      }
    },
  }
  ctx.window = {
    postMessage: (msg) => { if (msg?.source === 'draft-assistant-espn-page') posted.push(msg) },
    addEventListener: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout,
  }
  ctx.window.window = ctx.window
  vm.createContext(ctx)
  vm.runInContext(src, ctx)
  await tick()
  check('does not treat mRoster 401 as a hard login failure', posted[0]?.error == null, posted[0]?.error)
  check('posts the cloned league id', posted[0]?.leagueId === '650239158')
  check('reads memberId as SWID when the cookie is missing', posted[0]?.swid === '{605B6653-A8B8-403F-85DA-E4618F649E74}')
  check('keeps the draft-room URL', /\/football\/draft/.test(posted[0]?.pageUrl || ''))
}

console.log('\npractice draft: mRoster failure falls back and tags isPractice')
{
  const posted = []
  const ctx = {
    console, URL, URLSearchParams, Date, JSON, Math, Buffer, Error,
    setTimeout, clearTimeout,
    location: { href: 'https://fantasy.espn.com/football/draft?leagueId=999&seasonId=2026', pathname: '/football/draft', origin: 'https://fantasy.espn.com' },
    document: stubDocument(),
    history: { pushState() {}, replaceState() {} },
    fetch: async (url) => {
      const href = String(url)
      if (href.includes('kona_player_info')) {
        return { ok: true, status: 200, json: async () => ({ players: [fatPlayer(1)] }) }
      }
      if (href.includes('mRoster')) {
        return { ok: false, status: 400, json: async () => ({}) }
      }
      return {
        ok: true, status: 200,
        json: async () => ({
          settings: { leagueSubType: 'CUSTOM_MOCK', scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] } },
          teams: [{ id: 1 }, { id: 2 }],
          draftDetail: { drafted: false, inProgress: true, picks: [{ overallPickNumber: 1, playerId: 7 }] },
        }),
      }
    },
  }
  ctx.window = {
    postMessage: (msg) => { if (msg?.source === 'draft-assistant-espn-page') posted.push(msg) },
    addEventListener: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout,
  }
  ctx.window.window = ctx.window
  vm.createContext(ctx)
  vm.runInContext(src, ctx)
  await tick()
  check('posts after roster fallback', posted.length === 1, `got ${posted.length}`)
  check('tags the clone as practice', posted[0]?.isPractice === true)
  check('keeps the live pick list', posted[0]?.league.draftDetail.picks.length === 1)
}

console.log('\npractice draft: lobby origin survives a league API failure')
{
  const posted = []
  const ctx = {
    console, URL, URLSearchParams, Date, JSON, Math, Buffer, Error,
    setTimeout, clearTimeout,
    location: { href: 'https://fantasy.espn.com/football/draft?leagueId=777&seasonId=2026', pathname: '/football/draft', origin: 'https://fantasy.espn.com' },
    document: stubDocument({ cookie: '', referrer: 'https://fantasy.espn.com/football/mockdraftlobby' }),
    history: { pushState() {}, replaceState() {} },
    fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  }
  ctx.window = {
    postMessage: (msg) => { if (msg?.source === 'draft-assistant-espn-page') posted.push(msg) },
    addEventListener: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout,
  }
  ctx.window.window = ctx.window
  vm.createContext(ctx)
  vm.runInContext(src, ctx)
  await tick()
  check('reports the failed clone as practice', posted[0]?.isPractice === true)
  check('keeps the failed clone id', posted[0]?.leagueId === '777')
}

console.log('\nESPN websocket: CLOCK posts remaining seconds')
{
  const picks = [{ overallPickNumber: 1, playerId: 7 }]
  const h = run({ picksByCall: [picks, picks, picks], withWebSocket: true })
  await tick()
  let now = Date.now()
  h.ctx.Date.now = () => now
  const socket = new h.ctx.window.WebSocket('wss://fantasydraft.espn.com/league/123')
  socket.emit('message', 'CLOCK 87\n')
  await tick()
  const clock = h.posted.at(-1)?.clock
  check('posts remaining seconds', clock?.remaining === 87, `got ${clock?.remaining}`)
  check('posts an endsAt so the app can tick locally', typeof clock?.endsAt === 'number' && clock.endsAt > now)
  const afterClock = h.posted.length
  now += 1000
  socket.emit('message', 'CLOCK 86\n')
  await tick()
  check('a one-second tick does not repost', h.posted.length === afterClock, `got ${h.posted.length}`)
  socket.emit('message', 'PAUSED\n')
  await tick()
  check('PAUSED freezes the remaining time', h.posted.at(-1)?.clock?.paused === true && h.posted.at(-1)?.clock?.remaining === 86)
}

console.log('\nESPN draft room: DOM clock is scraped')
{
  const clockNode = { textContent: '1:23' }
  const board = {
    textContent: 'On the Clock 1:23',
    querySelectorAll: (sel) => /clock/i.test(String(sel)) ? [clockNode] : [],
    querySelector: () => null,
  }
  const h = run({
    picksByCall: [[{ overallPickNumber: 1, playerId: 7 }]],
    document: stubDocument({
      querySelector: (sel) => String(sel).includes('draftContainer') ? board : null,
    }),
  })
  await tick()
  check('reads M:SS off the draft-room clock', h.posted[0]?.clock?.remaining === 83, `got ${h.posted[0]?.clock?.remaining}`)
}

console.log('\nRESEND_PLAYERS forces a full repost')
{
  const picks = [{ overallPickNumber: 1, playerId: 7 }]
  const { posted, messageListeners, ctx } = run({ picksByCall: [picks] })
  await tick()
  const before = posted.length
  for (const fn of messageListeners) {
    fn({ source: ctx.window, data: { source: 'draft-assistant-espn-bridge', type: 'RESEND_PLAYERS' } })
  }
  await tick()
  check('reposts after the request', posted.length === before + 1, `got ${posted.length}`)
  check('repost carries players again', Array.isArray(posted.at(-1)?.players))
}

console.log('\npick history backfills picks the API has not published')
{
  // ESPN's read model publishes only keepers while a draft is live: every
  // unmade row stays playerId -1. The draft room still renders the full board,
  // so the history scrape is what recovers picks made while the tab was
  // disconnected.
  const cell = (text) => ({ textContent: text })
  const row = (overall, playerId, teamLabel) => {
    const img = { getAttribute: (n) => (n === 'src' ? 'https://a.espncdn.com/i/headshots/nfl/players/full/' + playerId + '.png' : null) }
    const cells = [cell(String(overall)), cell('Someone'), cell(teamLabel)]
    return {
      querySelector: (sel) => (sel === 'img' ? img : null),
      querySelectorAll: (sel) => (sel === '[class*="cellContent"]' ? cells : []),
    }
  }
  const table = (round, rows) => ({
    querySelector: (sel) => (sel === '[class*="caption"]' ? { textContent: 'Round ' + round } : null),
    querySelectorAll: (sel) => (sel === '[class*="rowWrapper"]' ? rows : []),
  })
  const tables = [
    table(1, [row(1, 4430737, 'Alpha'), row(2, 3121422, 'Beta')]),
    table(2, [row(3, 4567750, 'Alpha'), row(4, 4870808, 'Beta')]),
  ]

  const posted = []
  const ctx = {
    console, URL, URLSearchParams, Date, JSON, Math, Buffer, Error, setTimeout, clearTimeout,
    location: { href: 'https://fantasy.espn.com/football/draft?leagueId=123&seasonId=2026', pathname: '/football/draft', origin: 'https://fantasy.espn.com' },
    document: stubDocument({
      querySelectorAll: (sel) => (sel === '.pick-history-table' ? tables : []),
    }),
    history: { pushState() {}, replaceState() {} },
    fetch: async (url) => {
      if (String(url).includes('kona_player_info')) {
        return { ok: true, status: 200, json: async () => ({ players: [fatPlayer(1)] }) }
      }
      return {
        ok: true, status: 200,
        json: async () => ({
          settings: { size: 2, scoringSettings: { scoringItems: [] }, draftSettings: { pickTimeout: 90 } },
          teams: [{ id: 21, name: 'Alpha' }, { id: 7, name: 'Beta' }],
          draftDetail: { drafted: false, inProgress: true, picks: [
            { overallPickNumber: 1, playerId: 4430737, teamId: 21, roundId: 1, roundPickNumber: 1, keeper: true },
            { overallPickNumber: 2, playerId: -1, teamId: 7, roundId: 1, roundPickNumber: 2 },
            { overallPickNumber: 3, playerId: -1, teamId: 21, roundId: 2, roundPickNumber: 1 },
            { overallPickNumber: 4, playerId: -1, teamId: 7, roundId: 2, roundPickNumber: 2 },
          ] },
        }),
      }
    },
  }
  ctx.window = {
    postMessage: (msg) => { if (msg?.source === 'draft-assistant-espn-page') posted.push(msg) },
    addEventListener: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout,
  }
  ctx.window.window = ctx.window
  vm.createContext(ctx)
  vm.runInContext(src, ctx)
  await tick()

  const picks = posted[0]?.league?.draftDetail?.picks ?? []
  const real = picks.filter((p) => Number(p.playerId) > 0)
  const byOverall = new Map(real.map((p) => [p.overallPickNumber, p]))
  check('every scraped pick reaches the snapshot', real.length === 4, 'got ' + real.length)
  check('no duplicate pick numbers', byOverall.size === real.length)
  check('backfilled pick keeps its own team', byOverall.get(3)?.teamId === 21, JSON.stringify(byOverall.get(3)))
  check('team is read from the row, not derived from the round', byOverall.get(4)?.teamId === 7, JSON.stringify(byOverall.get(4)))
  check('the published keeper is not duplicated', real.filter((p) => Number(p.playerId) === 4430737).length === 1)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
