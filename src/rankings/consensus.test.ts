import { describe, expect, it } from 'vitest'
import type { Player } from '../providers/types'
import type { RankSet } from './types'
import { applyConsensusRanks, attachSetRange, getPlayerRankFacts } from './consensus'

const players: Player[] = [
  { id: 'a', firstName: 'A', lastName: 'One', fullName: 'A One', position: 'RB', team: 'A', searchRank: 1, injuryStatus: null, number: null, yearsExp: null, bye: null },
  { id: 'b', firstName: 'B', lastName: 'Two', fullName: 'B Two', position: 'WR', team: 'B', searchRank: 2, injuryStatus: null, number: null, yearsExp: null, bye: null },
]
const set = (id: string, ranks: [string, number][]): RankSet => ({ id, label: id, scoring: 'ppr', kind: 'import', fetchedAt: 1, unmatched: [], rows: ranks.map(([playerId, overall]) => ({ playerId, name: playerId, team: null, position: null, overall })) })

describe('expert consensus integration', () => {
  it('changes player ordering when the enabled expert source changes', () => {
    const sources = [set('collected:fantasypros-ppr', [['a', 1], ['b', 2]]), set('expert:ppr:contrarian', [['b', 1], ['a', 2]])]
    const consensus = applyConsensusRanks(players, sources, ['collected:fantasypros-ppr'], 'median')
    const expert = applyConsensusRanks(players, sources, ['expert:ppr:contrarian'], 'median')
    expect(consensus.find((player) => player.id === 'a')?.searchRank).toBe(1)
    expect(expert.find((player) => player.id === 'b')?.searchRank).toBe(1)
  })

  it('reports the actual enabled-source range and ignores disabled sources', () => {
    const sources = [set('one', [['a', 4]]), set('two', [['a', 9]]), set('off', [['a', 20]])]
    sources[0].label = 'First source'
    sources[1].label = 'Second source'
    const facts = getPlayerRankFacts(players[0], sources, ['one', 'two'])
    expect(facts.sources.map((source) => [source.label, source.rank])).toEqual([
      ['First source', 4],
      ['Second source', 9],
    ])
    expect(facts.low).toBe(4)
    expect(facts.high).toBe(9)
  })

  it('does not invent a rank range from one source', () => {
    const facts = getPlayerRankFacts(players[0], [set('one', [['a', 4]])], ['one'])
    expect(facts.low).toBeNull()
    expect(facts.high).toBeNull()
  })

  it('attaches a published spread from boards that are not in the consensus recipe', () => {
    const board = set('collected:fantasypros-ppr', [['a', 6]])
    board.rows[0]!.best = 2
    board.rows[0]!.worst = 14
    const consensus = applyConsensusRanks(players, [board], ['builtin:sleeper'], 'median')
    expect(consensus[0]?.rankLow).toBeNull()
    const ranged = attachSetRange(consensus, [board])
    expect(ranged[0]?.rankLow).toBe(2)
    expect(ranged[0]?.rankHigh).toBe(14)
  })

  it('uses a source published expert min/max as the range', () => {
    const board = set('collected:fantasypros-ppr', [['a', 6]])
    board.rows[0].best = 3
    board.rows[0].worst = 11
    const facts = getPlayerRankFacts(players[0], [board], ['collected:fantasypros-ppr'])
    expect(facts.low).toBe(3)
    expect(facts.high).toBe(11)
    const ranked = applyConsensusRanks(players, [board], ['collected:fantasypros-ppr'], 'median')
    expect(ranked[0]?.rankLow).toBe(3)
    expect(ranked[0]?.rankHigh).toBe(11)
  })

  it('clusters consecutive same-position ranks from one source', () => {
    const pool: Player[] = [1, 2, 3, 4, 12].map((rank) => ({
      id: `rb${rank}`, firstName: 'R', lastName: String(rank), fullName: `R ${rank}`,
      position: 'RB', team: 'CHI', searchRank: rank, injuryStatus: null, number: null, yearsExp: null, bye: null,
    }))
    const ranked = applyConsensusRanks(pool, [set('one', pool.map((player) => [player.id, player.searchRank] as [string, number]))], ['one'], 'median')
    expect(ranked.find((player) => player.id === 'rb1')?.tier).toBe(1)
    expect(ranked.find((player) => player.id === 'rb4')?.tier).toBe(1)
    expect(ranked.find((player) => player.id === 'rb12')?.tier).toBe(2)
  })
})

