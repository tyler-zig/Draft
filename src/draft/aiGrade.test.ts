import { describe, expect, it } from 'vitest'
import { defaultSlotCounts } from '../providers/types'
import type { DraftPick, DraftSession, DraftSlot, Player } from '../providers/types'
import {
  buildAiDraftBriefing,
  extractJsonObject,
  parseAiDraftGrade,
  summarizeMarketHistory,
} from './aiGrade'

function slot(n: number, name: string): DraftSlot {
  return { slot: n, rosterId: `r${n}`, userId: null, displayName: name, teamName: name, isYou: n === 1 }
}

function session(overrides: Partial<DraftSession> = {}): DraftSession {
  return {
    provider: 'demo', draftId: 'd1', leagueId: 'l1', name: 'Thursday Night', type: 'snake',
    status: 'drafting', season: '2026', scoringType: 'ppr', teams: 4, rounds: 15,
    pickTimer: null, slots: defaultSlotCounts(), rosterPositions: [],
    order: [1, 2, 3, 4].map((n) => slot(n, `Team ${n}`)),
    yourUserId: 'you', yourSlot: 1, startTime: null, ...overrides,
  }
}

function player(overrides: Partial<Player> & { id: string }): Player {
  return {
    firstName: overrides.id, lastName: '', fullName: overrides.fullName ?? overrides.id,
    position: 'RB', team: null, searchRank: 50, injuryStatus: null, number: null,
    yearsExp: null, bye: null, ...overrides,
  }
}

function pick(playerId: string, draftSlot: number, pickNo: number, extra: Partial<DraftPick> = {}): DraftPick {
  return {
    playerId, pickedByUserId: null, rosterId: null, round: Math.max(1, Math.ceil(pickNo / 4)),
    draftSlot, pickNo, isKeeper: false, meta: null, ...extra,
  }
}

