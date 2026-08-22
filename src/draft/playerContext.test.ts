import { describe, expect, it } from 'vitest'
import { marketBaseline, playerDraftContext, suggestionGlance } from './playerContext'
import { defaultSlotCounts, type DraftPick, type Player, type SlotCounts } from '../providers/types'

function player(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    firstName: 'Test',
    lastName: 'Back',
    fullName: 'Test Back',
    position: 'RB',
    team: 'CHI',
    searchRank: 10,
    injuryStatus: null,
    number: null,
    yearsExp: 3,
    bye: 7,
    ...overrides,
  }
}

function pool(): Player[] {
  return [
    player({ id: 'rb1', searchRank: 1, tier: 1 }),
    player({ id: 'rb2', searchRank: 2, tier: 1 }),
    player({ id: 'rb3', searchRank: 3, tier: 2 }),
    player({ id: 'rb4', searchRank: 4, tier: 2 }),
    player({ id: 'wr1', position: 'WR', searchRank: 5, tier: 1 }),
  ]
}

const pick = (playerId: string, overrides: Partial<DraftPick> = {}): DraftPick => ({
  playerId,
  pickedByUserId: null,
  rosterId: null,
  round: 1,
  draftSlot: 1,
  pickNo: 1,
  isKeeper: false,
  meta: null,
  ...overrides,
})

function context(options: {
  target: Player
  players?: Player[]
  picks?: DraftPick[]
  slots?: SlotCounts
  yourSlot?: number | null
  currentPickNo?: number
  yourNextPickNo?: number | null
  teamNameBySlot?: Map<number, string>
}) {
  return playerDraftContext({
    player: options.target,
    players: options.players ?? pool(),
    picks: options.picks ?? [],
    slots: options.slots ?? defaultSlotCounts(),
    yourSlot: options.yourSlot ?? 1,
    currentPickNo: options.currentPickNo ?? 5,
    yourNextPickNo: options.yourNextPickNo ?? null,
    teamNameBySlot: options.teamNameBySlot,
  })
}

describe('marketBaseline', () => {
  it('prefers the live board over a preseason ADP', () => {
    expect(marketBaseline(player({ liveAdp: 14.2, adp: 22.5, searchRank: 10 })))
      .toEqual({ value: 14.2, source: 'live ADP' })
  })

  it('falls back to season ADP when the live board does not cover him', () => {
    expect(marketBaseline(player({ liveAdp: null, adp: 22.5, searchRank: 10 })))
      .toEqual({ value: 22.5, source: 'ADP' })
  })

  it('ignores a live value outside the draftable range', () => {
    expect(marketBaseline(player({ liveAdp: 0, adp: 22.5 }))).toEqual({ value: 22.5, source: 'ADP' })
    expect(marketBaseline(player({ liveAdp: 9999, adp: 22.5 }))).toEqual({ value: 22.5, source: 'ADP' })
  })

  it('prefers a reported ADP', () => {
    expect(marketBaseline(player({ adp: 22.5, searchRank: 10 }))).toEqual({ value: 22.5, source: 'ADP' })
  })

  it('never stands a rank in for a draft position', () => {
    // A consensus rank is an ordering, not a pick number, and every caller
    // compares this against one. Unknown has to read as unknown.
    expect(marketBaseline(player({ searchRank: 10 }))).toBeNull()
    expect(marketBaseline(player({ searchRank: 1, adp: null, liveAdp: null }))).toBeNull()
  })

  it('reports nothing for an unranked player', () => {
    expect(marketBaseline(player({ searchRank: 0 }))).toBeNull()
  })
})

