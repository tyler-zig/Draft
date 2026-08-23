import { describe, expect, it } from 'vitest'
import type { CollectedSnapshot } from './collected'
import {
  HOSTED_BOARDS_STALE_MS,
  hostedCollectorSources,
  hostedFreshness,
  relativeAge,
} from './hostedSources'
import { LIVE_ADP_MAX_AGE_MS, type LiveAdpSnapshot } from './liveAdp'

const NOW = Date.parse('2026-08-22T20:50:00.000Z')

function rankings(overrides: Partial<CollectedSnapshot> = {}): CollectedSnapshot {
  return {
    schemaVersion: 2,
    fetchedAt: NOW - 9 * 60 * 60 * 1000,
    stats: { sets: 2, rows: 2, players: 2 },
    sets: [
      { id: 'fantasypros-half', label: 'FP Half', scoring: 'half', sourceUrl: '', fetchedAt: 1, rows: [{ name: 'A', team: 'CHI', position: 'RB', espnId: '1' }] },
      { id: 'rotowire-consensus-half-ppr-ov', label: 'RW', scoring: 'half', sourceUrl: '', fetchedAt: 1, rows: [{ name: 'B', team: 'GB', position: 'WR' }] },
    ],
    ...overrides,
  }
}

function adp(overrides: Partial<LiveAdpSnapshot> = {}): LiveAdpSnapshot {
  return {
    fetchedAt: NOW - 12 * 60 * 1000,
    rows: [{ name: 'A', team: 'CHI', position: 'RB', adp: 7.2 }],
    sets: [
      { id: 'fantasypros-rtadp', scoring: 'half', rows: [{ name: 'A', team: 'CHI', position: 'RB', adp: 7.2 }] },
      { id: 'fantasypros-rtadp-ppr', scoring: 'ppr', rows: [{ name: 'A', team: 'CHI', position: 'RB', adp: 8.1 }] },
      { id: 'draftwizard-adp-12', meta: { teams: 12 }, rows: [{ name: 'A', team: 'CHI', position: 'RB', adp: 9 }] },
    ],
    ...overrides,
  }
}

describe('hostedCollectorSources', () => {
  it('always lists Real-Time ADP, even when the 6-hour snapshot is the only artifact', () => {
    const sources = hostedCollectorSources(rankings(), null)
    expect(sources.map((source) => source.id)).toEqual([
      'fantasypros', 'fantasypros-adp', 'draftwizard-adp', 'rotowire', 'espn',
    ])
    expect(sources.find((source) => source.id === 'fantasypros-adp')).toMatchObject({
      label: 'FantasyPros Real-Time ADP',
      present: false,
    })
  })

  it('reads Real-Time ADP from the dedicated 15-minute artifact', () => {
    const sources = hostedCollectorSources(rankings(), adp())
    const live = sources.find((source) => source.id === 'fantasypros-adp')
    expect(live).toMatchObject({
      present: true,
      boards: 2,
      fetchedAt: NOW - 12 * 60 * 1000,
    })
    expect(live?.detail).toContain('every 15 minutes')
  })

  it('falls back to rtadp boards buried in rankings-latest', () => {
    const sources = hostedCollectorSources(rankings({
      sets: [
        ...rankings().sets,
        { id: 'fantasypros-rtadp', label: 'RT', scoring: 'half', sourceUrl: '', fetchedAt: 1, rows: [{ name: 'A', team: 'CHI', position: 'RB' }] },
      ],
    }), null)
    expect(sources.find((source) => source.id === 'fantasypros-adp')?.present).toBe(true)
  })
})

describe('relativeAge', () => {
  it('names a 9-hour rankings snapshot without calling it live ADP', () => {
    expect(relativeAge(NOW - 9 * 60 * 60 * 1000, NOW)).toBe('9h ago')
    expect(relativeAge(NOW - 12 * 60 * 1000, NOW)).toBe('12m ago')
    expect(relativeAge(null, NOW)).toBe('—')
  })
})

describe('hostedFreshness', () => {
  it('treats 9-hour expert boards as live and 9-hour ADP as stale', () => {
    expect(hostedFreshness({ id: 'fantasypros', present: true, fetchedAt: NOW - 9 * 60 * 60 * 1000 }, NOW)).toBe('live')
    expect(hostedFreshness({ id: 'fantasypros-adp', present: true, fetchedAt: NOW - 9 * 60 * 60 * 1000 }, NOW)).toBe('stale')
    expect(hostedFreshness({ id: 'fantasypros-adp', present: true, fetchedAt: NOW - 12 * 60 * 1000 }, NOW)).toBe('live')
    expect(NOW - (NOW - 9 * 60 * 60 * 1000)).toBeLessThan(HOSTED_BOARDS_STALE_MS)
    expect(NOW - (NOW - 9 * 60 * 60 * 1000)).toBeGreaterThan(LIVE_ADP_MAX_AGE_MS)
  })
})
