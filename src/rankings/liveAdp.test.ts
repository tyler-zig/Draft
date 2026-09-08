import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Player } from '../providers/types'
import { applyLiveAdp, fetchLiveAdpSnapshot, formatLiveAdpChange, liveAdpChangeTone, liveAdpRowsForTeams, nearestLiveAdpTeams, liveAdpScoringSlug, draftWizardAdpSetId, fantasyProsRtAdpSetId, isLiveAdpFresh, LIVE_ADP_MAX_AGE_MS } from './liveAdp'
import type { LiveAdpSnapshot } from './liveAdp'

vi.mock('../supabase/artifacts', () => ({
  readRankingArtifact: vi.fn(),
}))
import { readRankingArtifact } from '../supabase/artifacts'

// These fixtures predate the freshness guard; they describe a board just
// collected, which is what every one of them means.
const NOW = Date.now()

const players: Player[] = [
  { id: '1', firstName: 'Christian', lastName: 'McCaffrey', fullName: 'Christian McCaffrey', position: 'RB', team: 'SF', searchRank: 1, injuryStatus: null, number: null, yearsExp: 8, bye: 9, espnId: '4034' },
  { id: '2', firstName: 'Jordan', lastName: 'Addison', fullName: 'Jordan Addison', position: 'WR', team: 'MIN', searchRank: 26, injuryStatus: null, number: null, yearsExp: 3, bye: 6 },
  { id: '3', firstName: 'Rookie', lastName: 'McLaughlin', fullName: 'Rookie McLaughlin', position: 'RB', team: 'DEN', searchRank: 41, injuryStatus: null, number: null, yearsExp: 0, bye: 14 },
]

const snapshot = (rows: Array<{ name: string; team: string | null; position: string | null; adp?: number | null; espnId?: string }>) => ({
  fetchedAt: NOW,
  rows,
})

