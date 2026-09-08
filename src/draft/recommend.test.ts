import { describe, expect, it } from 'vitest'
import { recommendPicks, suggestionSet, liveAdpTrendAdjustment, type Recommendation } from './recommend'
import { defaultSlotCounts } from '../providers/types'
import type { DraftPick, Player } from '../providers/types'

function player(overrides: Partial<Player> & { id: string }): Player {
  return {
    firstName: overrides.id, lastName: '', fullName: overrides.id, position: 'RB', team: 'CHI',
    searchRank: 50, injuryStatus: null, number: null, yearsExp: null, bye: null,
    ...overrides,
  }
}

describe('recommendPicks', () => {
  it('ranks a higher-VORP player above a better-ranked player with lower VORP', () => {
    const players = [
      player({ id: 'low-vorp', position: 'RB', searchRank: 10, vorp: 5 }),
      player({ id: 'high-vorp', position: 'WR', searchRank: 20, vorp: 60 }),
    ]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 1 })
    expect(recs[0]?.player.id).toBe('high-vorp')
  })

  it('prefers the durable back when two studs project the same', () => {
    // The case this term exists for. VORP is a 17-game projection, so a back
    // who has missed 14 games in three years and one who has missed none score
    // identically on it -- and the board took the fragile one on rank.
    const fragile = player({
      id: 'fragile', position: 'RB', searchRank: 3, vorp: 100, age: 24,
      availability: { projectedAvailability: 0.82, gamesMissed: 14, seasons: 3 },
    })
    const durable = player({
      id: 'durable', position: 'RB', searchRank: 5, vorp: 96, age: 24,
      availability: { projectedAvailability: 0.93, gamesMissed: 0, seasons: 3 },
    })
    const recs = recommendPicks({
      players: [fragile, durable], picks: [], yourSlot: 1,
      slots: defaultSlotCounts(), currentPickNo: 1,
    })
    expect(recs[0]?.player.id).toBe('durable')
    expect(recs[1]?.reasons.some((reason) => reason.includes('14 games missed'))).toBe(true)
  })

  it('discounts an aging back against a younger one at the same projection', () => {
    const players = [
      player({ id: 'old', position: 'RB', searchRank: 3, vorp: 100, age: 31 }),
      player({ id: 'young', position: 'RB', searchRank: 8, vorp: 92, age: 23 }),
    ]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 1 })
    expect(recs[0]?.player.id).toBe('young')
  })

  it('leaves a player with no durability record unadjusted', () => {
    // Absent history is unknown, not clean -- a rookie must not be scored as
    // though he had proved anything either way.
    const rookie = player({ id: 'rookie', position: 'RB', searchRank: 3, vorp: 100, age: 22 })
    const recs = recommendPicks({
      players: [rookie], picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 1,
    })
    const labels = recs[0]!.breakdown.map((term) => term.label)
    expect(labels).not.toContain('Injury history')
    expect(labels).not.toContain('Age curve')
  })

  it('weights an injury history harder in a chopped league', () => {
    const fragile = {
      id: 'fragile', position: 'RB' as const, searchRank: 3, vorp: 100, age: 24,
      availability: { projectedAvailability: 0.82, gamesMissed: 14, seasons: 3 },
    }
    const options = {
      players: [player(fragile)], picks: [], yourSlot: 1,
      slots: defaultSlotCounts(), currentPickNo: 1,
    }
    const injuryTerm = (format: 'chopped' | null) => recommendPicks({ ...options, leagueFormat: format })[0]!
      .breakdown.find((term) => term.label === 'Injury history')!.delta
    expect(injuryTerm('chopped')).toBeLessThan(injuryTerm(null))
  })

  it('falls back to rank arithmetic for a player with no VORP', () => {
    const players = [
      player({ id: 'ranked', position: 'RB', searchRank: 5 }),
      player({ id: 'unranked', position: 'RB', searchRank: 9999 }),
    ]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 1 })
    expect(recs[0]?.player.id).toBe('ranked')
  })

  it('measures value against the live board, not search popularity', () => {
    // Search rank says pick 60 -- a reach at pick 40. The live board says he is
    // actually going around 20, so he is the bargain the room is about to take.
    const players = [player({ id: 'live-faller', searchRank: 60, liveAdp: 20 })]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 40 })
    expect(recs[0]?.reasons).toContain('Value vs live ADP')
  })

  it('does not call him a bargain on search rank alone', () => {
    const players = [player({ id: 'no-market', searchRank: 60 })]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 40 })
    expect(recs[0]?.reasons.some((reason) => reason.startsWith('Value vs'))).toBe(false)
  })

  it('prefers the live board over a stale season ADP', () => {
    const players = [player({ id: 'riser', searchRank: 12, adp: 12, liveAdp: 80 })]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 20 })
    // Live ADP 80 at pick 20 is a 60-pick reach; season ADP 12 would have
    // called it neutral. The reach penalty has to bite.
    expect(recs[0]?.reasons.some((reason) => reason.startsWith('Value vs'))).toBe(false)
    expect(recs[0]?.score).toBeLessThan(
      recommendPicks({
        players: [player({ id: 'riser', searchRank: 12, adp: 12 })],
        picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 20,
      })[0]!.score,
    )
  })

  it('flags the last available player in a tier', () => {
    const players = [
      player({ id: 'last-in-tier', position: 'WR', searchRank: 30, tier: 3 }),
      player({ id: 'has-tiermate', position: 'RB', searchRank: 31, tier: 2 }),
      player({ id: 'tiermate', position: 'RB', searchRank: 32, tier: 2 }),
    ]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 1 })
    const lastInTier = recs.find((r) => r.player.id === 'last-in-tier')
    const hasTiermate = recs.find((r) => r.player.id === 'has-tiermate')
    expect(lastInTier?.reasons).toContain('Last Tier 3 WR')
    expect(hasTiermate?.reasons).not.toContain('Last Tier 2 RB')
  })

  it('does not flag a tiermate once his group has already lost a member to another team', () => {
    const players = [
      player({ id: 'survivor', position: 'RB', searchRank: 10, tier: 1 }),
      player({ id: 'drafted', position: 'RB', searchRank: 11, tier: 1 }),
    ]
    const picks: DraftPick[] = [{ playerId: 'drafted', pickedByUserId: null, rosterId: null, round: 1, draftSlot: 2, pickNo: 1, isKeeper: false, meta: null }]
    const recs = recommendPicks({ players, picks, yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 2 })
    expect(recs.find((r) => r.player.id === 'survivor')?.reasons).toContain('Last Tier 1 RB')
  })

  it('flags a player unlikely to still be there when scoring the next seat', () => {
    const players = [
      // adp 15, tight spread -- almost certainly gone by pick 40.
      player({ id: 'wont-last', position: 'WR', searchRank: 15, adp: 15, rankLow: 13, rankHigh: 17 }),
      // adp 60, tight spread -- almost certainly still there at pick 40.
      player({ id: 'will-last', position: 'WR', searchRank: 60, adp: 60, rankLow: 58, rankHigh: 62, vorp: 40 }),
    ]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 20, yourNextPickNo: 40 })
    const wontLast = recs.find((r) => r.player.id === 'wont-last')
    expect(wontLast?.survivalProbability).toBeLessThan(0.1)
    expect(wontLast?.reasons.some((reason) => reason.includes('gone by your pick'))).toBe(true)
  })

  it('models survival from ADP when no expert range is published', () => {
    const players = [player({ id: 'solo', position: 'RB', searchRank: 5, adp: 5 })]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 1, yourNextPickNo: 20 })
    expect(recs[0]?.survivalProbability).not.toBeNull()
    expect(recs[0]?.survivalProbability).toBeLessThan(0.2)
  })

  it('flags a position run once half the recent picks share it', () => {
    const players = [player({ id: 'rb-candidate', position: 'RB', searchRank: 20 })]
    const meta = (position: string) => ({ firstName: 'X', lastName: 'Y', position, team: null, injuryStatus: null })
    const picks: DraftPick[] = [
      { playerId: 'a', pickedByUserId: null, rosterId: null, round: 1, draftSlot: 2, pickNo: 1, isKeeper: false, meta: meta('RB') },
      { playerId: 'b', pickedByUserId: null, rosterId: null, round: 1, draftSlot: 3, pickNo: 2, isKeeper: false, meta: meta('RB') },
      { playerId: 'c', pickedByUserId: null, rosterId: null, round: 1, draftSlot: 4, pickNo: 3, isKeeper: false, meta: meta('WR') },
      { playerId: 'd', pickedByUserId: null, rosterId: null, round: 1, draftSlot: 5, pickNo: 4, isKeeper: false, meta: meta('QB') },
    ]
    const recs = recommendPicks({ players, picks, yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 5 })
    expect(recs[0]?.reasons).toContain('RB run')
  })

  it('penalizes stacking a third same-position player onto an already-shared bye week', () => {
    const players = [
      player({ id: 'rb1', position: 'RB', searchRank: 5, bye: 7 }),
      player({ id: 'rb2', position: 'RB', searchRank: 6, bye: 7 }),
      player({ id: 'candidate', position: 'RB', searchRank: 40, bye: 7 }),
    ]
    const picks: DraftPick[] = [
      { playerId: 'rb1', pickedByUserId: null, rosterId: null, round: 1, draftSlot: 1, pickNo: 1, isKeeper: false, meta: null },
      { playerId: 'rb2', pickedByUserId: null, rosterId: null, round: 2, draftSlot: 1, pickNo: 2, isKeeper: false, meta: null },
    ]
    const recs = recommendPicks({ players, picks, yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 3 })
    expect(recs.find((r) => r.player.id === 'candidate')?.reasons.some((reason) => reason.includes('on bye 7'))).toBe(true)
  })

  it('ranks the player who will still be there when the next seat is still ahead', () => {
    const players = [
      player({ id: 'will-last', position: 'WR', searchRank: 20, adp: 60, rankLow: 58, rankHigh: 62, vorp: 50 }),
      player({ id: 'wont-last', position: 'RB', searchRank: 25, adp: 15, rankLow: 13, rankHigh: 17, vorp: 42 }),
    ]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 20, yourNextPickNo: 40 })
    expect(recs[0]?.player.id).toBe('will-last')
    expect(recs.find((r) => r.player.id === 'wont-last')?.reasons.some((reason) => reason.includes('gone by your pick'))).toBe(true)
  })

  it('does not claim a fallen player is gone between back-to-back picks', () => {
    const recs = recommendPicks({
      players: [player({ id: 'fallen', position: 'WR', searchRank: 15, adp: 15, liveAdp: 15, rankLow: 13, rankHigh: 17, vorp: 40 })],
      picks: [],
      yourSlot: 1,
      slots: defaultSlotCounts(),
      currentPickNo: 20,
      yourNextPickNo: 20,
      yourFollowingPickNo: 21,
    })
    expect(recs[0]?.survivalProbability).toBeGreaterThan(0.8)
    expect(recs[0]?.reasons.some((reason) => reason.includes('gone by next pick'))).toBe(false)
  })

  it('on the clock, ranks a slightly worse player who will not last until the following pick', () => {
    const players = [
      player({ id: 'will-last', position: 'WR', searchRank: 20, adp: 60, rankLow: 58, rankHigh: 62, vorp: 50 }),
      player({ id: 'wont-last', position: 'RB', searchRank: 25, adp: 15, rankLow: 13, rankHigh: 17, vorp: 42 }),
    ]
    const recs = recommendPicks({
      players,
      picks: [],
      yourSlot: 1,
      slots: defaultSlotCounts(),
      currentPickNo: 20,
      yourNextPickNo: 20,
      yourFollowingPickNo: 40,
    })
    expect(recs[0]?.player.id).toBe('wont-last')
    expect(recs.find((r) => r.player.id === 'will-last')?.reasons.some((reason) => reason.includes('gone by next pick'))).toBe(false)
  })

  it('flags adding a starter onto a bye week that already has three starters out', () => {
    const players = [
      player({ id: 'rb', position: 'RB', searchRank: 5, bye: 10 }),
      player({ id: 'wr', position: 'WR', searchRank: 6, bye: 10 }),
      player({ id: 'te', position: 'TE', searchRank: 7, bye: 10 }),
      player({ id: 'candidate', position: 'WR', searchRank: 40, bye: 10 }),
    ]
    const picks: DraftPick[] = [
      { playerId: 'rb', pickedByUserId: null, rosterId: null, round: 1, draftSlot: 1, pickNo: 1, isKeeper: false, meta: null },
      { playerId: 'wr', pickedByUserId: null, rosterId: null, round: 2, draftSlot: 1, pickNo: 2, isKeeper: false, meta: null },
      { playerId: 'te', pickedByUserId: null, rosterId: null, round: 3, draftSlot: 1, pickNo: 3, isKeeper: false, meta: null },
    ]
    const recs = recommendPicks({ players, picks, yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 4 })
    expect(recs.find((r) => r.player.id === 'candidate')?.reasons).toContain('4 starters on bye 10')
  })

  it('rewards a starter whose bye week is still empty', () => {
    const players = [
      player({ id: 'qb', position: 'QB', searchRank: 40, bye: 5 }),
      player({ id: 'open-bye', position: 'WR', searchRank: 20, bye: 9 }),
      player({ id: 'same-bye', position: 'WR', searchRank: 21, bye: 5 }),
    ]
    const picks: DraftPick[] = [{ playerId: 'qb', pickedByUserId: null, rosterId: null, round: 1, draftSlot: 1, pickNo: 1, isKeeper: false, meta: null }]
    const recs = recommendPicks({ players, picks, yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 2 })
    expect(recs.find((r) => r.player.id === 'open-bye')?.reasons).toContain('Open bye 9')
    expect(recs.find((r) => r.player.id === 'same-bye')?.reasons).not.toContain('Open bye 5')
  })

  it('flags an available backup as a handcuff for a rostered starter', () => {
    const players = [
      player({ id: 'starter', position: 'RB', searchRank: 5, team: 'DAL', depthChartOrder: 1 }),
      player({ id: 'backup', position: 'RB', searchRank: 90, team: 'DAL', depthChartOrder: 2 }),
    ]
    const picks: DraftPick[] = [{ playerId: 'starter', pickedByUserId: null, rosterId: null, round: 1, draftSlot: 1, pickNo: 1, isKeeper: false, meta: null }]
    const recs = recommendPicks({ players, picks, yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 2 })
    expect(recs.find((r) => r.player.id === 'backup')?.reasons).toContain('Handcuff for starter')
  })

  it('rewards a candidate QB who stacks with a rostered pass-catcher', () => {
    const players = [
      player({ id: 'qb', position: 'QB', searchRank: 20, team: 'KC' }),
      player({ id: 'wr', position: 'WR', searchRank: 5, team: 'KC' }),
    ]
    const picks: DraftPick[] = [{ playerId: 'wr', pickedByUserId: null, rosterId: null, round: 1, draftSlot: 1, pickNo: 1, isKeeper: false, meta: null }]
    const recs = recommendPicks({ players, picks, yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 2 })
    expect(recs.find((r) => r.player.id === 'qb')?.reasons).toContain('Stack with wr')
  })

  it('rewards a candidate pass-catcher who stacks with a rostered QB, and only when the teams match', () => {
    const players = [
      player({ id: 'qb', position: 'QB', searchRank: 5, team: 'KC' }),
      player({ id: 'wr-kc', position: 'WR', searchRank: 20, team: 'KC' }),
      player({ id: 'wr-lar', position: 'WR', searchRank: 21, team: 'LAR' }),
    ]
    const picks: DraftPick[] = [{ playerId: 'qb', pickedByUserId: null, rosterId: null, round: 1, draftSlot: 1, pickNo: 1, isKeeper: false, meta: null }]
    const recs = recommendPicks({ players, picks, yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 2 })
    expect(recs.find((r) => r.player.id === 'wr-kc')?.reasons).toContain('QB stack with qb')
    expect(recs.find((r) => r.player.id === 'wr-lar')?.reasons.some((reason) => reason.includes('stack'))).toBe(false)
  })

  it('pairs stack mates across team abbreviation aliases', () => {
    const players = [
      player({ id: 'qb', position: 'QB', searchRank: 20, team: 'JAX' }),
      player({ id: 'wr', position: 'WR', searchRank: 5, team: 'JAC' }),
    ]
    const picks: DraftPick[] = [{ playerId: 'wr', pickedByUserId: null, rosterId: null, round: 1, draftSlot: 1, pickNo: 1, isKeeper: false, meta: null }]
    const recs = recommendPicks({ players, picks, yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 2 })
    expect(recs.find((r) => r.player.id === 'qb')?.reasons).toContain('Stack with wr')
  })

  it('flags a backup whose starter was drafted by another team', () => {
    const players = [
      player({ id: 'starter', position: 'RB', searchRank: 5, team: 'DAL', depthChartOrder: 1 }),
      player({ id: 'backup', position: 'RB', searchRank: 90, team: 'DAL', depthChartOrder: 2 }),
    ]
    const picks: DraftPick[] = [{ playerId: 'starter', pickedByUserId: null, rosterId: null, round: 1, draftSlot: 2, pickNo: 1, isKeeper: false, meta: null }]
    const recs = recommendPicks({ players, picks, yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 2 })
    expect(recs.find((r) => r.player.id === 'backup')?.reasons).toContain('Starter starter already drafted')
  })

  it('does not double-flag a backup when the starter is yours to handcuff', () => {
    const players = [
      player({ id: 'starter', position: 'RB', searchRank: 5, team: 'DAL', depthChartOrder: 1 }),
      player({ id: 'backup', position: 'RB', searchRank: 90, team: 'DAL', depthChartOrder: 2 }),
    ]
    const picks: DraftPick[] = [{ playerId: 'starter', pickedByUserId: null, rosterId: null, round: 1, draftSlot: 1, pickNo: 1, isKeeper: false, meta: null }]
    const recs = recommendPicks({ players, picks, yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 2 })
    const backup = recs.find((r) => r.player.id === 'backup')
    expect(backup?.reasons).toContain('Handcuff for starter')
    expect(backup?.reasons.some((reason) => reason.includes('already drafted'))).toBe(false)
  })

  it('flags standalone value only for a projected backup, not a starter or an unprojected one', () => {
    const players = [
      player({ id: 'backup-valued', position: 'RB', searchRank: 90, team: 'DAL', depthChartOrder: 2, vorp: 12.5 }),
      player({ id: 'backup-unvalued', position: 'RB', searchRank: 91, team: 'DAL', depthChartOrder: 3, vorp: null }),
      player({ id: 'starter', position: 'RB', searchRank: 5, team: 'DAL', depthChartOrder: 1, vorp: 30 }),
    ]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 1 })
    expect(recs.find((r) => r.player.id === 'backup-valued')?.reasons).toContain('Standalone value (RB2)')
    expect(recs.find((r) => r.player.id === 'backup-unvalued')?.reasons.some((reason) => reason.includes('Standalone'))).toBe(false)
    expect(recs.find((r) => r.player.id === 'starter')?.reasons.some((reason) => reason.includes('Standalone'))).toBe(false)
  })
})

