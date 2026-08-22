/** Runs extension/espn-suggest.js and espn-overlay.js against stubbed pages. */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// The scoring lives in the shared core bundle now, so load it into the same
// context the way the manifest loads it into the page: core first, then the
// adapter that reads it off the global.
const coreSrc = readFileSync(new URL('../core.bundle.js', import.meta.url), 'utf8')
const suggestSrc = readFileSync(new URL('../espn-suggest.js', import.meta.url), 'utf8')
const suggestCtx = { module: { exports: {} }, console }
suggestCtx.globalThis = suggestCtx
vm.createContext(suggestCtx)
vm.runInContext(coreSrc, suggestCtx)
vm.runInContext(suggestSrc, suggestCtx)
const suggest = suggestCtx.module.exports

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`) }
}

const POS = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DEF: 16 }

function player(id, position, rank, name, extra = {}) {
  return {
    player: {
      id,
      defaultPositionId: POS[position],
      firstName: name.split(' ')[0],
      lastName: name.split(' ').slice(1).join(' '),
      fullName: name,
      proTeamId: 1,
      draftRanksByRankType: { PPR: { rank } },
      ...(extra.adp != null ? { ownership: { averageDraftPosition: extra.adp } } : {}),
    },
  }
}

function snapshot(overrides = {}) {
  return {
    leagueId: '10',
    season: '2026',
    teamId: '1',
    league: {
      settings: {
        size: 2,
        rosterSettings: {
          lineupSlotCounts: { 0: 1, 2: 1, 4: 2, 6: 1, 16: 1, 17: 1, 20: 6 },
        },
        draftSettings: { type: 'SNAKE' },
      },
      teams: [
        { id: 1, draftPosition: 1 },
        { id: 2, draftPosition: 2 },
      ],
      draftDetail: {
        inProgress: true,
        picks: [
          { playerId: 1, teamId: 1, roundId: 1, roundPickNumber: 1, overallPickNumber: 1 },
        ],
      },
    },
    players: [
      player(1, 'RB', 1, 'Taken Back'),
      player(2, 'RB', 2, 'Next Back'),
      player(3, 'WR', 3, 'Wide One'),
      player(4, 'QB', 40, 'Late Passer'),
      player(5, 'TE', 20, 'Tight One'),
      player(6, 'WR', 4, 'Wide Two'),
      player(7, 'WR', 5, 'Wide Three'),
    ],
    ...overrides,
  }
}

console.log('\nfromSnapshot')
{
  const recs = suggest.fromSnapshot(snapshot())
  check('returns a payload', Boolean(recs?.leagueId === '10'))
  check('excludes drafted players', recs.recs.every((row) => row.id !== '1'))
  check('boosts an empty starter over leftover RB', recs.recs.some((row) => row.id === '4' && row.reason === 'Fill QB'))
  check('does not list only one position', new Set(recs.recs.map((row) => row.position)).size > 1)
  check('caps at five', recs.recs.length <= 5)
  check('stamps the last pick', recs.pickStamp === '1:1:1:1:1')
  check('is not on the clock after pick 1 at slot 1', recs.youAreOnClock === false && recs.until === 2, `until=${recs.until}`)
  check('sits Taken Back in the RB slot', recs.roster?.some((slot) => slot.key === 'RB' && slot.name === 'Taken Back'))
  check('leaves QB empty after one RB pick', recs.roster?.some((slot) => slot.key === 'QB' && !slot.name))
  check('counts the drafted RB against the starter slots', recs.needs?.some((need) => need.position === 'RB' && need.filled === 1 && need.total === 1))
  check('puts the first pick on the board', recs.board?.cells?.some((cell) => cell.pickNo === 1 && cell.last === 'Back' && cell.yours))
  check('marks the pick on the clock', recs.board?.cells?.some((cell) => cell.current && cell.pickNo === 2))
}

{
  const recs = suggest.fromSnapshot(snapshot({ teamId: '2' }))
  check('marks the other seat on the clock', recs.youAreOnClock === true && recs.until === 0)
}

{
  check('needs a league', suggest.fromSnapshot({ leagueId: '10' }) === null)
  check('pickStamp is empty without picks', suggest.pickStamp({}) === '0::::')
}

{
  const noOverall = snapshot()
  noOverall.league.draftDetail.picks = [
    { playerId: 1, teamId: 1, roundId: 1, roundPickNumber: 1 },
  ]
  const recs = suggest.fromSnapshot(noOverall)
  check('accepts a live pick without overallPickNumber', recs.recs.every((row) => row.id !== '1'))
}

{
  const keeperOnly = snapshot({ teamId: '2' })
  keeperOnly.league.draftDetail.picks = [
    { playerId: 1, teamId: 2, roundId: 5, roundPickNumber: 2, overallPickNumber: 10, reservedForKeeper: true },
  ]
  const recs = suggest.fromSnapshot(keeperOnly)
  check('one keeper does not move team 2 into draft slot 1', recs.youAreOnClock === false && recs.until === 1, `until=${recs.until}`)
}

console.log('\noverlay path')
console.log('\nvaluations published by the app')
{
  // ESPN's editorial rank likes the WR; the app's projections say the QB is
  // worth far more. Only the app can know that, so it has to arrive here.
  const table = {
    leagueId: '10',
    season: '2026',
    updatedAt: Date.now(),
    players: { 4: { vorp: 140 }, 2: { vorp: 1 }, 3: { vorp: 1 }, 5: { vorp: 1 }, 6: { vorp: 1 }, 7: { vorp: 1 } },
  }
  const withValues = suggest.fromSnapshot(snapshot(), table)
  const without = suggest.fromSnapshot(snapshot(), null)
  check('app valuations reorder the board', withValues.recs[0]?.id === '4', `got ${withValues.recs[0]?.id}`)
  check('without them ESPN rank leads', without.recs[0]?.id !== '4', `got ${without.recs[0]?.id}`)
  check('reports that it used them', withValues.valued === true)
  check('reports when it did not', without.valued === false)
}

{
  const otherLeague = {
    leagueId: '999', season: '2026', updatedAt: Date.now(), players: { 4: { vorp: 140 } },
  }
  const recs = suggest.fromSnapshot(snapshot(), otherLeague)
  check('ignores another league\'s table', recs.valued === false && recs.recs[0]?.id !== '4')
}

console.log('\nsuggestion market line')
{
  const table = {
    leagueId: '10',
    season: '2026',
    updatedAt: Date.now(),
    players: {
      2: { liveAdp: 18.4, adp: 24, vorp: 12 },
      3: { adp: 31.2, vorp: 4 },
      4: { vorp: 2 },
    },
  }
  const recs = suggest.fromSnapshot(snapshot({
    players: [
      player(1, 'RB', 1, 'Taken Back'),
      player(2, 'RB', 2, 'Next Back'),
      player(3, 'WR', 3, 'Wide One'),
      player(4, 'QB', 40, 'Late Passer'),
    ],
  }), table).recs
  const live = recs.find((row) => row.id === '2')
  const season = recs.find((row) => row.id === '3')
  const vorpOnly = recs.find((row) => row.id === '4')
  check('prefers live ADP when the hourly board has him', live?.marketSource === 'live ADP' && live?.marketValue === 18.4, `got ${live?.marketSource} ${live?.marketValue}`)
  check('scores live ADP against the pick on the clock', live?.vsPick === -16, `got ${live?.vsPick}`)
  check('falls back to season ADP', season?.marketSource === 'ADP' && season?.marketValue === 31.2, `got ${season?.marketSource} ${season?.marketValue}`)
  check('keeps VORP when neither board has him', vorpOnly?.vorp === 2 && vorpOnly?.marketSource == null, `got source=${vorpOnly?.marketSource} vorp=${vorpOnly?.vorp}`)
}

{
  const recs = suggest.fromSnapshot(snapshot({
    players: [
      player(1, 'RB', 1, 'Taken Back'),
      player(2, 'RB', 2, 'Next Back', { adp: 16.7 }),
      player(3, 'WR', 3, 'Wide One'),
    ],
  })).recs
  const row = recs.find((item) => item.id === '2')
  check('uses ESPN ADP when the app has not published live', row?.marketSource === 'ADP' && row?.marketValue === 16.7, `got ${row?.marketSource} ${row?.marketValue}`)
}

{
  const partial = {
    leagueId: '10', season: '2026', updatedAt: Date.now(), players: { 4: { vorp: 140 } },
  }
  const recs = suggest.fromSnapshot(snapshot(), partial)
  // Players the table skips still have to appear, scored on ESPN rank alone.
  check('keeps uncovered players on the board', recs.recs.length > 1)
}

console.log('\nkeeper board: rounds that do not snake')
{
  // The real 12-team ESPN practice draft: keeper rounds 1-3 and round 4 run in
  // straight draft order, and the board only reverses from round 5 on.
  const ORDER = [21, 23, 12, 24, 5, 15, 16, 1, 19, 20, 25, 7]
  const FORWARD = new Set([1, 2, 3, 4, 6, 8, 10, 12, 14])
  const YOU = 19
  const picks = []
  for (let round = 1; round <= 15; round += 1) {
    const order = FORWARD.has(round) ? ORDER : [...ORDER].reverse()
    order.forEach((teamId, index) => {
      const keeper = teamId === YOU && round <= 3
      picks.push({
        overallPickNumber: (round - 1) * 12 + index + 1,
        roundId: round,
        roundPickNumber: index + 1,
        teamId,
        playerId: keeper ? 4426502 + round : -1,
        keeper: keeper || undefined,
      })
    })
  }
  const board = {
    leagueId: '1882426813',
    season: '2026',
    teamId: String(YOU),
    league: {
      settings: {
        size: 12,
        rosterSettings: { lineupSlotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 16: 1, 17: 1, 20: 7 } },
        draftSettings: { type: 'SNAKE', keeperCount: 3, pickOrder: ORDER },
      },
      teams: ORDER.map((id) => ({ id })),
      draftDetail: { picks },
    },
    players: [],
  }
  const payload = suggest.fromSnapshot(board)
  // Slot 9 owns 9, 21, 33 (all kept), then 45. Snake parity would say 16.
  check('counts the wait to the real next pick', payload.until === 41, `got ${payload.until}`)
  check('is not on the clock during round 1', payload.youAreOnClock === false)
  check('starts the board at pick 1', payload.currentPickNo === 1, `got ${payload.currentPickNo}`)
}

{
  const overlaySrc = readFileSync(new URL('../espn-overlay.js', import.meta.url), 'utf8')
  const ctx = {
    location: { pathname: '/football/team' },
    document: { createElement() { return {} }, documentElement: { appendChild() {} } },
    window: { addEventListener() {} },
    HTMLInputElement: function HTMLInputElement() {},
    HTMLTextAreaElement: function HTMLTextAreaElement() {},
    Event: function Event() {},
  }
  ctx.globalThis = ctx
  vm.createContext(ctx)
  vm.runInContext(overlaySrc, ctx)
  check('treats /football/draft as a draft room', ctx.DraftAssistantOverlay.isDraftPath('/football/draft') === true)
  check('treats /draft as a draft room', ctx.DraftAssistantOverlay.isDraftPath('/draft') === true)
  check('skips the team page', ctx.DraftAssistantOverlay.isDraftPath('/football/team') === false)
  check('ships roster and board tabs', overlaySrc.includes("['picks', 'roster', 'board']"))
}

console.log('\nopenPlayerCard') 
{
  // A stand-in for ESPN's draft-room player list: a headshot URL carrying the
  // player id, a name element, and a Draft button that must never be clicked.
  function buildDom({ nameOpensCard = true, headshotOpensCard = false } = {}) {
    const clicked = []
    let cardIsOpen = false
    const box = () => ({ width: 120, height: 24 })
    const draftBtn = {
      tagName: 'BUTTON', className: 'draft-button', textContent: 'Draft',
      getAttribute: () => null, getBoundingClientRect: box,
      click() { clicked.push('DRAFT-BUTTON'); },
    }
    const nameEl = {
      tagName: 'SPAN', className: 'jsx-1 playerinfo__playername', textContent: 'Jahmyr Gibbs',
      getAttribute: () => null, getBoundingClientRect: box,
      click() { clicked.push('name'); if (nameOpensCard) cardIsOpen = true },
    }
    const headshot = {
      tagName: 'IMG', className: 'jsx-2 headshot',
      attrs: { src: 'https://a.espncdn.com/i/headshots/nfl/players/full/4426502.png' },
      getAttribute(n) { return this.attrs[n] ?? null }, getBoundingClientRect: box,
      click() { clicked.push('headshot'); if (headshotOpensCard) cardIsOpen = true },
    }
    const row = {
      tagName: 'TR', className: 'players-table__row', textContent: 'Jahmyr Gibbs Draft',
      getAttribute: () => null, getBoundingClientRect: box, click() { clicked.push('row') },
      querySelector(sel) {
        if (/playername|player-name/.test(sel)) return nameEl
        if (/headshot|img/.test(sel)) return headshot
        if (/draft|queue/.test(sel)) return draftBtn
        return null
      },
    }
    for (const el of [nameEl, headshot, draftBtn]) {
      el.closest = (sel) => (/button/.test(sel) ? (el === draftBtn ? draftBtn : null) : row)
      el.querySelector = row.querySelector
    }
    const document = {
      querySelector: (sel) => (/player-card-modal|lightbox__overlay/.test(sel) && cardIsOpen ? {} : null),
      querySelectorAll: (sel) => {
        if (/img\[src/.test(sel)) return [headshot]
        if (/data-player-id|href/.test(sel)) return []
        if (/playername|player-name/.test(sel)) return [nameEl]
        if (/input|textarea/.test(sel)) return []
        return []
      },
      createElement: () => ({}),
      documentElement: { appendChild() {} },
    }
    return { document, clicked, isOpen: () => cardIsOpen }
  }

  function load(dom) {
    const overlaySrc = readFileSync(new URL('../espn-overlay.js', import.meta.url), 'utf8')
    const ctx = {
      location: { pathname: '/football/draft' },
      document: dom.document,
      window: { addEventListener() {} },
      setTimeout,
      HTMLInputElement: function HTMLInputElement() {},
      HTMLTextAreaElement: function HTMLTextAreaElement() {},
      Event: function Event() {},
    }
    ctx.globalThis = ctx
    vm.createContext(ctx)
    vm.runInContext(overlaySrc, ctx)
    return ctx.DraftAssistantOverlay
  }

  {
    const dom = buildDom()
    const opened = await load(dom).openPlayerCard('4426502', 'Jahmyr Gibbs')
    check('opens the card for a matched player', opened === true)
    check('clicks the name, not the Draft button', dom.clicked[0] === 'name')
    check('never touches a Draft control', !dom.clicked.includes('DRAFT-BUTTON'))
  }

  {
    // Name click does nothing; it must fall through to the headshot and verify.
    const dom = buildDom({ nameOpensCard: false, headshotOpensCard: true })
    const opened = await load(dom).openPlayerCard('4426502', 'Jahmyr Gibbs')
    check('falls through to another target when the card does not appear', opened === true)
    check('still avoided the Draft button', !dom.clicked.includes('DRAFT-BUTTON'))
  }

  {
    const dom = buildDom({ nameOpensCard: false })
    const opened = await load(dom).openPlayerCard('9999999', 'Nobody Here')
    check('reports failure rather than clicking blindly', opened === false)
    check('left the Draft button alone on failure', !dom.clicked.includes('DRAFT-BUTTON'))
  }
}

console.log('\nbundle freshness')
{
  // core.bundle.js is generated from src/. A stale one is the exact failure
  // this whole unification removes -- logic fixed in src that never reaches
  // the overlay -- so rebuild and compare rather than trusting the checkout.
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'da-bundle-'))
  const out = join(dir, 'core.bundle.js')
  const root = new URL('../../', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '')
  try {
    execFileSync('npx', [
      'esbuild', 'src/extension/core.ts', '--bundle', '--format=iife',
      '--global-name=DraftAssistantCore', '--target=chrome110',
      `--outfile=${out}`, '--log-level=error',
    ], { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' })
    const fresh = readFileSync(out, 'utf8')
    check('extension/core.bundle.js matches src/', fresh === coreSrc,
      'run: npm run build:extension')
  } catch (error) {
    check('could rebuild the bundle to compare', false, String(error).slice(0, 200))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
