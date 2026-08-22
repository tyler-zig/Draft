import { beforeEach, describe, expect, it } from 'vitest'
import { CURRENT_SEASON, type Player } from './types'
import {
  DEMO_DRAFT_ID,
  DEMO_MOCK_DEFAULTS,
  DEMO_USER_ID,
  demoPick,
  demoProvider,
  demoTick,
  initDemoDraft,
} from './demoProvider'

const player = (overrides: Partial<Player>): Player => ({
  id: 'p', firstName: 'First', lastName: 'Last', fullName: 'First Last', position: 'RB',
  team: 'CHI', searchRank: 1, injuryStatus: null, number: null, yearsExp: null, bye: null, ...overrides,
})

/**
 * Uniforms for two consecutive candidates: the first draws (0.5, 0.5) ->
 * -sqrt(2 ln 2) noise, the second draws (0.5, 0) -> +sqrt(2 ln 2) noise. A
 * fresh closure resets the sequence, so pass `flipRng()` per mock.
 */
function flipRng() {
  const seq = [0.5, 0.5, 0.5, 0]
  let i = 0
  return () => seq[i++ % seq.length]!
}

beforeEach(() => { initDemoDraft() })

// The provider contract takes ids these days; the demo ids are fixed, so pin
// them once here rather than at every call site.
const draft = () => demoProvider.getDraft(DEMO_DRAFT_ID, DEMO_USER_ID)
const picks = () => demoProvider.getPicks(DEMO_DRAFT_ID)
const leagues = () => demoProvider.getLeagues(DEMO_USER_ID, String(CURRENT_SEASON))

describe('demo mock engine', () => {
  it('defaults to a 12-team, 15-round ppr mock from slot 5', async () => {
    const session = await draft()
    expect(session).toMatchObject({
      teams: DEMO_MOCK_DEFAULTS.teams,
      rounds: DEMO_MOCK_DEFAULTS.rounds,
      yourSlot: DEMO_MOCK_DEFAULTS.yourSlot,
      scoringType: DEMO_MOCK_DEFAULTS.scoringType,
      status: 'drafting',
    })
  })

  it('rebuilds the session from mock options and reports them in the league summary', async () => {
    initDemoDraft({ teams: 8, rounds: 10, yourSlot: 3, scoringType: 'half_ppr' })
    const session = await draft()
    expect(session).toMatchObject({ teams: 8, rounds: 10, yourSlot: 3, scoringType: 'half_ppr' })
    expect(session.order).toHaveLength(8)
    expect(session.order.find((entry) => entry.slot === 3)?.isYou).toBe(true)
    expect(await leagues()).toMatchObject({ leagues: [{ teamCount: 8, scoringType: 'half_ppr' }] })
  })

  it('clamps impossible configs instead of crashing', async () => {
    initDemoDraft({ teams: 4, rounds: 99, reach: 7 })
    const session = await draft()
    expect(session.teams).toBe(4)
    expect(session.rounds).toBe(30)
    // A 5-slot default cannot exist in a 4-team room.
    expect(session.yourSlot).toBe(4)
  })

  it('gates manual picks on the configured slot', async () => {
    const a = player({ id: 'a' }), b = player({ id: 'b', searchRank: 2 }), c = player({ id: 'c', searchRank: 3 })
    initDemoDraft({ teams: 8, rounds: 10, yourSlot: 3, rng: () => 0.5 })
    demoPick('a', [a, b, c])
    expect(await picks()).toEqual([])
    demoTick([a, b, c])
    demoTick([a, b, c])
    demoPick('c', [a, b, c])
    const made = await picks()
    expect(made.map((pick) => pick.playerId)).toEqual(['a', 'b', 'c'])
    expect(made[2]?.draftSlot).toBe(3)
  })

  it('lets the reach knob decide between noise and the board', async () => {
    // Both carry the same spread; the rng gives the first candidate negative
    // noise and the second positive noise. A reachy room (scale 2.5) lets that
    // noise override the 5-pick ADP gap; a disciplined one (scale 1.0) does not.
    const safe = player({ id: 'safe', adp: 10, searchRank: 10, rankStdDev: 1 })
    const wild = player({ id: 'wild', adp: 5, searchRank: 5, rankStdDev: 1 })
    initDemoDraft({ reach: 0, rng: flipRng() })
    demoTick([safe, wild])
    expect((await picks())[0]?.playerId).toBe('safe')
    initDemoDraft({ reach: 1, rng: flipRng() })
    demoTick([safe, wild])
    expect((await picks())[0]?.playerId).toBe('wild')
  })

  it('auto-drafts your slot hands-free and stalls without it', async () => {
    const a = player({ id: 'a' }), b = player({ id: 'b', searchRank: 2 })
    initDemoDraft({ teams: 2, rounds: 2, yourSlot: 2, autoPickYourPicks: true, rng: () => 0.5 })
    demoTick([a, b])
    demoTick([a, b])
    expect((await picks()).map((pick) => pick.playerId)).toEqual(['a', 'b'])

    initDemoDraft({ teams: 2, rounds: 2, yourSlot: 2, autoPickYourPicks: false, rng: () => 0.5 })
    demoTick([a, b])
    demoTick([a, b])
    demoTick([a, b])
    expect((await picks()).map((pick) => pick.playerId)).toEqual(['a'])
    demoPick('b', [a, b])
    expect((await picks()).map((pick) => pick.playerId)).toEqual(['a', 'b'])
  })

  it('never drafts a kept player, and manual picks refuse them too', async () => {
    const a = player({ id: 'a' }), b = player({ id: 'b', searchRank: 2 })
    initDemoDraft({ teams: 2, rounds: 2, yourSlot: 2, autoPickYourPicks: true, rng: () => 0.5 })
    demoTick([a, b], ['a'])
    expect((await picks())[0]?.playerId).toBe('b')
    demoPick('a', [a, b], ['a'])
    expect((await picks()).map((pick) => pick.playerId)).toEqual(['b'])
  })

  it('defers kickers and defenses to the last round and completes the mock', async () => {
    const rb = player({ id: 'rb', searchRank: 2 })
    const wr = player({ id: 'wr', position: 'WR', searchRank: 3 })
    const k = player({ id: 'k', position: 'K', searchRank: 1 })
    const def = player({ id: 'def', position: 'DEF', searchRank: 4 })
    initDemoDraft({ teams: 2, rounds: 2, yourSlot: 2, autoPickYourPicks: true, rng: () => 0.5 })
    demoTick([rb, wr, k, def])
    demoTick([rb, wr, k, def])
    demoTick([rb, wr, k, def])
    demoTick([rb, wr, k, def])
    // Round 1 never reaches for the kicker even though he ranks first.
    expect((await picks()).map((pick) => pick.playerId)).toEqual(['rb', 'wr', 'k', 'def'])
    expect((await draft()).status).toBe('complete')
  })
})