function rec(overrides: Partial<Recommendation> & { player: Player }): Recommendation {
  return {
    score: 100,
    reason: 'Best available',
    reasons: ['Best available'],
    breakdown: [],
    survivalProbability: null,
    ...overrides,
  }
}

describe('suggestionSet', () => {
  it('keeps the top pick and prefers a different position over more of the same', () => {
    const rb1 = rec({ player: player({ id: 'rb1', position: 'RB' }), score: 200 })
    const rb2 = rec({ player: player({ id: 'rb2', position: 'RB' }), score: 190 })
    const rb3 = rec({ player: player({ id: 'rb3', position: 'RB' }), score: 180 })
    const wr = rec({ player: player({ id: 'wr1', position: 'WR' }), score: 120, reason: 'Fill WR', reasons: ['Fill WR'] })
    const te = rec({ player: player({ id: 'te1', position: 'TE' }), score: 110, reason: 'Open bye 9', reasons: ['Open bye 9'] })
    const picked = suggestionSet([rb1, rb2, rb3, wr, te], 4)
    expect(picked.map((item) => item.player.id)).toEqual(['rb1', 'wr1', 'te1', 'rb2'])
  })

  it('includes the player least likely to last when that is not already listed', () => {
    const rb = rec({ player: player({ id: 'rb1', position: 'RB' }), score: 200 })
    const wr = rec({ player: player({ id: 'wr1', position: 'WR' }), score: 150, survivalProbability: 0.9 })
    const gone = rec({ player: player({ id: 'rb2', position: 'RB' }), score: 140, survivalProbability: 0.1, reason: '90% gone by next pick', reasons: ['90% gone by next pick'] })
    const picked = suggestionSet([rb, wr, gone], 3)
    expect(picked.map((item) => item.player.id)).toEqual(['rb1', 'wr1', 'rb2'])
  })

  it('when waiting, prefers someone who will still be there over someone who will not', () => {
    const rb = rec({ player: player({ id: 'rb1', position: 'RB' }), score: 200 })
    const wr = rec({ player: player({ id: 'wr1', position: 'WR' }), score: 160 })
    const lock = rec({ player: player({ id: 'rb2', position: 'RB' }), score: 140, survivalProbability: 0.9, reason: 'Likely there at your pick', reasons: ['Likely there at your pick'] })
    const picked = suggestionSet([rb, wr, lock], 3, { waitForPick: true })
    expect(picked.map((item) => item.player.id)).toEqual(['rb1', 'wr1', 'rb2'])
  })
})

