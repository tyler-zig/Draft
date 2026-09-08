import { describe, expect, it } from 'vitest'
import type { Player } from '../providers/types'
import { consistencyEdge, consistencyFromPair, positionConsistencyMedians } from './consistency'

function player(id: string, position: string, cv: number | null): Player {
  return {
    id, firstName: id, lastName: '', fullName: id, position, team: 'CHI',
    searchRank: 20, injuryStatus: null, number: null, yearsExp: null, bye: null,
    consistency: cv == null ? null : { cv, weeks: 17 },
  }
}

describe('consistencyFromPair', () => {
  it('reads the index pair', () => {
    expect(consistencyFromPair([0.456, 17])).toEqual({ cv: 0.456, weeks: 17 })
  })

  it('returns nothing for an index published without the field', () => {
    expect(consistencyFromPair(undefined)).toBeNull()
    expect(consistencyFromPair(null)).toBeNull()
    expect(consistencyFromPair([])).toBeNull()
  })

  it('rejects a malformed or impossible reading rather than scoring it', () => {
    expect(consistencyFromPair([0.5])).toBeNull()
    expect(consistencyFromPair([0, 17])).toBeNull()
    expect(consistencyFromPair([0.5, 0])).toBeNull()
    expect(consistencyFromPair([Number.NaN, 17])).toBeNull()
  })
})

describe('positionConsistencyMedians', () => {
  const pool = (position: string, values: number[]) =>
    values.map((cv, i) => player(`${position}${i}`, position, cv))

  it('takes a median per position from the pool', () => {
    const medians = positionConsistencyMedians(pool('RB', [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]))
    expect(medians.get('RB')).toBeCloseTo(0.65, 5)
  })

  it('skips a position with too few readings to be a fact', () => {
    const medians = positionConsistencyMedians(pool('TE', [0.4, 0.6, 0.8]))
    expect(medians.has('TE')).toBe(false)
  })

  it('ignores players with no reading', () => {
    const players = [...pool('WR', [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1]), player('none', 'WR', null)]
    expect(positionConsistencyMedians(players).get('WR')).toBeCloseTo(0.75, 5)
  })
})

describe('consistencyEdge', () => {
  it('is positive for a player steadier than his positional median', () => {
    expect(consistencyEdge({ cv: 0.33, weeks: 17 }, 0.58)!).toBeGreaterThan(0)
    expect(consistencyEdge({ cv: 0.80, weeks: 17 }, 0.58)!).toBeLessThan(0)
  })

  it('is null without a reading or without a median to compare against', () => {
    expect(consistencyEdge(null, 0.58)).toBeNull()
    expect(consistencyEdge({ cv: 0.4, weeks: 17 }, undefined)).toBeNull()
    expect(consistencyEdge({ cv: 0.4, weeks: 17 }, 0)).toBeNull()
  })

  it('clamps the thin tail, where one enormous week drives the ratio', () => {
    expect(consistencyEdge({ cv: 3.0, weeks: 17 }, 0.58)).toBe(-0.5)
    expect(consistencyEdge({ cv: 0.01, weeks: 17 }, 0.58)).toBe(0.5)
  })
})