describe('market ADP across scoring formats', () => {
  // The collected sets tag themselves 'half' / 'standard'; a DraftSession says
  // 'half_ppr' / 'std'. Comparing the two spellings directly matched nothing,
  // so no set counted as the league's market and ADP fell through to whatever
  // sat first in the array -- the ESPN builtin, carrying ESPN's own
  // averageDraftPosition. Defenses are where that diverges most.
  const adpSet = (id: string, scoring: RankSet['scoring'], adp: number): RankSet => ({
    id, label: id, scoring, kind: 'import', fetchedAt: 1, unmatched: [],
    rows: [{ playerId: 'def1', name: 'Houston Texans', team: 'HOU', position: 'DEF', overall: 155, adp }],
  })
  const espnBuiltin: RankSet = {
    id: 'builtin:espn', label: 'ESPN draft rank', scoring: 'unknown', kind: 'builtin',
    fetchedAt: 1, unmatched: [],
    rows: [{ playerId: 'def1', name: 'Houston Texans', team: 'HOU', position: 'DEF', overall: 199, adp: 86.4 }],
  }
  const texans = { id: 'def1', firstName: 'Texans', lastName: 'D/ST', fullName: 'Texans D/ST', position: 'DEF', team: 'HOU', searchRank: 199, injuryStatus: null, number: null, yearsExp: null, bye: null }

  function adpFor(scoring: 'ppr' | 'half_ppr' | 'std') {
    const sets = [espnBuiltin, adpSet('fantasypros-half', 'half', 121), adpSet('fantasypros-ppr', 'ppr', 96)]
    const out = applyConsensusRanks([texans], sets, sets.map((s) => s.id), 'median', scoring)
    return out[0]!.adp
  }

  it('uses the half-PPR board in a half-PPR league', () => {
    expect(adpFor('half_ppr')).toBe(121)
  })

  it('uses the PPR board in a PPR league', () => {
    expect(adpFor('ppr')).toBe(96)
  })

  it('never lets a format-less builtin outrank a real market board', () => {
    expect(adpFor('std')).not.toBe(86.4)
  })
})

describe('market ADP when the league scoring is unknown', () => {
  // A practice clone often arrives without scoringSettings, so the session
  // reports 'unknown'. That used to mean "everything competes", and a straight
  // min across markets handed every defense the provider's own early ADP.
  const board: RankSet = {
    id: 'fantasypros-half', label: 'FantasyPros half', scoring: 'half', kind: 'import',
    fetchedAt: 1, unmatched: [],
    rows: [{ playerId: 'def1', name: 'Houston Texans', team: 'HOU', position: 'DEF', overall: 175, adp: 121 }],
  }
  const espnBuiltin: RankSet = {
    id: 'builtin:espn', label: 'ESPN draft rank', scoring: 'unknown', kind: 'builtin',
    fetchedAt: 1, unmatched: [],
    rows: [{ playerId: 'def1', name: 'Houston Texans', team: 'HOU', position: 'DEF', overall: 199, adp: 86.4 }],
  }
  const texans = { id: 'def1', firstName: 'Texans', lastName: 'D/ST', fullName: 'Texans D/ST', position: 'DEF', team: 'HOU', searchRank: 199, injuryStatus: null, number: null, yearsExp: null, bye: null }

  it('prefers a collected board over the provider ADP', () => {
    const sets = [espnBuiltin, board]
    const out = applyConsensusRanks([texans], sets, sets.map((s) => s.id), 'median', 'unknown')
    expect(out[0]!.adp).toBe(121)
  })

  it('still falls back to the builtin when no board covers the player', () => {
    const sets = [espnBuiltin, { ...board, rows: [] }]
    const out = applyConsensusRanks([texans], sets, sets.map((s) => s.id), 'median', 'unknown')
    expect(out[0]!.adp).toBe(86.4)
  })
})