describe('players the market does not cover', () => {
  it('does not price a reach or a bargain off a rank', () => {
    // Rank 60 at pick 40 used to read as an 18-pick reach, purely because a
    // ranking was standing in for a draft position.
    const players = [player({ id: 'no-market', searchRank: 60 })]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 40 })
    expect(recs[0]?.reasons.some((reason) => reason.startsWith('Value vs'))).toBe(false)
    // Same score as a player at the same rank on the clock: no reach penalty.
    const onClock = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 60 })
    expect(recs[0]!.score).toBe(onClock[0]!.score)
  })

  it('says so rather than implying confidence', () => {
    const players = [player({ id: 'no-market', searchRank: 60 })]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 40 })
    expect(recs[0]?.reasons).toContain('No ADP data')
  })

  it('leaves survival unmodelled without a market', () => {
    const players = [player({ id: 'no-market', searchRank: 60, rankStdDev: 12 })]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 40, yourNextPickNo: 60 })
    expect(recs[0]?.survivalProbability).toBeNull()
  })

  it('still prices one the market does cover', () => {
    const players = [player({ id: 'priced', searchRank: 60, adp: 20 })]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 40 })
    expect(recs[0]?.reasons).toContain('Value vs ADP')
  })
})

describe('positional need answers to the clock', () => {
  // A clearly better player, and a worse one who fills an empty starter slot.
  const better = player({ id: 'better', position: 'RB', vorp: 70, searchRank: 5 })
  const fillsHole = player({ id: 'fills-hole', position: 'QB', vorp: 40, searchRank: 30 })
  const players = [better, fillsHole]
  const slots = defaultSlotCounts()

  function topPick(rostered: DraftPick[], currentPickNo: number) {
    return recommendPicks({ players: [...players, ...rostered.map((p) => player({ id: p.playerId, position: 'WR', vorp: 1 }))], picks: rostered, yourSlot: 1, slots, currentPickNo })[0]?.player.id
  }

  it('takes the better player early, with picks to spare', () => {
    // 30 VORP is 90 score points; a flat +85 starter bonus used to erase that.
    expect(topPick([], 1)).toBe('better')
  })

  it('takes the hole-filler when the last picks all have to be starters', () => {
    // Everything but QB filled, one pick left: the RB is a bench add and the
    // QB is the only thing that keeps a lineup slot from being empty.
    const spots = Object.values(slots).reduce((sum, count) => sum + count, 0)
    const positions = ['RB', 'RB', 'WR', 'WR', 'TE', 'WR', 'K', 'DEF']
    const mine = positions.map((position, index) => player({ id: `mine-${index}`, position, vorp: 1 }))
    const bench = Array.from({ length: spots - positions.length - 1 }, (_, index) => player({ id: `bench-${index}`, position: 'RB', vorp: 1 }))
    const rostered: DraftPick[] = [...mine, ...bench].map((p, index) => ({
      playerId: p.id, pickedByUserId: '1', rosterId: '1', round: index + 1,
      draftSlot: 1, pickNo: index + 1, isKeeper: false, meta: null,
    }))
    const recs = recommendPicks({
      players: [...players, ...mine, ...bench], picks: rostered,
      yourSlot: 1, slots, currentPickNo: rostered.length + 1,
    })
    expect(recs[0]?.player.id).toBe('fills-hole')
    // The headline stays specific to the player. This term fires for every
    // eligible player at once, so leading with it said the same thing about
    // all of them at the moment they most need telling apart.
    expect(recs[0]?.reasons[0]).toBe('Fill QB')
    expect(recs[0]?.reasons).toContain('Last chance to fill a starter')
  })

  describe('streamable starters', () => {
    // K and DEF are the streamable slots: there is always one on waivers and a
    // bench spot can be cleared for it after the draft. The discount is not an
    // opinion about kickers, it is an opinion about having somewhere better to
    // put the pick -- so it fades as that stops being true.
    const pool = [
      player({ id: 'elite-rb', position: 'RB', searchRank: 5, vorp: 100 }),
      player({ id: 'kicker', position: 'K', searchRank: 150 }),
      player({ id: 'defense', position: 'DEF', searchRank: 160 }),
      player({ id: 'scrub', position: 'WR', searchRank: 300, vorp: 1 }),
    ]
    const spots = Object.values(slots).reduce((sum, count) => sum + count, 0)

    /** A roster with `picksLeft` spots open and `have` filling the K/DEF slots. */
    function boardWith(picksLeft: number, have: string[]) {
      const core = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'WR']
      const mine = [...core, ...have].map((position, index) => player({ id: `mine-${position}-${index}`, position, vorp: 1 }))
      const filler = Array.from({ length: spots - mine.length - picksLeft }, (_, index) => player({ id: `bench-${index}`, position: 'WR', vorp: 1 }))
      const roster = [...mine, ...filler]
      const rostered: DraftPick[] = roster.map((p, index) => ({
        playerId: p.id, pickedByUserId: '1', rosterId: '1', round: index + 1,
        draftSlot: 1, pickNo: index + 1, isKeeper: false, meta: null,
      }))
      return recommendPicks({
        players: [...pool, ...roster], picks: rostered,
        yourSlot: 1, slots, currentPickNo: rostered.length + 1, limit: 10,
      })
    }
    const rank = (recs: Recommendation[], id: string) => recs.findIndex((rec) => rec.player.id === id)

    it('takes the better player while there are picks to spare', () => {
      const recs = boardWith(3, [])
      expect(recs[0]?.player.id).toBe('elite-rb')
      // Beatable, not ignored: still ahead of ordinary bench fodder.
      expect(rank(recs, 'kicker')).toBeLessThan(rank(recs, 'scrub'))
    })

    it('escalates once the empty slots eat the remaining picks', () => {
      // Two picks, two empty starter slots: an elite back you cannot start is
      // worth less than a kicker you can.
      const recs = boardWith(2, [])
      expect(recs[0]?.player.id).toBe('kicker')
      expect(rank(recs, 'defense')).toBeLessThan(rank(recs, 'elite-rb'))
      expect(recs[0]?.reasons).toContain('Last starter slot (streamable)')
    })

    it('drops the exemption entirely on the last pick', () => {
      // Nothing left to trade the slot for, so nothing left to justify it.
      const recs = boardWith(1, ['DEF'])
      expect(recs[0]?.player.id).toBe('kicker')
      expect(recs[0]?.reasons).toContain('Last chance to fill a starter')
      const forced = recs[0]?.breakdown.find((term) => term.label === 'Last chance to fill a starter')
      expect(forced?.delta).toBe(600)
    })
  })
})

