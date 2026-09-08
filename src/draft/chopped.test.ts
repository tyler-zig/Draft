import { describe, expect, it } from 'vitest'
import type { Player } from '../providers/types'
import { choppedNeedScale, choppedSosWeeks, choppedTerms, survivalWeight } from './chopped'

function player(overrides: Partial<Player> & { id: string }): Player {
  return {
    firstName: overrides.id,
    lastName: '',
    fullName: overrides.fullName ?? overrides.id,
    position: 'RB',
    team: 'CHI',
    searchRank: 20,
    injuryStatus: null,
    number: null,
    yearsExp: null,
    bye: null,
    ...overrides,
  }
}

describe('choppedNeedScale', () => {
  it('fills starters sooner than a flat hole-to-picks ratio', () => {
    expect(choppedNeedScale(8, 14)).toBeCloseTo(1, 5)
    expect(Math.min(1, 8 / 14)).toBeLessThan(0.6)
  })
})

describe('survivalWeight', () => {
  it('is certain in week 1 and decays across the league', () => {
    expect(survivalWeight(1, 12)).toBe(1)
    expect(survivalWeight(6, 12)).toBeCloseTo(7 / 12, 5)
    expect(survivalWeight(12, 12)).toBeCloseTo(1 / 12, 5)
  })

  it('is zero past the week the league can last', () => {
    expect(survivalWeight(14, 12)).toBe(0)
  })

  it('still counts a late bye in a bigger league', () => {
    // The week-7 cutoff this replaced scored a week-11 bye at nothing. In an
    // 18-team league that week is more likely than not to be played.
    expect(survivalWeight(11, 18)).toBeGreaterThan(0.4)
    expect(survivalWeight(11, 10)).toBe(0)
  })
})

describe('choppedSosWeeks', () => {
  it('covers the stretch an average team survives, scaled to the league', () => {
    expect(choppedSosWeeks(18).end).toBe(9)
    expect(choppedSosWeeks(12).end).toBe(6)
  })

  it('never shrinks below the opening month', () => {
    expect(choppedSosWeeks(4).end).toBe(4)
  })
})

