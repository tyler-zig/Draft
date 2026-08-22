import { describe, expect, it } from 'vitest'
import { applyValuations, buildValuations } from './playerValuations'
import type { Player } from '../providers/types'

function player(overrides: Partial<Player> & { id: string }): Player {
  return {
    firstName: 'A', lastName: 'B', fullName: 'A B', position: 'RB', team: 'CHI',
    searchRank: 50, injuryStatus: null, number: null, yearsExp: null, bye: null,
    ...overrides,
  }
}

describe('buildValuations', () => {
  it('sends only what an ESPN snapshot cannot supply', () => {
    const table = buildValuations([player({ id: '1', vorp: 12, liveAdp: 4.5, tier: 2 })], 'L', '2026')
    expect(table.players['1']).toEqual({ vorp: 12, liveAdp: 4.5, tier: 2 })
  })

  it('skips a player the app knows nothing extra about', () => {
    const table = buildValuations([player({ id: '1' })], 'L', '2026')
    expect(table.players).toEqual({})
  })

  it('keys on the ESPN id so the extension can join without name matching', () => {
    const table = buildValuations([player({ id: 'sleeper-9', espnId: '4426502', vorp: 3 })], 'L', '2026')
    expect(Object.keys(table.players)).toEqual(['4426502'])
  })

  it('keeps the earliest players when the pool is capped', () => {
    const players = [
      player({ id: 'late', liveAdp: 200, vorp: 1 }),
      player({ id: 'early', liveAdp: 2, vorp: 1 }),
      player({ id: 'mid', liveAdp: 50, vorp: 1 }),
    ]
    const table = buildValuations(players, 'L', '2026', 2)
    expect(Object.keys(table.players).sort()).toEqual(['early', 'mid'])
  })

  it('stamps the league so a stale table can be rejected', () => {
    const table = buildValuations([player({ id: '1', vorp: 1 })], '1882426813', '2026')
    expect(table.leagueId).toBe('1882426813')
    expect(table.season).toBe('2026')
  })
})

describe('applyValuations', () => {
  it('merges the app numbers onto snapshot players', () => {
    const merged = applyValuations(
      [player({ id: '1', searchRank: 40 })],
      { leagueId: 'L', season: '2026', updatedAt: 0, players: { 1: { vorp: 9, liveAdp: 12 } } },
    )
    expect(merged[0]).toMatchObject({ id: '1', searchRank: 40, vorp: 9, liveAdp: 12 })
  })

  it('leaves uncovered players on the board untouched', () => {
    const players = [player({ id: '1' }), player({ id: '2' })]
    const merged = applyValuations(players, {
      leagueId: 'L', season: '2026', updatedAt: 0, players: { 1: { vorp: 9 } },
    })
    expect(merged).toHaveLength(2)
    expect(merged[1]!.vorp).toBeUndefined()
  })

  it('is a no-op with no table', () => {
    const players = [player({ id: '1' })]
    expect(applyValuations(players, null)).toBe(players)
  })
})