describe('league-size board selection', () => {
  it('snaps to the nearest collected size', () => {
    expect(nearestLiveAdpTeams(undefined)).toBe(12)
    expect(nearestLiveAdpTeams(10)).toBe(10)
    expect(nearestLiveAdpTeams(9)).toBe(8)
    expect(nearestLiveAdpTeams(15)).toBe(14)
    expect(nearestLiveAdpTeams(20)).toBe(16)
  })

  it('prefers the FantasyPros real-time board and falls back to Draft Wizard by size', () => {
    const snapshot = {
      fetchedAt: NOW,
      rows: [],
      sets: [
        { id: 'fantasypros-rtadp', rows: [{ name: 'Blended', team: 'SF', position: 'RB', adp: 1.4 }] },
        { id: 'draftwizard-adp-10', meta: { teams: 10 }, rows: [{ name: 'Ten', team: 'SF', position: 'RB', adp: 22 }] },
        { id: 'draftwizard-adp-12', meta: { teams: 12 }, rows: [{ name: 'Twelve', team: 'SF', position: 'RB', adp: 24 }] },
      ],
    }
    expect(liveAdpRowsForTeams(snapshot, 10)[0]?.name).toBe('Blended')
    expect(liveAdpRowsForTeams(snapshot, 12)[0]?.name).toBe('Blended')
    expect(liveAdpRowsForTeams({ fetchedAt: NOW, rows: [], sets: [snapshot.sets[1]!, snapshot.sets[2]!] }, 10)[0]?.name).toBe('Ten')
    expect(liveAdpRowsForTeams({ fetchedAt: NOW, rows: [], sets: [snapshot.sets[1]!, snapshot.sets[2]!] }, 12)[0]?.name).toBe('Twelve')
    expect(liveAdpRowsForTeams({ fetchedAt: NOW, rows: [], sets: [snapshot.sets[0]!] }, 10)[0]?.name).toBe('Blended')
  })

  it('picks the FantasyPros board that matches scoring, then Draft Wizard', () => {
    const snapshot = {
      fetchedAt: NOW,
      rows: [],
      sets: [
        { id: 'fantasypros-rtadp', rows: [{ name: 'HalfRT', team: 'SF', position: 'RB', adp: 1 }] },
        { id: 'fantasypros-rtadp-ppr', rows: [{ name: 'PprRT', team: 'SF', position: 'RB', adp: 2 }] },
        { id: 'fantasypros-rtadp-dynasty', rows: [{ name: 'DynastyRT', team: 'SF', position: 'RB', adp: 3 }] },
        { id: 'draftwizard-adp-12', meta: { teams: 12, scoring: 'half' }, rows: [{ name: 'HalfDW', team: 'SF', position: 'RB', adp: 10 }] },
        { id: 'draftwizard-adp-ppr-12', meta: { teams: 12, scoring: 'ppr' }, rows: [{ name: 'PprDW', team: 'SF', position: 'RB', adp: 11 }] },
        { id: 'draftwizard-adp-std-10', meta: { teams: 10, scoring: 'std' }, rows: [{ name: 'StdDW', team: 'SF', position: 'RB', adp: 12 }] },
      ],
    }
    expect(liveAdpRowsForTeams(snapshot, 12, 'half_ppr')[0]?.name).toBe('HalfRT')
    expect(liveAdpRowsForTeams(snapshot, 12, 'ppr')[0]?.name).toBe('PprRT')
    expect(liveAdpRowsForTeams(snapshot, 10, 'std')[0]?.name).toBe('StdDW')
    expect(liveAdpRowsForTeams(snapshot, 12, 'dynasty')[0]?.name).toBe('DynastyRT')
    expect(liveAdpRowsForTeams({ fetchedAt: NOW, rows: [], sets: [snapshot.sets[1]!] }, 12, 'ppr')[0]?.name).toBe('PprRT')
  })

  it('attaches ADP from the matching size board', () => {
    const snapshot = {
      fetchedAt: NOW,
      rows: [],
      sets: [
        { id: 'draftwizard-adp-10', meta: { teams: 10 }, rows: [{ name: 'Christian McCaffrey', team: 'SF', position: 'RB', adp: 18, espnId: '4034' }] },
        { id: 'draftwizard-adp-12', meta: { teams: 12 }, rows: [{ name: 'Christian McCaffrey', team: 'SF', position: 'RB', adp: 22, espnId: '4034' }] },
      ],
    }
    expect(applyLiveAdp(players, snapshot, 10)[0]?.liveAdp).toBe(18)
    expect(applyLiveAdp(players, snapshot, 12)[0]?.liveAdp).toBe(22)
  })

  it('attaches ADP from the matching scoring board', () => {
    const snapshot = {
      fetchedAt: NOW,
      rows: [],
      sets: [
        { id: 'draftwizard-adp-12', meta: { teams: 12, scoring: 'half' }, rows: [{ name: 'Christian McCaffrey', team: 'SF', position: 'RB', adp: 22, espnId: '4034' }] },
        { id: 'draftwizard-adp-ppr-12', meta: { teams: 12, scoring: 'ppr' }, rows: [{ name: 'Christian McCaffrey', team: 'SF', position: 'RB', adp: 18, espnId: '4034' }] },
      ],
    }
    expect(applyLiveAdp(players, snapshot, 12, 'half_ppr')[0]?.liveAdp).toBe(22)
    expect(applyLiveAdp(players, snapshot, 12, 'ppr')[0]?.liveAdp).toBe(18)
  })

  it('maps league scoring labels onto the collected format slugs', () => {
    expect(liveAdpScoringSlug('half_ppr')).toBe('half')
    expect(liveAdpScoringSlug('ppr')).toBe('ppr')
    expect(liveAdpScoringSlug('std')).toBe('std')
    expect(liveAdpScoringSlug('standard')).toBe('std')
    expect(liveAdpScoringSlug('redraft-ppr')).toBe('ppr')
    expect(liveAdpScoringSlug('dynasty')).toBe('dynasty')
    expect(liveAdpScoringSlug(undefined)).toBe('half')
    expect(draftWizardAdpSetId(12, 'ppr')).toBe('draftwizard-adp-ppr-12')
    expect(fantasyProsRtAdpSetId('std')).toBe('fantasypros-rtadp-std')
    expect(fantasyProsRtAdpSetId('half_ppr')).toBe('fantasypros-rtadp')
  })
})

