import { describe, expect, it } from 'vitest'
import {
  buildSleeperPickOwners,
  detectLeagueFormat,
  isSleeperMock,
  sleeperClockEndsAt,
  sleeperParentLeagueId,
  sleeperSlotForPick,
} from './sleeperBoard'

describe('sleeperSlotForPick', () => {
  it('snakes even rounds and stays linear on odd ones', () => {
    expect(sleeperSlotForPick(1, 12, 'snake')).toBe(1)
    expect(sleeperSlotForPick(12, 12, 'snake')).toBe(12)
    expect(sleeperSlotForPick(13, 12, 'snake')).toBe(12)
    expect(sleeperSlotForPick(24, 12, 'snake')).toBe(1)
    expect(sleeperSlotForPick(25, 12, 'snake')).toBe(1)
  })

  it('reverses again at the start of the configured reversal round', () => {
    // 3RR: rounds 1-2 are a normal snake; round 3 goes 12→1 instead of 1→12.
    expect(sleeperSlotForPick(24, 12, 'snake', 3)).toBe(1)
    expect(sleeperSlotForPick(25, 12, 'snake', 3)).toBe(12)
    expect(sleeperSlotForPick(36, 12, 'snake', 3)).toBe(1)
    expect(sleeperSlotForPick(37, 12, 'snake', 3)).toBe(1)
    expect(sleeperSlotForPick(48, 12, 'snake', 3)).toBe(12)
  })

  it('keeps the same order every linear round', () => {
    expect(sleeperSlotForPick(13, 12, 'linear')).toBe(1)
    expect(sleeperSlotForPick(25, 12, 'linear', 3)).toBe(1)
  })
})

describe('buildSleeperPickOwners', () => {
  const slotToRosterId = { '1': 10, '8': 2, '12': 9 }

  it('stays silent on a plain snake so callers keep using snake math', () => {
    expect(buildSleeperPickOwners({ teams: 12, rounds: 15, type: 'snake' })).toBeNull()
  })

  it('publishes a 3RR board', () => {
    const owners = buildSleeperPickOwners({
      teams: 12, rounds: 4, type: 'snake', reversalRound: 3,
    })
    expect(owners?.[0]).toBe(1)
    expect(owners?.[12]).toBe(12)
    expect(owners?.[24]).toBe(12)
    expect(owners?.[36]).toBe(1)
  })

  it('moves a traded round to the current owner\'s slot', () => {
    const owners = buildSleeperPickOwners({
      teams: 12,
      rounds: 4,
      type: 'snake',
      slotToRosterId,
      tradedPicks: [{ season: '2026', round: 3, roster_id: 10, owner_id: 2 }],
      season: '2026',
    })
    // Slot 1 / roster 10 originally owns 3.01 (pick 25). Roster 2 sits at slot 8.
    expect(owners?.[24]).toBe(8)
    expect(owners?.[0]).toBe(1)
  })

  it('ignores a trade from another season', () => {
    expect(buildSleeperPickOwners({
      teams: 12,
      rounds: 4,
      type: 'snake',
      slotToRosterId,
      tradedPicks: [{ season: '2025', round: 3, roster_id: 10, owner_id: 2 }],
      season: '2026',
    })).toBeNull()
  })

  it('returns null for auction rooms', () => {
    expect(buildSleeperPickOwners({
      teams: 12, rounds: 15, type: 'auction', reversalRound: 3,
    })).toBeNull()
  })
})

describe('sleeperClockEndsAt', () => {
  it('adds the pick timer to the last pick in a live room', () => {
    expect(sleeperClockEndsAt({
      status: 'drafting',
      start_time: 1_700_000_000_000,
      last_picked: 1_700_000_010_000,
      settings: { pick_timer: 90 },
    })).toBe(1_700_000_100_000)
  })

  it('uses start_time before anyone has picked', () => {
    expect(sleeperClockEndsAt({
      status: 'drafting',
      start_time: 1_700_000_000_000,
      settings: { pick_timer: 120 },
    })).toBe(1_700_000_120_000)
  })

  it('stays quiet when the room is not live or has no timer', () => {
    expect(sleeperClockEndsAt({
      status: 'pre_draft',
      start_time: 1_700_000_000_000,
      settings: { pick_timer: 90 },
    })).toBeNull()
    expect(sleeperClockEndsAt({
      status: 'drafting',
      start_time: 1_700_000_000_000,
      settings: { pick_timer: 0 },
    })).toBeNull()
  })
})

describe('detectLeagueFormat', () => {
  it('reads an explicit chopped flag or the league name', () => {
    expect(detectLeagueFormat({ name: 'Home', settings: { chopped: 1 } })).toBe('chopped')
    expect(detectLeagueFormat({ name: 'Tuesday Chopped League', settings: {} })).toBe('chopped')
    expect(detectLeagueFormat({
      name: 'LMS',
      settings: {},
      metadata: { description: 'Last man standing' },
    })).toBe('chopped')
  })

  it('reads Sleeper type 3 even when the name is ordinary and keepers are on', () => {
    // Wisconsin Dudes, league 1401696318404952064: chopped, named like a
    // redraft, and max_keepers: 1 so a keeper check-first would mislabel it.
    expect(detectLeagueFormat({
      name: 'Wisconsin Dudes',
      settings: { type: 3, max_keepers: 1, last_chopped_leg: 17, playoff_week_start: 0 },
    })).toBe('chopped')
    expect(detectLeagueFormat(
      { name: 'Wisconsin Dudes', settings: { max_keepers: 1 } },
      { metadata: { league_type: '3', name: 'Wisconsin Dudes' } },
    )).toBe('chopped')
    expect(detectLeagueFormat({
      name: 'Wisconsin Dudes',
      settings: { last_chopped_leg: 17, max_keepers: 1 },
    })).toBe('chopped')
  })

  it('keeps dynasty / keeper / best-ball distinct from chopped', () => {
    expect(detectLeagueFormat({ name: 'Deep', settings: { type: 2 } })).toBe('dynasty')
    expect(detectLeagueFormat({ name: 'Keep', settings: { type: 1 } })).toBe('keeper')
    expect(detectLeagueFormat({ name: 'BB', settings: { best_ball: 1 } })).toBe('best_ball')
    expect(detectLeagueFormat({ name: 'Redraft Royale', settings: {} })).toBe('redraft')
  })
})

describe('Sleeper league mocks', () => {
  it('treats a null league_id plus type league_mock as practice', () => {
    const draft = {
      league_id: null,
      metadata: { type: 'league_mock', league_id: '1401696318404952064', league_type: '3' },
    }
    expect(isSleeperMock(draft)).toBe(true)
    expect(sleeperParentLeagueId(draft)).toBe('1401696318404952064')
    expect(detectLeagueFormat({ name: 'Wisconsin Dudes', settings: {} }, draft)).toBe('chopped')
  })

  it('keeps a real league draft off the mock path', () => {
    expect(isSleeperMock({ league_id: 'L1', metadata: { name: 'Home' } })).toBe(false)
    expect(sleeperParentLeagueId({ league_id: 'L1', metadata: { league_id: 'other' } })).toBe('L1')
  })
})