describe('players with no projection are on the same scale', () => {
  // A board where projections exist for most players but not for kickers,
  // defenses or rookies -- which is every real board.
  const board: Player[] = []
  for (let rank = 1; rank <= 120; rank += 1) {
    board.push(player({ id: `r${rank}`, position: rank % 2 ? 'WR' : 'RB', searchRank: rank, adp: rank, vorp: Math.max(-5, 90 - rank * 0.7) }))
  }

  it('does not float an unprojected player above better-ranked ones', () => {
    // rank 150 with no vorp used to score 300, beating a rank-40 player worth
    // 18 VORP (54) by a factor of five.
    const players = [...board, player({ id: 'defense', position: 'DEF', searchRank: 150, adp: 150 })]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 1, limit: 12 })
    expect(recs.some((rec) => rec.player.id === 'defense')).toBe(false)
  })

  it('prices an unprojected player like his ranked neighbours', () => {
    const players = [...board, player({ id: 'rookie', position: 'RB', searchRank: 40, adp: 40 })]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 1, limit: 200 })
    const rookie = recs.find((rec) => rec.player.id === 'rookie')!
    const neighbour = recs.find((rec) => rec.player.id === 'r40')!
    // Within a round of each other, not a different order of magnitude.
    expect(Math.abs(rookie.score - neighbour.score)).toBeLessThan(40)
  })

  it('stays self-consistent when nothing has a projection', () => {
    const unprojected = board.map((p) => ({ ...p, vorp: undefined }))
    const recs = recommendPicks({ players: unprojected, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 1, limit: 3 })
    // No curve to calibrate against, so everyone falls back together.
    expect(recs.map((rec) => rec.player.searchRank)).toEqual([1, 2, 3])
  })
})