describe('live ADP snapshot', () => {
  beforeEach(() => {
    vi.mocked(readRankingArtifact).mockReset()
  })

  it('attaches board positions by ESPN id and by name/team/position, leaving the rest blank', () => {
    const result = applyLiveAdp(players, snapshot([
      { name: 'Christian McCaffrey', team: 'SF', position: 'RB', adp: 1.4, espnId: '4034' },
      { name: 'Jordan Addison', team: 'MIN', position: 'WR', adp: 58.2 },
    ]))
    expect(result[0]?.liveAdp).toBe(1.4)
    expect(result[1]?.liveAdp).toBe(58.2)
    expect(result[2]?.liveAdp).toBeUndefined()
    expect(result[0]).not.toBe(players[0])
  })

  it('carries FantasyPros last-1 and last-7 windows onto the matched player', () => {
    const result = applyLiveAdp(players, {
      fetchedAt: NOW,
      rows: [],
      sets: [{
        id: 'fantasypros-rtadp',
        meta: { lastUpdated: '2026-08-22 12:20:04' },
        rows: [{
          name: 'Christian McCaffrey', team: 'SF', position: 'RB', adp: 1.4, espnId: '4034',
          adpLastOne: 2.1, adpLastSeven: 1.8, adpVsLastOne: 0.7, adpVsLastSeven: 0.4,
        }],
      }],
    })
    expect(result[0]).toMatchObject({
      liveAdp: 1.4,
      liveAdpLastOne: 2.1,
      liveAdpLastSeven: 1.8,
      liveAdpVsLastOne: 0.7,
      liveAdpVsLastSeven: 0.4,
      liveAdpPublishedAt: Date.parse('2026-08-22T12:20:04-04:00'),
    })
  })

  it('does not attach leftover live ADP to an unsigned free agent', () => {
    const unsigned: Player = {
      ...players[0]!,
      id: 'fa',
      team: null,
      espnId: '4034',
    }
    const result = applyLiveAdp([unsigned], snapshot([
      { name: 'Christian McCaffrey', team: 'SF', position: 'RB', adp: 1.4, espnId: '4034' },
    ]))
    expect(result[0]?.liveAdp).toBeUndefined()
  })

  it('leaves the roster untouched without a snapshot', () => {
    expect(applyLiveAdp(players, null)).toBe(players)
    expect(applyLiveAdp(players, undefined)).toBe(players)
    expect(applyLiveAdp(players, snapshot([]))).toBe(players)
  })

  it('loads the adp-latest artifact rows', async () => {
    vi.mocked(readRankingArtifact).mockResolvedValue({
      fetchedAt: 5,
      sets: [{ rows: [{ name: 'Christian McCaffrey', team: 'SF', position: 'RB', adp: 1.4 }] }],
    })
    const loaded = await fetchLiveAdpSnapshot()
    expect(loaded?.fetchedAt).toBe(5)
    expect(loaded?.rows).toHaveLength(1)
    expect(readRankingArtifact).toHaveBeenCalledWith('adp-latest', 'rankings/adp-latest.json', expect.objectContaining({ cache: 'no-store' }))
  })

  it('returns null when the snapshot is missing or the request fails', async () => {
    vi.mocked(readRankingArtifact).mockResolvedValue(null)
    expect(await fetchLiveAdpSnapshot()).toBeNull()
    vi.mocked(readRankingArtifact).mockRejectedValue(new Error('offline'))
    expect(await fetchLiveAdpSnapshot()).toBeNull()
  })

  it('rethrows an abort so cancelled queries do not read as missing data', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.mocked(readRankingArtifact).mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(fetchLiveAdpSnapshot(controller.signal)).rejects.toThrow()
  })
})

describe('a stale board is not a live board', () => {
  const rows = [{ name: 'Houston Texans', team: 'HOU', position: 'DEF', espnId: '-16034', adp: 83, overall: 83 }]
  const texans: Player = {
    id: '-16034', espnId: '-16034', firstName: 'Texans', lastName: 'D/ST', fullName: 'Texans D/ST',
    position: 'DEF', team: 'HOU', searchRank: 199, injuryStatus: null, number: null, yearsExp: null, bye: null,
  }
  const snapshot = (ageMs: number): LiveAdpSnapshot => ({ fetchedAt: Date.now() - ageMs, rows })

  it('applies a board collected minutes ago', () => {
    expect(applyLiveAdp([texans], snapshot(10 * 60_000))[0]!.liveAdp).toBe(83)
  })

  it('attaches Houston Texans ADP to Texans D/ST when the board has no ESPN id', () => {
    const board = snapshot(10 * 60_000)
    board.rows = [{ name: 'Houston Texans', team: 'HOU', position: 'DEF', adp: 105.6, overall: 102 }]
    expect(applyLiveAdp([texans], board)[0]!.liveAdp).toBe(105.6)
  })

  it('ignores one collected days ago', () => {
    expect(applyLiveAdp([texans], snapshot(3 * 24 * 60 * 60_000))[0]!.liveAdp).toBeUndefined()
  })

  it('ignores one with no timestamp at all', () => {
    expect(applyLiveAdp([texans], { fetchedAt: 0, rows })[0]!.liveAdp).toBeUndefined()
  })

  it('reports freshness on its own', () => {
    expect(isLiveAdpFresh(snapshot(60_000))).toBe(true)
    expect(isLiveAdpFresh(snapshot(LIVE_ADP_MAX_AGE_MS + 60_000))).toBe(false)
    expect(isLiveAdpFresh(null)).toBe(false)
  })
})

describe('live ADP change display', () => {
  it('prints FantasyPros vs as an earlier/later arrow', () => {
    expect(formatLiveAdpChange(9.3)).toBe('↑ 9.3')
    expect(formatLiveAdpChange(-5)).toBe('↓ 5.0')
    expect(formatLiveAdpChange(0)).toBe('0.0')
    expect(formatLiveAdpChange(null)).toBe('—')
    expect(liveAdpChangeTone(9.3)).toBe('cc-up')
    expect(liveAdpChangeTone(-5)).toBe('cc-down')
    expect(liveAdpChangeTone(0)).toBe('')
  })
})
