import { beforeEach, describe, expect, it } from 'vitest'
import {
  keeperPicks,
  keeperRoom,
  loadKeepersCostRoundPicks,
  mergeKeepers,
  occupiedPickNumbers,
  removeKeeper,
  replaceKeepersFromSource,
  saveKeepersCostRoundPicks,
  upsertKeeper,
  withKeeperPicks,
} from './keepers'
import { nextOpenPickNumber, picksUntilSlot } from './snake'
import { defaultSlotCounts, type DraftPick, type DraftSession, type KeeperEntry } from '../providers/types'

function session(overrides: Partial<DraftSession> = {}): DraftSession {
  const teams = overrides.teams ?? 4
  return {
    provider: 'espn',
    draftId: '2026:1',
    leagueId: '1',
    name: 'Keeper League',
    type: 'snake',
    status: 'pre_draft',
    season: '2026',
    scoringType: 'ppr',
    teams,
    rounds: 5,
    pickTimer: null,
    slots: defaultSlotCounts(),
    rosterPositions: [],
    order: Array.from({ length: teams }, (_, index) => ({
      slot: index + 1,
      rosterId: `t${index + 1}`,
      userId: `t${index + 1}`,
      displayName: `Team ${index + 1}`,
      teamName: `Team ${index + 1}`,
      isYou: index === 0,
    })),
    yourUserId: 't1',
    yourSlot: 1,
    startTime: null,
    ...overrides,
  }
}

const manual = (playerId: string, rosterId: string, round: number | null = null): KeeperEntry => ({
  playerId,
  rosterId,
  round,
  source: 'manual',
})

describe('mergeKeepers', () => {
  it('lets the league site overwrite a hand-entered keeper', () => {
    const { keepers } = mergeKeepers(
      [manual('p1', 't1', 3)],
      [{ playerId: 'p1', rosterId: 't2', round: 5, source: 'espn' }],
    )
    expect(keepers).toEqual([{ playerId: 'p1', rosterId: 't2', round: 5, source: 'espn' }])
  })

  it('reports a team disagreement as a conflict', () => {
    const { conflicts } = mergeKeepers(
      [manual('p1', 't1', 3)],
      [{ playerId: 'p1', rosterId: 't2', round: 3, source: 'espn' }],
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.reason).toBe('team')
  })

  it('reports a round disagreement as a conflict', () => {
    const { conflicts } = mergeKeepers(
      [manual('p1', 't1', 3)],
      [{ playerId: 'p1', rosterId: 't1', round: 6, source: 'espn' }],
    )
    expect(conflicts[0]?.reason).toBe('round')
  })

  it('stays quiet when the site simply prices an entry you left open', () => {
    const { conflicts, keepers } = mergeKeepers(
      [manual('p1', 't1', null)],
      [{ playerId: 'p1', rosterId: 't1', round: 4, source: 'espn' }],
    )
    expect(conflicts).toEqual([])
    expect(keepers[0]?.round).toBe(4)
  })

  it('keeps entries neither side shares', () => {
    const { keepers } = mergeKeepers(
      [manual('p1', 't1')],
      [{ playerId: 'p2', rosterId: 't2', round: 1, source: 'espn' }],
    )
    expect(keepers.map((entry) => entry.playerId).sort()).toEqual(['p1', 'p2'])
  })
})

describe('replaceKeepersFromSource', () => {
  it('swaps one source and leaves the rest alone', () => {
    const entries: KeeperEntry[] = [
      manual('p1', 't1'),
      { playerId: 'p2', rosterId: 't2', round: 1, source: 'espn' },
    ]
    const next = replaceKeepersFromSource(entries, 'espn', [
      { playerId: 'p3', rosterId: 't3', round: 2, source: 'espn' },
    ])
    expect(next.map((entry) => entry.playerId).sort()).toEqual(['p1', 'p3'])
  })
})

describe('upsertKeeper / removeKeeper', () => {
  it('replaces rather than duplicates a player', () => {
    const next = upsertKeeper([manual('p1', 't1', 2)], manual('p1', 't2', 4))
    expect(next).toHaveLength(1)
    expect(next[0]?.rosterId).toBe('t2')
  })

  it('drops a player', () => {
    expect(removeKeeper([manual('p1', 't1')], 'p1')).toEqual([])
  })
})