describe('live ADP trend', () => {
  it('boosts a riser and buries a faller from the FantasyPros windows', () => {
    const riser = liveAdpTrendAdjustment(player({ id: 'riser', liveAdpVsLastOne: 8.2 }))
    expect(riser?.reason).toBe('Rising ADP vs last 1 day')
    expect(riser?.delta).toBeCloseTo(9.84)
    expect(liveAdpTrendAdjustment(player({ id: 'faller', liveAdpVsLastSeven: -5 }))).toEqual({
      delta: -6, reason: 'Falling ADP vs last 7 days',
    })
    expect(liveAdpTrendAdjustment(player({ id: 'noise', liveAdpVsLastOne: 1.2 }))).toBeNull()
  })

  it('uses the 1-day / 7-day move in the recommendation score', () => {
    const riser = player({ id: 'riser', searchRank: 20, liveAdp: 20, liveAdpVsLastOne: 9, team: 'HOU' })
    const flat = player({ id: 'flat', searchRank: 20, liveAdp: 20, team: 'DAL' })
    const rising = recommendPicks({ players: [riser], picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 20 })[0]
    const even = recommendPicks({ players: [flat], picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 20 })[0]
    expect(rising?.reasons).toContain('Rising ADP vs last 1 day')
    expect(rising!.score).toBeGreaterThan(even!.score)
  })
})

