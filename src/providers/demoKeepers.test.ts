import { describe, expect, it } from 'vitest'
import { demoProvider, demoTick, initDemoDraft, type MockLeagueTemplate } from './demoProvider'
import { keeperPicks } from '../draft/keepers'
import type { KeeperEntry, Player } from './types'

const players = Array.from({ length: 400 }, (_, i) => ({
  id: String(i + 1), sleeperId: String(i + 1),
  firstName: 'P', lastName: String(i + 1), fullName: `Player ${i + 1}`,
  position: (['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const)[i % 6],
  team: 'CHI', searchRank: i + 1, adp: i + 1,
  injuryStatus: null, number: null, yearsExp: 3, bye: null,
})) as unknown as Player[]
const byId = new Map(players.map((p) => [p.id, p]))

async function seededRoom(costRoundPicks: boolean, round: number | null = 1) {
  initDemoDraft({ teams: 12, rounds: 15, yourSlot: 5, autoPickYourPicks: true, rng: () => 0.5 })
  const base = await demoProvider.getDraft('local', 'you')
  const keepers: KeeperEntry[] = base.order.map((slot, i) => ({
    playerId: String(i + 1), rosterId: slot.rosterId, round, source: 'manual' as const,
  }))
  const seeded = keeperPicks(keepers, base, [], byId, { costRoundPicks })
  initDemoDraft({ teams: 12, rounds: 15, yourSlot: 5, autoPickYourPicks: true, rng: () => 0.5, keeperPicks: seeded })
  return { keepers, keptIds: keepers.map((k) => k.playerId) }
}

describe('mock draft with keepers', () => {
  it('keeps every keeper on the board through a full draft', async () => {
    const { keptIds } = await seededRoom(true)
    for (let i = 0; i < 12 * 15; i++) demoTick(players, keptIds)
    const board = await demoProvider.getPicks('local')

    expect(board.filter((p) => p.isKeeper)).toHaveLength(12)
    for (const id of keptIds) expect(board.some((p) => p.playerId === id)).toBe(true)
  })

  it('reserves the pick each keeper costs instead of drafting over it', async () => {
    const { keptIds } = await seededRoom(true)
    for (let i = 0; i < 40; i++) demoTick(players, keptIds)
    const board = await demoProvider.getPicks('local')

    // Round 1 is entirely keepers; the simulation starts at pick 13.
    expect(board.filter((p) => p.pickNo <= 12).every((p) => p.isKeeper)).toBe(true)
    const numbers = board.map((p) => p.pickNo)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('never lets the simulation draft a kept player', async () => {
    const { keptIds } = await seededRoom(true)
    for (let i = 0; i < 12 * 15; i++) demoTick(players, keptIds)
    const board = await demoProvider.getPicks('local')
    const drafted = board.filter((p) => !p.isKeeper).map((p) => p.playerId)
    expect(drafted.filter((id) => keptIds.includes(id))).toEqual([])
  })

  it('ends the draft a round early when keepers cost round picks', async () => {
    const { keptIds } = await seededRoom(true)
    for (let i = 0; i < 12 * 15 + 20; i++) demoTick(players, keptIds)
    const board = await demoProvider.getPicks('local')
    expect(board).toHaveLength(12 * 15)
    expect((await demoProvider.getDraft('local', 'you')).status).toBe('complete')
  })

  it('still runs every round when keepers do not cost a pick', async () => {
    const { keptIds } = await seededRoom(false)
    for (let i = 0; i < 12 * 15 + 20; i++) demoTick(players, keptIds)
    const board = await demoProvider.getPicks('local')
    expect(board.filter((p) => p.isKeeper)).toHaveLength(12)
    // 12 off-board keepers plus a full snake.
    expect(board.filter((p) => !p.isKeeper)).toHaveLength(12 * 15)
  })

  it('honours the round a keeper was priced at', async () => {
    const { keptIds } = await seededRoom(true, 3)
    for (let i = 0; i < 40; i++) demoTick(players, keptIds)
    const board = await demoProvider.getPicks('local')
    const keeperRounds = board.filter((p) => p.isKeeper).map((p) => p.round)
    expect([...new Set(keeperRounds)]).toEqual([3])
    expect(board.filter((p) => p.pickNo <= 12).every((p) => !p.isKeeper)).toBe(true)
  })

  it('runs the mock against a real league’s teams and roster ids', async () => {
    const template: MockLeagueTemplate = {
      name: 'Sunday Money',
      teams: 4,
      rounds: 5,
      scoringType: 'half_ppr',
      slots: { QB: 1, RB: 1, WR: 1, TE: 0, FLEX: 0, SUPER_FLEX: 0, K: 0, DEF: 0, BN: 2 },
      rosterPositions: ['QB', 'RB', 'WR', 'BN', 'BN'],
      order: [
        { slot: 1, rosterId: 'r-88', userId: 'u1', displayName: 'Ann', teamName: 'Ann FC', isYou: false },
        { slot: 2, rosterId: 'r-91', userId: 'u2', displayName: 'You', teamName: 'My Team', isYou: true },
        { slot: 3, rosterId: 'r-14', userId: 'u3', displayName: 'Cy', teamName: 'Cy XI', isYou: false },
        { slot: 4, rosterId: 'r-77', userId: 'u4', displayName: 'Dee', teamName: 'Dee United', isYou: false },
      ],
      yourUserId: 'u2',
      yourSlot: 2,
      keeperCount: 1,
    }

    const keepers: KeeperEntry[] = [
      { playerId: '1', rosterId: 'r-91', round: 1, source: 'manual' },
      { playerId: '2', rosterId: 'r-14', round: 2, source: 'manual' },
    ]
    initDemoDraft({ template })
    const base = await demoProvider.getDraft('local', 'you')
    const seeded = keeperPicks(keepers, base, [], byId, { costRoundPicks: true })
    initDemoDraft({ template, keeperPicks: seeded, rng: () => 0.5 })

    const session = await demoProvider.getDraft('local', 'you')
    expect(session.name).toBe('Sunday Money (mock)')
    expect(session.teams).toBe(4)
    expect(session.rounds).toBe(5)
    expect(session.scoringType).toBe('half_ppr')
    expect(session.order.map((s) => s.rosterId)).toEqual(['r-88', 'r-91', 'r-14', 'r-77'])
    expect(session.yourSlot).toBe(2)

    for (let i = 0; i < 4 * 5; i++) demoTick(players, ['1', '2'])
    const board = await demoProvider.getPicks('local')
    expect(board).toHaveLength(4 * 5)
    expect(board.find((p) => p.playerId === '1')).toMatchObject({ isKeeper: true, rosterId: 'r-91' })
    expect(board.find((p) => p.playerId === '2')).toMatchObject({ isKeeper: true, rosterId: 'r-14' })
  })

  it('ignores a keeper whose roster is not in the room', async () => {
    initDemoDraft({ teams: 12, rounds: 15, rng: () => 0.5, keeperPicks: [
      { playerId: '9', pickedByUserId: null, rosterId: 'not-in-this-league', round: 1, draftSlot: 1, pickNo: 1, isKeeper: true, meta: null },
    ] })
    const board = await demoProvider.getPicks('local')
    expect(board).toHaveLength(0)
  })
})
