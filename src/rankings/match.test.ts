import { describe, expect, it } from 'vitest'
import type { Player } from '../providers/types'
import { buildPlayerIndex, matchRow } from './match'

function player(overrides: Partial<Player> & { id: string; fullName: string }): Player {
  return {
    firstName: overrides.fullName.split(' ')[0] ?? overrides.id,
    lastName: overrides.fullName.split(' ').slice(1).join(' ') || '',
    position: 'RB',
    team: 'CHI',
    searchRank: 50,
    injuryStatus: null,
    number: null,
    yearsExp: null,
    bye: null,
    ...overrides,
  }
}

describe('ranking row matching', () => {
  it('does not give a ranking row to a free agent who shares a rostered name', () => {
    const rostered = player({ id: 'nfl', fullName: 'John Smith', team: 'DAL', searchRank: 12 })
    const unsigned = player({ id: 'fa', fullName: 'John Smith', team: null, searchRank: 12 })
    const index = buildPlayerIndex([unsigned, rostered])
    expect(matchRow({ name: 'John Smith', team: 'DAL', position: 'RB', overall: 12 }, index)?.id).toBe('nfl')
  })

  it('still matches a blank-team player when he is the only one with that name', () => {
    const unsigned = player({ id: 'only', fullName: 'Jahmyr Gibbs', team: null, searchRank: 1 })
    const index = buildPlayerIndex([unsigned])
    expect(matchRow({ name: 'Jahmyr Gibbs', team: 'DET', position: 'RB', overall: 1 }, index)?.id).toBe('only')
  })

  it('still matches a rostered player by name and position when the row has a team', () => {
    const rostered = player({ id: 'nfl', fullName: 'Jahmyr Gibbs', team: 'DET', searchRank: 1 })
    const index = buildPlayerIndex([rostered])
    expect(matchRow({ name: 'Jahmyr Gibbs', team: 'DET', position: 'RB', overall: 1 }, index)?.id).toBe('nfl')
  })
})