describe('buildAiDraftBriefing', () => {
  it('packs league settings, computed grades, and every pick with market context', () => {
    const players = [
      player({ id: 'cmc', fullName: 'CMC', position: 'RB', team: 'SF', adp: 1, liveAdp: 1.4, projectedPoints: 320, vorp: 80, bye: 14, searchRank: 1, rankStdDev: 2.4, playoffSos: { averageMatchupRank: 8, rank: 4, games: 3 } }),
      player({ id: 'bijan', fullName: 'Bijan', position: 'RB', team: 'ATL', adp: 3, projectedPoints: 300, vorp: 70, bye: 12, searchRank: 2 }),
      player({ id: 'cd', fullName: 'CD', position: 'WR', team: 'DAL', adp: 5, projectedPoints: 280, vorp: 60, bye: 7, searchRank: 3, injuryStatus: 'Q' }),
      player({ id: 'jj', fullName: 'JJ', position: 'WR', team: 'MIN', adp: 6, projectedPoints: 270, searchRank: 4 }),
    ]
    const picks = [
      pick('cmc', 1, 8),
      pick('bijan', 2, 2),
      pick('cd', 1, 9),
      pick('jj', 2, 3),
    ]
    const briefing = buildAiDraftBriefing({ session: session(), picks, players })

    expect(briefing.league).toMatchObject({
      name: 'Thursday Night', scoring: 'ppr', type: 'snake', teams: 4, yourSlot: 1, yourTeam: 'Team 1',
    })
    expect(briefing.legend.vsMarket).toMatch(/steal/)
    expect(briefing.progress).toMatchObject({ picksMade: 4, picksTotal: 60, complete: false })

    const mine = briefing.teams.find((team) => team.you)
    expect(mine?.name).toBe('Team 1')
    expect(mine?.picks).toHaveLength(2)
    expect(mine?.picks[0]).toMatchObject({
      pick: 8, player: 'CMC', pos: 'RB', nfl: 'SF', market: 1.4, marketSource: 'live ADP', vsMarket: 6.6, proj: 320, rank: 1, rankSpread: 2.4,
    })
    expect(mine?.picks[1]).toMatchObject({ player: 'CD', injury: 'Q' })
    expect(mine?.lineup.some((seat) => seat.player === 'CMC')).toBe(true)
    expect(mine?.holes.length).toBeGreaterThan(0)
    expect(mine?.counts).toEqual({ RB: 1, WR: 1 })
  })

  it('flags stacked byes, same-team handcuffs, and keepers', () => {
    const players = [
      player({ id: 'rb1', fullName: 'Gibbs', position: 'RB', team: 'DET', bye: 5, adp: 6, searchRank: 6 }),
      player({ id: 'rb2', fullName: 'Montgomery', position: 'RB', team: 'DET', bye: 5, adp: 40, searchRank: 40 }),
      player({ id: 'wr1', fullName: 'Amon-Ra', position: 'WR', team: 'DET', bye: 8, adp: 12, searchRank: 12 }),
    ]
    const picks = [
      pick('rb1', 1, 0, { isKeeper: true, round: 1 }),
      pick('rb2', 1, 40),
      pick('wr1', 1, 12),
    ]
    const briefing = buildAiDraftBriefing({ session: session(), picks, players })
    const mine = briefing.teams[0]
    expect(mine?.handcuffs).toEqual(['Gibbs / Montgomery'])
    expect(mine?.byes.some((row) => row.week === 5 && row.stacked)).toBe(true)
    expect(mine?.picks[0]).toMatchObject({ player: 'Gibbs', keeper: true, vsMarket: null })
  })

  it('lists remaining board and a position run from recent picks', () => {
    const drafted = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, index) =>
      player({ id, fullName: `RB ${id}`, position: 'RB', adp: index + 1, searchRank: index + 1 }),
    )
    const leftover = [
      player({ id: 'qb1', fullName: 'Allen', position: 'QB', adp: 20, searchRank: 20, projectedPoints: 360 }),
      player({ id: 'wr1', fullName: 'Chase', position: 'WR', adp: 4, searchRank: 4, projectedPoints: 310 }),
    ]
    const picks = drafted.map((item, index) => pick(item.id, (index % 4) + 1, index + 1))
    const briefing = buildAiDraftBriefing({
      session: session(),
      picks,
      players: [...drafted, ...leftover],
    })
    expect(briefing.runs).toEqual([{ pos: 'RB', count: 8, window: 8 }])
    expect(briefing.remaining.best.map((row) => row.name)).toEqual(['Chase', 'Allen'])
    expect(briefing.remaining.byPosition.find((row) => row.pos === 'WR')).toMatchObject({
      left: 1, elite: 1, next: ['Chase'],
    })
    expect(briefing.remaining.byPosition.some((row) => row.pos === 'RB')).toBe(false)
  })

  it('adds positional ranks, projection spread, market movement, and roster shape', () => {
    const day = 24 * 60 * 60 * 1000
    const now = Date.UTC(2026, 7, 20)
    const players = [
      player({
        id: 'qb1', fullName: 'Allen', position: 'QB', team: 'BUF', adp: 5, searchRank: 20,
        projectedPoints: 360, age: 30, depthChartOrder: 1, rankLow: 14, rankHigh: 31, consensusCount: 5,
        liveAdp: 4, liveAdpVsLastOne: 0.6, liveAdpVsLastSeven: 2.4,
        projectionBreakdown: [
          { id: 'cbs', label: 'CBS', stats: {}, games: 17, points: 340 },
          { id: 'espn', label: 'ESPN', stats: {}, games: 17, points: 372 },
        ],
      }),
      player({ id: 'wr1', fullName: 'Cooper', position: 'WR', team: 'BUF', adp: 30, searchRank: 30, projectedPoints: 240, age: 28 }),
      player({ id: 'wr2', fullName: 'Chase', position: 'WR', team: 'CIN', adp: 2, searchRank: 2, projectedPoints: 300, injuryStatus: 'Q' }),
      player({ id: 'rb1', fullName: 'Gibbs', position: 'RB', team: 'DET', adp: 5, searchRank: 5, projectedPoints: 280, tier: 1 }),
      player({ id: 'rb2', fullName: 'Swift', position: 'RB', team: 'CHI', adp: 60, searchRank: 60, projectedPoints: 150, tier: 4 }),
    ]
    const picks = [
      pick('rb1', 1, 1), pick('wr2', 2, 2), pick('qb1', 1, 8), pick('wr1', 1, 9),
    ]
    const history = new Map([
      ['qb1', [
        { at: now - 14 * day, rank: 34, adp: 34, liveAdp: null },
        { at: now, rank: 20, adp: 20, liveAdp: null },
      ]],
    ])
    const briefing = buildAiDraftBriefing({
      session: session(),
      picks,
      players,
      marketHistory: (row) => history.get(row.id) ?? [],
    })

    const mine = briefing.teams.find((team) => team.you)
    const allen = mine?.picks.find((row) => row.player === 'Allen')
    expect(allen).toMatchObject({
      posRank: 1, projPosRank: 1, depth: 1, experts: 5, rankRange: [14, 31], starter: true,
      projRange: [340, 372], projSources: 2,
      adpMomentum: { d1: 0.6, d7: 2.4 },
      adpTrend: { metric: 'adp', first: 34, last: 20, delta: 14, days: 14, points: 2 },
    })
    expect(mine?.stacks).toEqual(['Allen / Cooper'])
    expect(mine?.rank).toBe(1)
    expect(mine?.ptsVsRoom).toBeGreaterThan(0)
    expect(mine?.starterPtsByPos.QB).toBe(360)
    expect(mine?.bestValue).toMatchObject({ player: 'Allen', pick: 8, vsMarket: 4 })
    expect(mine?.worstValue?.player).toBe('Cooper')
    expect(mine?.nextPicks.length).toBeGreaterThan(0)
    expect(mine?.avgAge).toBeCloseTo(29, 1)

    expect(briefing.progress.currentRound).toBe(Math.ceil(briefing.progress.currentPick / 4))
    expect(briefing.board[0]).toMatchObject({ round: 1 })
    expect(briefing.market.steals[0]).toMatchObject({ player: 'Allen', pos: 'QB', pick: 8 })
    expect(briefing.market.byPosition.find((row) => row.pos === 'WR')).toMatchObject({ drafted: 2, firstPick: 2, lastPick: 9, seats: 12 })
    expect(briefing.market.replacement.RB).toBeGreaterThan(0)
    expect(briefing.remaining.byPosition.find((row) => row.pos === 'RB')).toMatchObject({ topTier: 4, inTopTier: 1 })

    const other = briefing.teams.find((team) => !team.you && team.picks.length > 0)
    expect(other?.injured).toEqual(['Chase (Q)'])
  })

  it('reads market movement from the richest series available', () => {
    const day = 24 * 60 * 60 * 1000
    expect(summarizeMarketHistory([])).toBeNull()
    expect(summarizeMarketHistory([{ at: 0, rank: 5, adp: null }])).toBeNull()
    expect(summarizeMarketHistory([
      { at: 0, rank: 40, adp: 41, liveAdp: 44 },
      { at: 7 * day, rank: 30, adp: 31, liveAdp: 33 },
    ])).toMatchObject({ metric: 'liveAdp', first: 44, last: 33, delta: 11, days: 7 })
  })

  it('marks the draft complete when the board is full', () => {
    const players = [1, 2, 3, 4].map((n) => player({ id: `p${n}`, fullName: `P${n}`, adp: n, searchRank: n }))
    const picks = players.map((item, index) => pick(item.id, index + 1, index + 1))
    const briefing = buildAiDraftBriefing({
      session: session({ rounds: 1, status: 'complete' }),
      picks,
      players,
    })
    expect(briefing.progress).toMatchObject({ picksMade: 4, picksTotal: 4, complete: true })
  })
})