describe('suggestionGlance', () => {
  it('labels the live board and scores it against the pick on the clock', () => {
    expect(suggestionGlance(player({ liveAdp: 14.2, adp: 22.5, vorp: 8 }), 20)).toMatchObject({
      team: 'CHI',
      liveAdp: 14.2,
      adp: 22.5,
      vorp: 8,
      marketSource: 'live ADP',
      marketValue: 14.2,
      vsPick: 6,
    })
  })

  it('falls back to season ADP when the live board is missing', () => {
    expect(suggestionGlance(player({ adp: 22.5 }), 18)).toMatchObject({
      marketSource: 'ADP',
      marketValue: 22.5,
      vsPick: -4,
      liveAdp: null,
    })
  })

  it('keeps VORP when there is no market number to show', () => {
    expect(suggestionGlance(player({ vorp: 11.4 }), 8)).toMatchObject({
      marketSource: null,
      marketValue: null,
      vsPick: null,
      vorp: 11.4,
    })
  })
})

describe('playerDraftContext', () => {
  it('ranks him among the players left at his position', () => {
    const players = pool()
    const result = context({ target: players[2], players, picks: [pick('rb1')] })
    expect(result.positionRank).toBe(2)
    expect(result.positionDrafted).toBe(1)
  })

  it('counts his tier down as the tier empties', () => {
    const players = pool()
    expect(context({ target: players[0], players }).tierRemaining).toBe(2)
    expect(context({ target: players[0], players, picks: [pick('rb2')] }).tierRemaining).toBe(1)
  })

  it('leaves tier empty when the player has none', () => {
    expect(context({ target: player({ tier: null }) }).tierRemaining).toBeNull()
  })

  it('reads value against the pick on the clock', () => {
    const result = context({ target: player({ adp: 20 }), currentPickNo: 30 })
    expect(result.valueVsPick).toBe(10)
    expect(result.baselineSource).toBe('ADP')
  })

  it('leaves value and survival unknown with no market for him', () => {
    const result = context({ target: player({ searchRank: 20 }), currentPickNo: 30, yourNextPickNo: 50 })
    expect(result.valueVsPick).toBeNull()
    expect(result.baselineSource).toBeNull()
    expect(result.lastsUntilYourPick).toBeNull()
    expect(result.survivalProbability).toBeNull()
  })

  it('says he lasts when the market takes him after your turn', () => {
    expect(context({ target: player({ adp: 40 }), currentPickNo: 5, yourNextPickNo: 20 }).lastsUntilYourPick).toBe(true)
    expect(context({ target: player({ adp: 12 }), currentPickNo: 5, yourNextPickNo: 20 }).lastsUntilYourPick).toBe(false)
  })

  it('stays silent about lasting when you have no next turn', () => {
    expect(context({ target: player({ adp: 40 }), yourNextPickNo: null }).lastsUntilYourPick).toBeNull()
  })

  it('reports the roster hole he fills', () => {
    const result = context({ target: player({ position: 'RB' }) })
    expect(result.need.kind).toBe('starter')
    expect(result.need.label).toBe('Fill RB1')
  })

  it('accounts for what you have already drafted', () => {
    const players = pool()
    const yours = [pick('rb1', { draftSlot: 1 }), pick('rb2', { draftSlot: 1, pickNo: 2 })]
    const result = context({ target: players[2], players, picks: yours, yourSlot: 1 })
    expect(result.need.kind).toBe('flex')
  })

  it('names who took him once he is off the board', () => {
    const players = pool()
    const result = context({
      target: players[0],
      players,
      picks: [pick('rb1', { draftSlot: 3, pickNo: 7, round: 1 })],
      teamNameBySlot: new Map([[3, 'Gridiron Gal']]),
    })
    expect(result.takenBy).toEqual({ pickNo: 7, round: 1, teamName: 'Gridiron Gal', isKeeper: false })
  })

  it('marks a keeper as kept rather than drafted', () => {
    const players = pool()
    const result = context({
      target: players[0],
      players,
      picks: [pick('rb1', { draftSlot: 2, pickNo: 2, isKeeper: true })],
    })
    expect(result.takenBy?.isKeeper).toBe(true)
    expect(result.takenBy?.teamName).toBe('Slot 2')
  })

  it('leaves takenBy empty while he is available', () => {
    expect(context({ target: player() }).takenBy).toBeNull()
  })
})
