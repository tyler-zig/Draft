/** Runs extension/background.js against stubbed Chrome APIs. */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const src = readFileSync(new URL('../background.js', import.meta.url), 'utf8')

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`) }
}

function makeCtx(tabs = []) {
  const session = new Map()
  const local = new Map()
  const sent = []
  const tabOps = []
  const listeners = []
  const ctx = {
    console,
    URL,
    setTimeout,
    chrome: {
      storage: {
        session: {
          get: async (keys) => {
            const list = Array.isArray(keys) ? keys : [keys]
            const out = {}
            for (const k of list) if (session.has(k)) out[k] = session.get(k)
            return out
          },
          set: async (obj) => {
            const bytes = Buffer.byteLength(JSON.stringify(obj))
            if (bytes > 10 * 1024 * 1024) throw new Error('QUOTA_BYTES quota exceeded')
            for (const [k, v] of Object.entries(obj)) session.set(k, v)
          },
        },
        // Survives a worker restart, unlike session -- which is the whole
        // reason the practice ignore list lives here.
        local: {
          get: async (keys) => {
            const list = Array.isArray(keys) ? keys : [keys]
            const out = {}
            for (const k of list) if (local.has(k)) out[k] = local.get(k)
            return out
          },
          set: async (obj) => {
            for (const [k, v] of Object.entries(obj)) local.set(k, v)
          },
        },
      },
      tabs: {
        query: async () => tabs,
        sendMessage: async (id, msg) => { sent.push({ id, msg }) },
        update: async (id, patch) => { tabOps.push({ op: 'update', id, patch }) },
        create: async (opts) => { tabOps.push({ op: 'create', opts }) },
        reload: async (id) => { tabOps.push({ op: 'reload', id }) },
      },
      windows: { update: async () => {} },
      alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
      runtime: {
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
        onMessage: { addListener: (fn) => listeners.push(fn) },
      },
    },
  }
  ctx.importScripts = (...files) => {
    for (const file of files) {
      vm.runInContext(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), ctx)
    }
  }
  vm.createContext(ctx)
  vm.runInContext(src, ctx)
  return { ctx, session, local, sent, tabOps, listeners }
}

const dispatch = (listeners, msg) =>
  new Promise((resolve) => {
    for (const fn of listeners) if (fn(msg, {}, resolve)) return
    resolve(undefined)
  })

const players = Array.from({ length: 2500 }, (_, i) => ({ player: { id: i, fullName: `P${i}` } }))
const league = { draftDetail: { picks: [{ overallPickNumber: 1, playerId: 7 }] } }

console.log('\nsnapshot merge')
{
  const appTab = { id: 1, url: 'http://localhost:5199/draft/espn/x' }
  const { session, sent, listeners } = makeCtx([appTab])

  // 1. First post carries the full player list.
  const first = await dispatch(listeners, {
    type: 'ESPN_SNAPSHOT',
    payload: { leagueId: '1', league, players },
  })
  check('first post stores players', session.get('espnSnapshot')?.players.length === 2500)
  check('first post needs no resend', first.needPlayers === false)

  // 2. A pick lands: injector omits `players` entirely.
  await dispatch(listeners, {
    type: 'ESPN_SNAPSHOT',
    payload: { leagueId: '1', league: { draftDetail: { picks: [1, 2] } } },
  })
  const merged = sent.at(-1).msg.payload
  check('players rehydrated for the app', merged.players.length === 2500)
  check('new picks passed through', merged.league.draftDetail.picks.length === 2)
  check('stored snapshot keeps players', session.get('espnSnapshot').players.length === 2500)
}

console.log('\nworker restart (session storage cleared)')
{
  const { listeners } = makeCtx([{ id: 1, url: 'http://localhost:5173/' }])
  const res = await dispatch(listeners, {
    type: 'ESPN_SNAPSHOT',
    payload: { leagueId: '1', league },
  })
  check('asks the page to resend players', res.needPlayers === true)
}

console.log('\nquota failure is survivable')
{
  const fat = Array.from({ length: 2500 }, (_, i) => ({ player: { id: i, blob: 'x'.repeat(5000) } }))
  const { sent, listeners } = makeCtx([{ id: 1, url: 'http://localhost:5173/' }])
  const res = await dispatch(listeners, {
    type: 'ESPN_SNAPSHOT',
    payload: { leagueId: '1', league, players: fat },
  })
  check('does not reject on quota error', res.ok === true)
  check('still broadcasts to the app', sent.at(-1)?.msg.payload.players.length === 2500)
}

console.log('\napp tab matching (port must not matter)')
{
  const cases = [
    ['http://localhost:5173/', true],
    ['http://localhost:5174/draft/espn/1', true],
    ['http://localhost:5199/', true],
    ['http://127.0.0.1:4173/preview', true],
    ['http://localhost/', true],
    ['https://draft-bice-omega.vercel.app/', true],
    ['https://draft-bice-omega.vercel.app/draft/espn/1', true],
    ['https://unrelated-project.vercel.app/', false],
    ['https://fantasy.espn.com/football/draft', false],
    ['https://localhost.evil.com/', false],
    ['http://notlocalhost/', false],
    ['http://draft-bice-omega.vercel.app/', false],
    ['https://example.com/', false],
  ]
  const tabs = cases.map(([url], i) => ({ id: i + 1, url }))
  const { sent, listeners } = makeCtx(tabs)
  await dispatch(listeners, { type: 'ESPN_SNAPSHOT', payload: { leagueId: '1', league, players: [] } })
  const reached = new Set(sent.map((s) => s.id))
  for (const [url, expected] of cases) {
    const id = tabs.find((t) => t.url === url).id
    check(`${expected ? 'reaches' : 'skips  '} ${url}`, reached.has(id) === expected)
  }
}

console.log('\nremembered custom app origin')
{
  const appTab = { id: 9, url: 'https://draft.example.com/' }
  const { local, sent, listeners } = makeCtx([appTab])
  await dispatch(listeners, { type: 'REGISTER_APP_ORIGIN', origin: 'https://draft.example.com' })
  check('stores the hosted origin', local.get('appOrigins')?.[0] === 'https://draft.example.com')
  await dispatch(listeners, { type: 'ESPN_SNAPSHOT', payload: { leagueId: '1', league, players: [] } })
  check('reaches a remembered custom domain', sent.some((row) => row.id === 9))
}

console.log('\nstale app relay is restored after an extension reload')
{
  const appTab = { id: 1, url: 'http://localhost:5173/draft/espn/x' }
  const { ctx, sent, listeners } = makeCtx([appTab])
  let attempts = 0
  const injected = []
  ctx.chrome.tabs.sendMessage = async (id, msg) => {
    attempts += 1
    if (attempts === 1) throw new Error('Receiving end does not exist')
    sent.push({ id, msg })
  }
  ctx.chrome.scripting = {
    executeScript: async (details) => { injected.push(details) },
  }
  await dispatch(listeners, { type: 'ESPN_SNAPSHOT', payload: { leagueId: '1', league, players: [] } })
  check('injects app-content.js after delivery fails', injected[0]?.files?.[0] === 'app-content.js')
  check('retries the live snapshot', attempts === 2 && sent.at(-1)?.msg?.type === 'ESPN_SNAPSHOT')
}

console.log('\nsite snapshot persist')
{
  const appTab = { id: 1, url: 'http://localhost:5173/' }
  const { session, sent, listeners } = makeCtx([appTab])
  const payload = { provider: 'yahoo', leagueId: '99', league: { name: 'Gridiron' } }
  const saved = await dispatch(listeners, { type: 'SITE_SNAPSHOT', provider: 'yahoo', payload })
  check('stores a Yahoo snapshot', session.get('yahooSnapshot')?.leagueId === '99')
  check('acks the Yahoo save', saved?.ok === true)
  check('broadcasts SITE_SNAPSHOT to the app', sent.at(-1)?.msg.type === 'SITE_SNAPSHOT' && sent.at(-1)?.msg.provider === 'yahoo')
  const got = await dispatch(listeners, { type: 'GET_SITE_SNAPSHOT', provider: 'yahoo' })
  check('returns the stored Yahoo snapshot', got?.leagueId === '99')
  await dispatch(listeners, {
    type: 'SITE_SNAPSHOT',
    provider: 'nfl',
    payload: { provider: 'nfl', leagueId: '77', league: { name: 'Sunday' } },
  })
  const nfl = await dispatch(listeners, { type: 'GET_SITE_SNAPSHOT', provider: 'nfl' })
  check('keeps NFL.com on a separate key', nfl?.leagueId === '77' && session.get('yahooSnapshot')?.leagueId === '99')
}

console.log('\ndead practice room falls back to the real league')
{
  const appTab = { id: 1, url: 'http://localhost:5173/' }
  const { session, sent, listeners } = makeCtx([appTab])
  await dispatch(listeners, {
    type: 'ESPN_SNAPSHOT',
    payload: { leagueId: '123', league: { settings: { name: 'Home League' } }, players: [] },
  })
  await dispatch(listeners, {
    type: 'ESPN_SNAPSHOT',
    payload: { leagueId: '650239158', league: { settings: { leagueSubType: '5' } } },
  })
  check('keeps the real league as home', session.get('espnHomeSnapshot')?.leagueId === '123')
  await dispatch(listeners, {
    type: 'ESPN_SNAPSHOT',
    payload: { leagueId: '650239158', error: 'ESPN needs you logged in on this tab.', pageUrl: 'https://fantasy.espn.com/football/draft?leagueId=650239158' },
  })
  check('restores the real league after the clone dies', session.get('espnSnapshot')?.leagueId === '123')
  check('broadcasts the real league', sent.at(-1)?.msg.payload.leagueId === '123')
}

console.log('\nexit practice restores home and suppresses the open clone')
{
  const appTab = { id: 1, url: 'http://localhost:5173/draft/espn/x' }
  const { session, local, sent, listeners } = makeCtx([appTab])
  await dispatch(listeners, {
    type: 'ESPN_SNAPSHOT',
    payload: { leagueId: '123', league: { settings: { name: 'Home League' } }, players: [] },
  })
  await dispatch(listeners, {
    type: 'ESPN_SNAPSHOT',
    payload: { leagueId: '999', isPractice: true, league: { settings: { leagueSubType: 'CUSTOM_MOCK' } } },
  })
  const exited = await dispatch(listeners, { type: 'EXIT_ESPN_PRACTICE' })
  check('exit acknowledges the restored league', exited?.ok === true && exited.restoredLeagueId === '123')
  check('restores the saved real snapshot', session.get('espnSnapshot')?.leagueId === '123')
  check('remembers the ignored clone', local.get('espnIgnoredPracticeLeagueIds')?.includes('999') === true)
  check('broadcasts an explicit practice exit', sent.at(-1)?.msg?.type === 'ESPN_PRACTICE_EXITED')
  const before = sent.length
  const ignored = await dispatch(listeners, {
    type: 'ESPN_SNAPSHOT',
    payload: { leagueId: '999', isPractice: true, league: { settings: { leagueSubType: 'CUSTOM_MOCK' } } },
  })
  check('ignores more updates from the open practice tab', ignored?.ignored === true && sent.length === before)
}

console.log('\nan exited practice tab cannot pull the app back in')
{
  const appTab = { id: 1, url: 'http://localhost:5173/' }
  const home = { leagueId: '123', league: { settings: { name: 'Home League' } }, players: [] }
  const clone = { leagueId: '999', isPractice: true, league: { settings: { leagueSubType: 'CUSTOM_MOCK' } } }

  const first = makeCtx([appTab])
  await dispatch(first.listeners, { type: 'ESPN_SNAPSHOT', payload: home })
  await dispatch(first.listeners, { type: 'ESPN_SNAPSHOT', payload: clone })
  await dispatch(first.listeners, { type: 'EXIT_ESPN_PRACTICE' })

  // A real league posting again must not un-ignore the clone: that used to
  // null the flag, and the still-open practice tab walked the app straight
  // back into the room it had just left.
  await dispatch(first.listeners, { type: 'ESPN_SNAPSHOT', payload: home })
  const after = await dispatch(first.listeners, { type: 'ESPN_SNAPSHOT', payload: clone })
  check('a real league snapshot does not clear the ignore', after?.ignored === true)
  check('the app is left on the real league', first.session.get('espnSnapshot')?.leagueId === '123')

  // The worker unloads after ~30s idle and session storage goes with it,
  // so the ignore list has to come back from local storage.
  const restarted = makeCtx([appTab])
  for (const [k, v] of first.local) restarted.local.set(k, v)
  const survived = await dispatch(restarted.listeners, { type: 'ESPN_SNAPSHOT', payload: clone })
  check('the ignore survives a worker restart', survived?.ignored === true)

  // Leaving a second clone must not forget the first.
  const other = { leagueId: '777', isPractice: true, league: { settings: { leagueSubType: 'CUSTOM_MOCK' } } }
  await dispatch(first.listeners, { type: 'ESPN_SNAPSHOT', payload: other })
  await dispatch(first.listeners, { type: 'EXIT_ESPN_PRACTICE' })
  const stillIgnored = await dispatch(first.listeners, { type: 'ESPN_SNAPSHOT', payload: clone })
  check('exiting a second clone keeps the first ignored', stillIgnored?.ignored === true)
  check('and ignores the second', (await dispatch(first.listeners, { type: 'ESPN_SNAPSHOT', payload: other }))?.ignored === true)

  // Deliberately reopening the lobby is the one thing that clears it.
  await dispatch(first.listeners, { type: 'OPEN_ESPN', url: 'https://fantasy.espn.com/football/mockdraftlobby' })
  const reentered = await dispatch(first.listeners, { type: 'ESPN_SNAPSHOT', payload: clone })
  check('opening the mock lobby lets practice back in', reentered?.ignored !== true)
}

console.log('\nname-only practice clone cannot restore itself')
{
  const clone = {
    leagueId: '888',
    league: { settings: { name: 'Practice Draft for The Best League' } },
    players: [],
  }
  const { session, local, listeners } = makeCtx([{ id: 1, url: 'http://localhost:5173/' }])
  // Reproduce storage written by an older extension that did not recognize
  // ESPN's name-only practice marker.
  session.set('espnSnapshot', clone)
  session.set('espnHomeSnapshot', clone)
  const exited = await dispatch(listeners, { type: 'EXIT_ESPN_PRACTICE' })
  check('recognizes Practice Draft for ... by name', local.get('espnIgnoredPracticeLeagueIds')?.includes('888') === true)
  check('clears instead of restoring the same clone', exited?.restoredLeagueId === null && session.get('espnSnapshot') === null)
}

console.log('\nOpen ESPN Fantasy skips dead draft tabs')
{
  const tabs = [
    { id: 2, url: 'https://fantasy.espn.com/football/draft?leagueId=650239158' },
  ]
  const { tabOps, listeners } = makeCtx(tabs)
  await dispatch(listeners, { type: 'OPEN_ESPN' })
  check('opens a new ESPN home tab', tabOps.some((row) => row.op === 'create' && row.opts.url === 'https://fantasy.espn.com/football/'))
  check('does not reload the practice draft tab', !tabOps.some((row) => row.op === 'reload' || (row.op === 'update' && row.id === 2)))
}

console.log('\nESPN suggestions broadcast')
{
  const tabs = [
    { id: 1, url: 'http://localhost:5173/draft/espn/x' },
    { id: 2, url: 'https://fantasy.espn.com/football/draft?leagueId=10' },
    { id: 3, url: 'https://fantasy.espn.com/football/team?leagueId=10' },
    { id: 4, url: 'https://www.espn.com/fantasy/football/' },
  ]
  const { session, sent, listeners } = makeCtx(tabs)
  const payload = { leagueId: '10', pickStamp: '1:7:1', recs: [{ id: '7', name: 'Star' }] }
  const saved = await dispatch(listeners, { type: 'PUBLISH_ESPN_SUGGESTIONS', payload })
  check('stores published suggestions', session.get('espnSuggestions')?.leagueId === '10')
  check('acks the publish', saved?.ok === true)
  const reached = new Set(sent.filter((row) => row.msg.type === 'ESPN_SUGGESTIONS').map((row) => row.id))
  check('reaches the ESPN draft tab', reached.has(2))
  check('skips the app tab', !reached.has(1))
  check('skips the ESPN team page', !reached.has(3))
  const got = await dispatch(listeners, { type: 'GET_ESPN_SUGGESTIONS' })
  check('returns stored suggestions', got?.pickStamp === '1:7:1')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
