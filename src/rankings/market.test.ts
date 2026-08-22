import { describe, expect, it } from 'vitest'
import { applyConsensusRanks, builtinSet } from './consensus'
import { rowsFromCsv, rowsFromJson } from './parse'
import type { RankSet } from './types'
import type { Player } from '../providers/types'

function player(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    firstName: 'Test',
    lastName: id,
    fullName: `Test ${id}`,
    position: 'RB',
    team: 'CHI',
    searchRank: 10,
    injuryStatus: null,
    number: null,
    yearsExp: 2,
    bye: 7,
    sleeperId: id,
    ...overrides,
  }
}

function set(id: string, scoring: RankSet['scoring'], rows: RankSet['rows']): RankSet {
  return { id, label: id, scoring, kind: 'import', fetchedAt: 1, rows, unmatched: [] }
}

const row = (playerId: string, overall: number, adp: number | null, tier: number | null = null) => ({
  name: `Test ${playerId}`, team: 'CHI', position: 'RB', overall, adp, tier, playerId, sleeperId: playerId,
})

describe('built-in sets carry ADP', () => {
  it('passes a provider ADP through to the market', () => {
    const players = [player('a', { adp: 12.5 })]
    const built = builtinSet('builtin:espn', 'ESPN draft rank', players)
    expect(built.rows[0]?.adp).toBe(12.5)

    const [result] = applyConsensusRanks(players, [built], ['builtin:espn'], 'median')
    expect(result.adp).toBe(12.5)
  })

  it('reports no ADP when the provider has none, rather than inventing one', () => {
    const players = [player('a')]
    const built = builtinSet('builtin:sleeper', 'Sleeper rank', players)
    expect(built.rows[0]?.adp).toBeNull()
    const [result] = applyConsensusRanks(players, [built], ['builtin:sleeper'], 'median')
    expect(result.adp).toBeNull()
  })

  it('keeps a provider ADP when the enabled set does not publish one', () => {
    const players = [player('a', { adp: 14.4 })]
    const built = builtinSet('builtin:sleeper', 'Sleeper rank', players.map((item) => ({ ...item, adp: null })))
    const [result] = applyConsensusRanks(players, [built], ['builtin:sleeper'], 'median')
    expect(result.adp).toBe(14.4)
  })
})

describe('market facts follow the league scoring format', () => {
  const players = [player('a')]
  const ppr = set('ppr-board', 'ppr', [row('a', 1, 5, 1)])
  const standard = set('std-board', 'std', [row('a', 1, 2, 4)])
  const enabled = ['ppr-board', 'std-board']

  it('takes ADP from the matching format even when another format reports earlier', () => {
    const [result] = applyConsensusRanks(players, [ppr, standard], enabled, 'median', 'ppr')
    expect(result.adp).toBe(5)
    expect(result.tier).toBe(1)
  })

  it('switches markets with the league', () => {
    const [result] = applyConsensusRanks(players, [ppr, standard], enabled, 'median', 'std')
    expect(result.adp).toBe(2)
    expect(result.tier).toBe(4)
  })

  it('matches expert sets, which spell the format differently from collected sets', () => {
    // Expert sets store 'half_ppr'; collected sets used to store 'half'.
    const half = set('expert-board', 'half_ppr', [row('a', 1, 8)])
    const [result] = applyConsensusRanks(players, [half, standard], ['expert-board', 'std-board'], 'median', 'half_ppr')
    expect(result.adp).toBe(8)
  })

  it('still fills players the matching format never mentions', () => {
    const two = [player('a'), player('b')]
    const onlyStandard = set('std-board', 'std', [row('b', 1, 30)])
    const result = applyConsensusRanks(two, [ppr, onlyStandard], ['ppr-board', 'std-board'], 'median', 'ppr')
    expect(result.find((p) => p.id === 'b')?.adp).toBe(30)
  })

  it('falls back to the earliest ADP across all sets when the format is unknown', () => {
    const [result] = applyConsensusRanks(players, [ppr, standard], enabled, 'median', 'unknown')
    expect(result.adp).toBe(2)
  })

  it('ignores a zero ADP rather than letting it win the earliest-ADP rule', () => {
    const blank = set('blank-board', 'ppr', [row('a', 1, 0)])
    const [result] = applyConsensusRanks(players, [blank, ppr], ['blank-board', 'ppr-board'], 'median', 'ppr')
    expect(result.adp).toBe(5)
  })

  it('reports no ADP when every source reported a blank', () => {
    const blank = set('blank-board', 'ppr', [row('a', 1, 0)])
    const [result] = applyConsensusRanks(players, [blank], ['blank-board'], 'median', 'ppr')
    expect(result.adp).toBeNull()
  })

  it('behaves as before when no format is passed', () => {
    const [result] = applyConsensusRanks(players, [ppr, standard], enabled, 'median')
    expect(result.adp).toBe(2)
  })
})

describe('imported boards keep their ADP column', () => {
  it('reads ADP from CSV without consuming it as the rank', () => {
    const rows = rowsFromCsv('Rank,Player,Team,Pos,ADP,Tier,Bye\n1,Test a,CHI,RB,4.2,2,7\n')
    expect(rows[0]?.overall).toBe(1)
    expect(rows[0]?.adp).toBe(4.2)
    expect(rows[0]?.tier).toBe(2)
    expect(rows[0]?.byeWeek).toBe(7)
  })

  it('still uses ADP as the rank when no rank column exists', () => {
    const rows = rowsFromCsv('Player,Team,Pos,ADP\nTest a,CHI,RB,4.2\n')
    expect(rows[0]?.overall).toBe(4.2)
    expect(rows[0]?.adp).toBe(4.2)
  })

  it('reads ADP from JSON', () => {
    const rows = rowsFromJson(JSON.stringify([{ name: 'Test a', team: 'CHI', pos: 'RB', rank: 1, adp: 9.5 }]))
    expect(rows[0]?.overall).toBe(1)
    expect(rows[0]?.adp).toBe(9.5)
  })

  it('reports null rather than 0 for a board with no ADP', () => {
    const rows = rowsFromCsv('Rank,Player,Team,Pos\n1,Test a,CHI,RB\n')
    expect(rows[0]?.adp).toBeNull()
  })
})