describe('free agents', () => {
  it('does not recommend an unsigned player even with leftover VORP and ADP', () => {
    const recs = recommendPicks({
      players: [
        player({ id: 'blank-team-star', searchRank: 5, vorp: 80, adp: 8, liveAdp: 6, team: null }),
        player({ id: 'espn-fa', searchRank: 10, vorp: 70, adp: 12, team: 'FA' }),
        player({ id: 'rostered', searchRank: 40, vorp: 25, team: 'DAL' }),
      ],
      picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 1, limit: 3,
    })
    expect(recs.map((rec) => rec.player.id)).toEqual(['rostered'])
  })

  it('does not recommend an unsigned namesake over the rostered player', () => {
    const recs = recommendPicks({
      players: [
        player({ id: 'unsigned', fullName: 'John Smith', searchRank: 8, vorp: 80, team: null }),
        player({ id: 'rostered', fullName: 'John Smith', searchRank: 25, vorp: 40, team: 'DAL' }),
      ],
      picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 1, limit: 2,
    })
    expect(recs[0]?.player.id).toBe('rostered')
    expect(recs.find((rec) => rec.player.id === 'unsigned')).toBeUndefined()
  })
})

describe('injury designations', () => {
  it('penalizes IR and leaves questionable unpenalized', () => {
    const healthy = recommendPicks({
      players: [player({ id: 'healthy', searchRank: 20, vorp: 40, team: 'CHI' })],
      picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 1,
    })[0]
    const ir = recommendPicks({
      players: [player({ id: 'ir', searchRank: 20, vorp: 40, team: 'CHI', injuryStatus: 'IR' })],
      picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 1,
    })[0]
    const questionable = recommendPicks({
      players: [player({ id: 'q', searchRank: 20, vorp: 40, team: 'CHI', injuryStatus: 'Questionable' })],
      picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 1,
    })[0]
    expect(ir?.reasons).toContain('IR')
    expect(ir!.score).toBeCloseTo(healthy!.score - 40)
    expect(questionable?.reasons).not.toContain('Questionable')
    expect(questionable!.score).toBeCloseTo(healthy!.score)
  })
})

