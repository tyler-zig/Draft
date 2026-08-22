import { describe, expect, it } from 'vitest'
import { toRankSets, type CollectedSnapshot } from './collected'
import type { Player } from '../providers/types'

function player(id: string, fullName: string, position: string, team: string): Player {
  return {
    id, espnId: id, firstName: fullName.split(' ')[0]!, lastName: '', fullName, position, team,
    searchRank: 100, injuryStatus: null, number: null, yearsExp: null, bye: null,
  }
}

const directory = [player('-16034', 'Houston Texans', 'DEF', 'HOU')]

function snapshot(sets: CollectedSnapshot['sets']): CollectedSnapshot {
  return { schemaVersion: 2, fetchedAt: 1, stats: { sets: sets.length, rows: 1, players: 1 }, sets }
}

const row = (adp: number, overall: number) => ({
  name: 'Houston Texans', team: 'HOU', position: 'DEF', espnId: '-16034', adp, overall,
})

describe('toRankSets keeps the live board out of the season sets', () => {
  // sourceGroup splits on the first dash, so fantasypros-rtadp grouped with
  // fantasypros-half; both label themselves 'half', and mergeRows keeps the
  // lowest ADP -- so the live board's 83 replaced the season board's 121.
  const sets = [
    { id: 'fantasypros-half', label: 'FP Half', scoring: 'half', sourceUrl: '', fetchedAt: 1, rows: [row(121, 175)] },
    { id: 'fantasypros-rtadp', label: 'FP Real-time ADP', scoring: 'half', sourceUrl: '', fetchedAt: 1, rows: [row(83, 83)] },
  ]

  it('reports the season ADP, not the live one', () => {
    const built = toRankSets(snapshot(sets), directory)
    expect(built).toHaveLength(1)
    expect(built[0]!.id).toBe('collected:fantasypros-half')
    expect(built[0]!.rows[0]!.adp).toBe(121)
  })

  it('does not install the live board as a set of its own', () => {
    const ids = toRankSets(snapshot(sets), directory, 'board').map((set) => set.id)
    expect(ids).toEqual(['collected:fantasypros-half'])
  })

  it('leaves other sources grouped as before', () => {
    const built = toRankSets(snapshot([
      ...sets,
      { id: 'rotowire-consensus-half-ppr-ov', label: 'RW', scoring: 'half', sourceUrl: '', fetchedAt: 1, rows: [row(140, 190)] },
    ]), directory)
    expect(built.map((set) => set.id).sort()).toEqual(['collected:fantasypros-half', 'collected:rotowire-half'])
  })
})