describe('parseAiDraftGrade', () => {
  it('reads a structured writeup', () => {
    const grade = parseAiDraftGrade({
      headline: 'Value won the room',
      summary: 'Three teams waited on RB.',
      themes: ['RB run in round 2', 'TE scarcity'],
      teams: [
        { slot: 1, headline: 'Zero-RB paid off', summary: 'Chase plus depth.', steals: ['CMC at 8'], reaches: [], risks: ['Bye 14'], next: 'Take a QB' },
        { slot: 0, headline: 'ignored', summary: 'ignored' },
        { headline: 'no slot', summary: 'no slot' },
      ],
    })
    expect(grade.headline).toBe('Value won the room')
    expect(grade.themes).toEqual(['RB run in round 2', 'TE scarcity'])
    expect(grade.teams).toHaveLength(1)
    expect(grade.teams[0]).toMatchObject({ slot: 1, next: 'Take a QB', steals: ['CMC at 8'] })
  })

  it('unwraps fenced JSON and drops empty lists', () => {
    const grade = parseAiDraftGrade('```json\n{"headline":"A","summary":"B","themes":["","x"],"teams":[]}\n```')
    expect(grade).toEqual({ headline: 'A', summary: 'B', themes: ['x'], superlatives: [], teams: [] })
  })

  it('rejects a reply with no summary', () => {
    expect(() => parseAiDraftGrade({ themes: ['x'] })).toThrow(/missing a summary/)
    expect(() => extractJsonObject('not json')).toThrow(/not JSON/)
  })
})