describe('the score explains itself', () => {
  it('sums to the score it reports', () => {
    const players = [
      player({ id: 'a', position: 'WR', searchRank: 20, adp: 20, vorp: 40, tier: 1 }),
      player({ id: 'b', position: 'RB', searchRank: 25, adp: 90, vorp: 30 }),
    ]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 40 })
    for (const rec of recs) {
      const summed = rec.breakdown.reduce((total, term) => total + term.delta, 0)
      expect(summed).toBeCloseTo(rec.score, 6)
    }
  })

  it('names the reach that buried a player', () => {
    // Exactly the Travis Hunter shape: ranked well, but the market says 229.
    const players = [
      player({ id: 'market-says-late', position: 'WR', searchRank: 118, liveAdp: 229 }),
      player({ id: 'market-agrees', position: 'WR', searchRank: 45, liveAdp: 58, vorp: 34 }),
    ]
    const recs = recommendPicks({ players, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 60 })
    expect(recs[0]?.player.id).toBe('market-agrees')
    const buried = recs.find((rec) => rec.player.id === 'market-says-late')!
    const reach = buried.breakdown.find((term) => term.label.startsWith('Reach vs'))
    expect(reach).toBeDefined()
    expect(reach!.delta).toBeLessThan(-200)
  })
})

describe('chopped last-man-standing', () => {
  it('lets VORP price an early-round QB rather than charging him twice', () => {
    // vorp is already value over the QB12 baseline, which on a real board puts
    // the top QB (175) far behind the top RB (405). Where the projection says
    // a quarterback really is worth more over replacement, the board should
    // say so instead of applying a second flat penalty for the same fact.
    const recs = recommendPicks({
      players: [
        player({ id: 'qb', position: 'QB', searchRank: 12, vorp: 48, yearsExp: 6 }),
        player({ id: 'rb', position: 'RB', searchRank: 14, vorp: 46, yearsExp: 5 }),
      ],
      picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 8,
      leagueFormat: 'chopped', teams: 18,
    })
    expect(recs[0]?.player.id).toBe('qb')
    expect(recs.find((rec) => rec.player.id === 'qb')?.reasons).not.toContain('Wait on QB')
  })

  it('still waits on a QB the rank fallback cannot price', () => {
    const recs = recommendPicks({
      players: [
        player({ id: 'qb', position: 'QB', searchRank: 12, yearsExp: 6 }),
        player({ id: 'rb', position: 'RB', searchRank: 14, yearsExp: 5 }),
      ],
      picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 8,
      leagueFormat: 'chopped', teams: 18,
    })
    expect(recs.find((rec) => rec.player.id === 'qb')?.reasons).toContain('Wait on QB')
  })

  it('prefers the steadier back when the projections agree', () => {
    // The floor signal is the player's own weekly scoring spread against his
    // positional peers -- not expert disagreement about his draft slot.
    const pool = [
      player({ id: 'steady', position: 'RB', searchRank: 14, vorp: 46, consistency: { cv: 0.33, weeks: 17 } }),
      player({ id: 'boomy', position: 'RB', searchRank: 12, vorp: 48, consistency: { cv: 0.95, weeks: 17 } }),
      // Enough peers to establish a positional median to judge them against.
      ...Array.from({ length: 8 }, (_, i) => player({
        id: `peer${i}`, position: 'RB', searchRank: 100 + i, vorp: 5, consistency: { cv: 0.5 + i * 0.02, weeks: 17 },
      })),
    ]
    const recs = recommendPicks({
      players: pool, picks: [], yourSlot: 1, slots: defaultSlotCounts(), currentPickNo: 8,
      leagueFormat: 'chopped', teams: 18,
    })
    expect(recs[0]?.player.id).toBe('steady')
  })

  it('does not pay a stack bonus on a shared early bye', () => {
    const picks: DraftPick[] = [{
      playerId: 'wr', pickedByUserId: null, rosterId: null, round: 1, draftSlot: 1, pickNo: 1, isKeeper: false, meta: null,
    }]
    const recs = recommendPicks({
      players: [
        player({ id: 'wr', position: 'WR', team: 'CIN', bye: 6, fullName: 'Chase', searchRank: 2, vorp: 70 }),
        player({ id: 'qb', position: 'QB', team: 'CIN', bye: 6, fullName: 'Burrow', searchRank: 20, vorp: 40, yearsExp: 6 }),
      ],
      picks,
      yourSlot: 1,
      slots: defaultSlotCounts(),
      currentPickNo: 20,
      leagueFormat: 'chopped',
      teams: 18,
    })
    const qb = recs.find((rec) => rec.player.id === 'qb')
    expect(qb?.reasons.some((reason) => reason.startsWith('Stack with'))).toBe(false)
    // One charge for one fact: two starters off in the same week. A separate
    // shared-early-bye penalty used to fire alongside the stacked-bye term.
    const byeTerms = qb!.breakdown.filter((term) => term.label.toLowerCase().includes('bye'))
    expect(byeTerms).toHaveLength(1)
    expect(qb?.reasons.some((reason) => reason.includes('bye week 6'))).toBe(true)
  })
})