describe('keeperPicks', () => {
  it('puts a priced keeper on its team’s pick in that round', () => {
    const picks = keeperPicks([manual('p1', 't2', 3)], session())
    expect(picks).toHaveLength(1)
    // Round 3 is odd, so slot 2 picks 10th in a 4-team draft.
    expect(picks[0]).toMatchObject({ pickNo: 10, round: 3, draftSlot: 2, isKeeper: true })
  })

  it('snakes even rounds', () => {
    const picks = keeperPicks([manual('p1', 't1', 2)], session())
    expect(picks[0]?.pickNo).toBe(8)
  })

  it('gives unpriced keepers the team’s earliest rounds', () => {
    const picks = keeperPicks([manual('p1', 't1'), manual('p2', 't1')], session())
    expect(picks.map((pick) => pick.round)).toEqual([1, 2])
  })

  it('does not let an unpriced keeper squat on a round another keeper costs', () => {
    const picks = keeperPicks([manual('p1', 't1'), manual('p2', 't1', 1)], session())
    const rounds = picks.map((pick) => pick.round).sort()
    expect(rounds).toEqual([1, 2])
    expect(picks.find((pick) => pick.playerId === 'p2')?.round).toBe(1)
  })

  it('slides a second keeper off a round already spoken for', () => {
    const picks = keeperPicks([manual('p1', 't1', 3), manual('p2', 't1', 3)], session())
    expect(picks.map((pick) => pick.round).sort()).toEqual([3, 4])
  })

  it('ignores keepers for teams that are not in the draft', () => {
    expect(keeperPicks([manual('p1', 'ghost', 1)], session())).toEqual([])
  })

  it('yields to a player the draft already took', () => {
    const made: DraftPick[] = [{
      playerId: 'p1', pickedByUserId: 't3', rosterId: 't3', round: 1, draftSlot: 3, pickNo: 3, isKeeper: false, meta: null,
    }]
    expect(keeperPicks([manual('p1', 't1', 1)], session(), made)).toEqual([])
  })

  it('yields to a real pick already sitting on the slot', () => {
    const made: DraftPick[] = [{
      playerId: 'other', pickedByUserId: 't1', rosterId: 't1', round: 1, draftSlot: 1, pickNo: 1, isKeeper: false, meta: null,
    }]
    expect(keeperPicks([manual('p1', 't1', 1)], session(), made)).toEqual([])
  })

  it('clamps a round past the end of the draft', () => {
    const picks = keeperPicks([manual('p1', 't1', 99)], session())
    expect(picks[0]?.round).toBe(5)
  })
})

describe('keepers that do not cost a round', () => {
  it('keeps the player taken without occupying a snake slot', () => {
    const picks = keeperPicks([manual('p1', 't2', 3)], session(), [], undefined, { costRoundPicks: false })
    expect(picks).toHaveLength(1)
    expect(picks[0]).toMatchObject({ playerId: 'p1', draftSlot: 2, isKeeper: true })
    expect(picks[0]?.pickNo).toBeLessThan(1)
    expect(occupiedPickNumbers(picks).size).toBe(0)
  })

  it('leaves pick 1 open so the draft still starts on the clock', () => {
    const picks = withKeeperPicks([], [manual('p1', 't1', 1)], session(), undefined, { costRoundPicks: false })
    expect(nextOpenPickNumber(occupiedPickNumbers(picks), 20)).toBe(1)
  })

  it('lifts a site-published keeper off the board', () => {
    const made: DraftPick[] = [{
      playerId: 'p1', pickedByUserId: 't1', rosterId: 't1', round: 1, draftSlot: 1, pickNo: 1, isKeeper: true, meta: null,
    }]
    const merged = withKeeperPicks(made, [manual('p1', 't1', 1)], session(), undefined, { costRoundPicks: false })
    expect(merged.find((pick) => pick.playerId === 'p1')?.pickNo).toBeLessThan(1)
    expect(nextOpenPickNumber(occupiedPickNumbers(merged), 20)).toBe(1)
  })

  it('still counts a keeper slot as a wait when the rule is on', () => {
    const picks = withKeeperPicks([], [manual('p1', 't3', 1)], session())
    expect(picksUntilSlot(1, 4, 4, 5, 'snake', occupiedPickNumbers(picks))).toBe(2)
  })
})

describe('keepersCostRoundPicks preference', () => {
  beforeEach(() => {
    localStorage.removeItem('draft-assistant:keepers-cost-rounds:espn:1')
    localStorage.removeItem('draft-assistant:keepers-cost-rounds:other')
  })

  it('defaults to costing a round and persists the off switch', () => {
    expect(loadKeepersCostRoundPicks('espn:1')).toBe(true)
    saveKeepersCostRoundPicks('espn:1', false)
    expect(loadKeepersCostRoundPicks('espn:1')).toBe(false)
    expect(loadKeepersCostRoundPicks('other')).toBe(true)
  })
})

describe('withKeeperPicks', () => {
  it('returns made picks untouched when there are no keepers', () => {
    const made: DraftPick[] = []
    expect(withKeeperPicks(made, [], session())).toBe(made)
  })

  it('merges keepers into board order', () => {
    const made: DraftPick[] = [{
      playerId: 'a', pickedByUserId: 't1', rosterId: 't1', round: 1, draftSlot: 1, pickNo: 1, isKeeper: false, meta: null,
    }]
    const merged = withKeeperPicks(made, [manual('p1', 't2', 1)], session())
    expect(merged.map((pick) => pick.pickNo)).toEqual([1, 2])
  })
})

describe('pick numbering around keepers', () => {
  it('skips keeper-consumed slots when finding the next pick', () => {
    const picks = withKeeperPicks([], [manual('p1', 't1', 1)], session())
    expect(nextOpenPickNumber(picks.map((pick) => pick.pickNo), 20)).toBe(2)
  })

  it('does not count a keeper slot as a wait', () => {
    const picks = withKeeperPicks([], [manual('p1', 't3', 1)], session())
    const taken = new Set(picks.map((pick) => pick.pickNo))
    // Picks 1 and 2 are live, pick 3 is kept, so slot 4 is two picks away.
    expect(picksUntilSlot(1, 4, 4, 5, 'snake', taken)).toBe(2)
  })

  it('matches the old behaviour when nothing is kept', () => {
    expect(picksUntilSlot(1, 4, 4, 5, 'snake')).toBe(3)
  })
})

describe('keeperRoom', () => {
  it('counts down from the league limit', () => {
    expect(keeperRoom([manual('p1', 't1'), manual('p2', 't1')], 't1', 3)).toBe(1)
  })

  it('is unlimited when the league does not say', () => {
    expect(keeperRoom([manual('p1', 't1')], 't1', null)).toBeNull()
  })
})
