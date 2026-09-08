import { describe, expect, it } from 'vitest'
import {
  ageDecline,
  availabilityTerms,
  estimateAvailability,
  seasonsFromTriples,
  type SeasonDurability,
} from './availability'

/** The three backs the engine could not tell apart before this existed. */
const MCCAFFREY: SeasonDurability[] = [
  { season: 2025, gamesPlayed: 17, gamesMissed: 0 },
  { season: 2024, gamesPlayed: 4, gamesMissed: 13 },
  { season: 2023, gamesPlayed: 16, gamesMissed: 1 },
]
const BIJAN: SeasonDurability[] = [
  { season: 2025, gamesPlayed: 17, gamesMissed: 0 },
  { season: 2024, gamesPlayed: 17, gamesMissed: 0 },
  { season: 2023, gamesPlayed: 17, gamesMissed: 0 },
]

describe('seasonsFromTriples', () => {
  it('reads the flat index encoding, most recent season first', () => {
    expect(seasonsFromTriples([2024, 4, 13, 2025, 17, 0])).toEqual([
      { season: 2025, gamesPlayed: 17, gamesMissed: 0 },
      { season: 2024, gamesPlayed: 4, gamesMissed: 13 },
    ])
  })

  it('returns nothing for an index published without the field', () => {
    expect(seasonsFromTriples(undefined)).toEqual([])
    expect(seasonsFromTriples([])).toEqual([])
  })

  it('drops a malformed or empty season rather than reading it as a clean one', () => {
    // A trailing partial triple, a season with no games, and a negative count
    // are all "we did not measure", which must not become "he played them all".
    expect(seasonsFromTriples([2025, 17, 0, 2024, 0, 0, 2023, -1, 5, 2022, 9])).toEqual([
      { season: 2025, gamesPlayed: 17, gamesMissed: 0 },
    ])
  })

  it('keeps only the recent window', () => {
    const triples = [2025, 17, 0, 2024, 17, 0, 2023, 17, 0, 2022, 17, 0]
    expect(seasonsFromTriples(triples)).toHaveLength(3)
    expect(seasonsFromTriples(triples).at(-1)?.season).toBe(2023)
  })
})

describe('estimateAvailability', () => {
  it('is null for a player with no seasons on record', () => {
    // A rookie has no durability evidence. An average estimate would be a
    // fact we do not have, and the engine must be able to tell the difference.
    expect(estimateAvailability([])).toBeNull()
  })

  it('rates a lost season below a clean one', () => {
    const fragile = estimateAvailability(MCCAFFREY)!
    const durable = estimateAvailability(BIJAN)!
    expect(fragile.projectedAvailability).toBeLessThan(durable.projectedAvailability)
    expect(fragile.gamesMissed).toBe(14)
    expect(durable.gamesMissed).toBe(0)
  })

  it('weights the most recent season heaviest', () => {
    const recent = estimateAvailability([
      { season: 2025, gamesPlayed: 4, gamesMissed: 13 },
      { season: 2024, gamesPlayed: 17, gamesMissed: 0 },
    ])!
    const older = estimateAvailability([
      { season: 2025, gamesPlayed: 17, gamesMissed: 0 },
      { season: 2024, gamesPlayed: 4, gamesMissed: 13 },
    ])!
    expect(recent.projectedAvailability).toBeLessThan(older.projectedAvailability)
  })

  it('damps rather than extrapolates a catastrophic record', () => {
    // Missing every game for three years is the worst evidence available, and
    // it still must not project a player at zero: the estimate is regressed
    // and damped, not a straight replay of the past.
    const worst = estimateAvailability([
      { season: 2025, gamesPlayed: 0, gamesMissed: 17 },
      { season: 2024, gamesPlayed: 0, gamesMissed: 17 },
      { season: 2023, gamesPlayed: 0, gamesMissed: 17 },
    ])!
    expect(worst.projectedAvailability).toBeGreaterThan(0.4)
    expect(worst.projectedAvailability).toBeLessThan(0.6)
  })

  it('lets one clean season move the estimate without deciding it', () => {
    const one = estimateAvailability([{ season: 2025, gamesPlayed: 17, gamesMissed: 0 }])!
    const three = estimateAvailability(BIJAN)!
    expect(one.projectedAvailability).toBeGreaterThan(0.89)
    expect(one.projectedAvailability).toBeLessThan(three.projectedAvailability)
  })
})