describe('a provider builtin never outranks a collected board', () => {
  // The draft board carries builtin:espn (ESPN's own averageDraftPosition);
  // Player Intelligence does not. That alone made the two pages disagree on
  // every defense -- 86.4 on one, a collected number on the other.
  const texans = { id: 'def1', firstName: 'Texans', lastName: 'D/ST', fullName: 'Texans D/ST', position: 'DEF', team: 'HOU', searchRank: 199, injuryStatus: null, number: null, yearsExp: null, bye: null }
  const espnBuiltin: RankSet = {
    id: 'builtin:espn', label: 'ESPN draft rank', scoring: 'unknown', kind: 'builtin',
    fetchedAt: 1, unmatched: [],
    rows: [{ playerId: 'def1', name: 'Houston Texans', team: 'HOU', position: 'DEF', overall: 199, adp: 86.4 }],
  }
  const collected = (scoring: RankSet['scoring'], adp: number): RankSet => ({
    id: `board-${scoring}`, label: `board ${scoring}`, scoring, kind: 'import', fetchedAt: 1, unmatched: [],
    rows: [{ playerId: 'def1', name: 'Houston Texans', team: 'HOU', position: 'DEF', overall: 175, adp }],
  })
  const adpWith = (sets: RankSet[], scoring: 'ppr' | 'half_ppr' | 'std' | 'unknown') =>
    applyConsensusRanks([texans], sets, sets.map((s) => s.id), 'median', scoring)[0]!.adp

  it('loses to a board even when the league format is unknown', () => {
    expect(adpWith([espnBuiltin, collected('half', 121)], 'unknown')).toBe(121)
  })

  it('loses to a board whose format does not match the league either', () => {
    expect(adpWith([espnBuiltin, collected('standard', 135)], 'ppr')).toBe(135)
  })

  it('still fills a player no board covers', () => {
    expect(adpWith([espnBuiltin, { ...collected('half', 121), rows: [] }], 'unknown')).toBe(86.4)
  })
})

describe('the live ADP board stays out of the season market', () => {
  // fantasypros-rtadp is tagged 'half', so in a half-PPR league it competed
  // directly and won the min -- leaving the ADP and Live ADP columns showing
  // the same 83 for a defense the season boards had at 121.
  const texans = { id: 'def1', firstName: 'Texans', lastName: 'D/ST', fullName: 'Texans D/ST', position: 'DEF', team: 'HOU', searchRank: 199, injuryStatus: null, number: null, yearsExp: null, bye: null }
  const board = (id: string, adp: number): RankSet => ({
    id, label: id, scoring: 'half', kind: 'import', fetchedAt: 1, unmatched: [],
    rows: [{ playerId: 'def1', name: 'Houston Texans', team: 'HOU', position: 'DEF', overall: 175, adp }],
  })
  const adpWith = (sets: RankSet[]) =>
    applyConsensusRanks([texans], sets, sets.map((s) => s.id), 'median', 'half_ppr')[0]!.adp

  it('reports the season board, not the live one', () => {
    expect(adpWith([board('fantasypros-rtadp', 83), board('fantasypros-half', 121)])).toBe(121)
  })

  it('recognizes the collected: prefix and the sized Draft Wizard boards', () => {
    expect(adpWith([board('collected:fantasypros-rtadp', 83), board('fantasypros-half', 121)])).toBe(121)
    expect(adpWith([board('draftwizard-adp-12', 83), board('fantasypros-half', 121)])).toBe(121)
    expect(adpWith([board('draftwizard-adp-ppr-12', 83), board('fantasypros-half', 121)])).toBe(121)
    expect(adpWith([board('fantasypros-rtadp-dynasty', 83), board('fantasypros-half', 121)])).toBe(121)
  })

  it('leaves ADP blank rather than borrowing the live board', () => {
    expect(adpWith([board('fantasypros-rtadp', 83)])).toBeNull()
  })
})