describe('choppedTerms', () => {
  const base = { horizonPickNo: 8, teams: 18, yourPlayers: [] as Player[], baseValue: 300 }

  it('scales every tilt with the player, not a flat point total', () => {
    // A flat -18 rookie penalty was four percent of a first-round back and
    // ruinous to a last-round flier -- the same judgment landing as two.
    const stud = choppedTerms({ ...base, player: player({ id: 'kid', yearsExp: 0 }) })[0]!
    const flier = choppedTerms({ ...base, baseValue: 20, player: player({ id: 'kid', yearsExp: 0 }) })[0]!
    expect(stud.delta / flier.delta).toBeCloseTo(15, 1)
  })

  it('says nothing about a player with no value to discount', () => {
    expect(choppedTerms({ ...base, baseValue: 0, player: player({ id: 'kid', yearsExp: 0 }) })).toEqual([])
  })

  describe('waiting on a quarterback', () => {
    it('does not charge again when VORP has already priced replacement level', () => {
      // vorp is value over the QB12 baseline, which is the whole reason a
      // quarterback is not worth an early pick. Charging on top billed twice.
      const terms = choppedTerms({ ...base, player: player({ id: 'qb', position: 'QB', vorp: 58 }) })
      expect(terms.some((term) => term.label === 'Wait on QB')).toBe(false)
    })

    it('still waits on the rank fallback, where nothing prices replacement level', () => {
      const terms = choppedTerms({ ...base, player: player({ id: 'qb', position: 'QB' }) })
      expect(terms.some((term) => term.label === 'Wait on QB')).toBe(true)
    })

    it('stops waiting after the early-round window', () => {
      const terms = choppedTerms({
        ...base, horizonPickNo: 91, player: player({ id: 'qb', position: 'QB' }),
      })
      expect(terms.some((term) => term.label === 'Wait on QB')).toBe(false)
    })
  })

  it('penalizes a week-1 injury, harder when he is ruled out', () => {
    const ir = choppedTerms({ ...base, player: player({ id: 'hurt', injuryStatus: 'IR' }) })
    const q = choppedTerms({ ...base, player: player({ id: 'q', injuryStatus: 'Questionable' }) })
    const delta = (terms: ReturnType<typeof choppedTerms>) =>
      terms.find((term) => term.label === 'Week-1 injury risk')!.delta
    expect(delta(ir)).toBeLessThan(delta(q))
    expect(q.some((term) => term.reason === 'Questionable')).toBe(true)
  })

  describe('weekly scoring floor', () => {
    const medians = new Map([['RB', 0.58]])

    it('rewards a steadier back and penalizes a boomier one than his peers', () => {
      const steady = choppedTerms({
        ...base, consistencyMedians: medians,
        player: player({ id: 'steady', consistency: { cv: 0.33, weeks: 17 } }),
      })
      const boomy = choppedTerms({
        ...base, consistencyMedians: medians,
        player: player({ id: 'boomy', consistency: { cv: 0.85, weeks: 17 } }),
      })
      expect(steady.find((term) => term.label === 'Steady week to week')!.delta).toBeGreaterThan(0)
      expect(boomy.find((term) => term.label === 'Boom-or-bust weeks')!.delta).toBeLessThan(0)
    })

    it('judges against the position, not an absolute threshold', () => {
      // 0.55 is steady for a tight end and choppy for a quarterback. An
      // absolute cutoff would call them the same player.
      const positions = new Map([['TE', 0.62], ['QB', 0.48]])
      const te = choppedTerms({
        ...base, consistencyMedians: positions,
        player: player({ id: 'te', position: 'TE', consistency: { cv: 0.55, weeks: 17 } }),
      })
      const qb = choppedTerms({
        ...base, consistencyMedians: positions,
        player: player({ id: 'qb', position: 'QB', vorp: 20, consistency: { cv: 0.55, weeks: 17 } }),
      })
      expect(te.some((term) => term.label === 'Steady week to week')).toBe(true)
      expect(qb.some((term) => term.label === 'Boom-or-bust weeks')).toBe(true)
    })

    it('is silent for a player with no reading, and for a position with no median', () => {
      expect(choppedTerms({ ...base, consistencyMedians: medians, player: player({ id: 'x' }) })).toEqual([])
      expect(choppedTerms({
        ...base, consistencyMedians: new Map(),
        player: player({ id: 'y', consistency: { cv: 0.2, weeks: 17 } }),
      })).toEqual([])
    })
  })

  describe('byes', () => {
    const owned = player({ id: 'chase', position: 'WR', team: 'CIN', bye: 6, fullName: "Ja'Marr Chase" })

    it('leaves the first player on a bye alone and charges the second', () => {
      const alone = choppedTerms({ ...base, player: player({ id: 'solo', bye: 6 }) })
      expect(alone.some((term) => term.label.startsWith('Stacked bye'))).toBe(false)
      const second = choppedTerms({
        ...base, yourPlayers: [owned], player: player({ id: 'brown', team: 'CIN', bye: 6 }),
      })
      expect(second.some((term) => term.label === 'Stacked bye week 6')).toBe(true)
    })

    it('charges more as the pile grows', () => {
      const cost = (count: number) => choppedTerms({
        ...base,
        yourPlayers: Array.from({ length: count }, (_, i) => player({ id: `own${i}`, bye: 6 })),
        player: player({ id: 'next', bye: 6 }),
      }).find((term) => term.label === 'Stacked bye week 6')!.delta
      expect(cost(2)).toBeLessThan(cost(1))
    })

    it('prices a late bye by how likely you are to still be playing', () => {
      const cost = (bye: number) => choppedTerms({
        ...base,
        yourPlayers: [player({ id: 'own', bye })],
        player: player({ id: 'next', bye }),
      }).find((term) => term.label.startsWith('Stacked bye'))?.delta ?? 0
      // Week 11 is real risk in an 18-team league; the old cutoff scored it 0.
      expect(cost(11)).toBeLessThan(0)
      expect(cost(11)).toBeGreaterThan(cost(6))
    })

    it('charges once when the stacked bye is also a QB stack', () => {
      // A separate shared-early-bye penalty used to fire alongside this one,
      // billing twice for the single fact that two starters are off together.
      const terms = choppedTerms({
        ...base,
        yourPlayers: [owned],
        player: player({ id: 'burrow', position: 'QB', team: 'CIN', bye: 6, fullName: 'Joe Burrow', vorp: 40 }),
      })
      expect(terms.filter((term) => term.label.toLowerCase().includes('bye'))).toHaveLength(1)
    })
  })

  it('scores the early schedule, not a playoff window', () => {
    const easy = choppedTerms({
      ...base, player: player({ id: 'soft', playoffSos: { averageMatchupRank: 8, rank: 3, games: 4 } }),
    })
    expect(easy.find((term) => term.label === 'Easy early schedule')!.delta).toBeGreaterThan(0)
    const tough = choppedTerms({
      ...base, player: player({ id: 'hard', playoffSos: { averageMatchupRank: 28, rank: 26, games: 4 } }),
    })
    expect(tough.find((term) => term.label === 'Tough early schedule')!.delta).toBeLessThan(0)
  })
})