describe('ageDecline', () => {
  it('does not penalize a player at or under his position cliff', () => {
    expect(ageDecline('RB', 24)).toBe(0)
    expect(ageDecline('RB', 27)).toBe(0)
    expect(ageDecline('WR', 29)).toBe(0)
  })

  it('falls faster for a back than a receiver of the same age', () => {
    expect(ageDecline('RB', 31)).toBeGreaterThan(ageDecline('WR', 31))
  })

  it('is silent for positions with no curve and for an unknown age', () => {
    expect(ageDecline('K', 40)).toBe(0)
    expect(ageDecline('DEF', 40)).toBe(0)
    expect(ageDecline('RB', null)).toBe(0)
    expect(ageDecline('RB', undefined)).toBe(0)
  })

  it('caps so an ancient player is discounted, not deleted', () => {
    expect(ageDecline('RB', 45)).toBeLessThanOrEqual(0.28)
  })
})

describe('availabilityTerms', () => {
  const base = 300

  it('discounts an injury history and credits a clean one', () => {
    const fragile = availabilityTerms({
      position: 'RB', age: 24, baseValue: base,
      availability: estimateAvailability(MCCAFFREY),
    })
    const durable = availabilityTerms({
      position: 'RB', age: 24, baseValue: base,
      availability: estimateAvailability(BIJAN),
    })
    expect(fragile[0]!.delta).toBeLessThan(0)
    expect(fragile[0]!.label).toBe('Injury history')
    expect(durable[0]!.delta).toBeGreaterThan(0)
  })

  it('surfaces a reason for the discount but not for the bonus', () => {
    // Reasons are what the board says out loud. "He has been healthy" is not
    // why you take someone, and would crowd out the reason that decided it.
    const fragile = availabilityTerms({
      position: 'RB', baseValue: base, availability: estimateAvailability(MCCAFFREY),
    })
    const durable = availabilityTerms({
      position: 'RB', baseValue: base, availability: estimateAvailability(BIJAN),
    })
    expect(fragile[0]!.reason).toContain('14 games missed')
    expect(durable[0]!.reason).toBeNull()
  })

  it('scales with the player, so the same risk costs a stud more than a bench back', () => {
    const availability = estimateAvailability(MCCAFFREY)
    const stud = availabilityTerms({ position: 'RB', baseValue: 300, availability })[0]!
    const depth = availabilityTerms({ position: 'RB', baseValue: 30, availability })[0]!
    expect(Math.abs(stud.delta)).toBeGreaterThan(Math.abs(depth.delta) * 5)
  })

  it('weights availability harder in chopped, where one empty week ends you', () => {
    const availability = estimateAvailability(MCCAFFREY)
    const h2h = availabilityTerms({ position: 'RB', baseValue: base, availability })[0]!
    const chopped = availabilityTerms({ position: 'RB', baseValue: base, availability, chopped: true })[0]!
    expect(chopped.delta).toBeLessThan(h2h.delta)
  })

  it('applies the age curve in every format, including to a player who has never been hurt', () => {
    const terms = availabilityTerms({
      position: 'RB', age: 31, baseValue: base, availability: estimateAvailability(BIJAN),
    })
    const age = terms.find((term) => term.label === 'Age curve')!
    expect(age.delta).toBeLessThan(0)
  })

  it('says nothing about a player with no durability record', () => {
    expect(availabilityTerms({ position: 'RB', age: 24, baseValue: base, availability: null })).toEqual([])
  })

  it('does not discount a player whose base value is already worthless', () => {
    expect(availabilityTerms({
      position: 'RB', age: 34, baseValue: 0, availability: estimateAvailability(MCCAFFREY),
    })).toEqual([])
  })
})
