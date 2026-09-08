import { describe, expect, it } from 'vitest'
import { AVAILABILITY_SEASONS, availabilityTriples, buildPlayerShards, consistencyFrom, type ShardablePlayer } from './shards'

function record(overrides: Partial<ShardablePlayer> & { name: string }): ShardablePlayer {
  return {
    ids: { gsis: `00-${overrides.name}`, espn: null, sleeper: null, pfr: null },
    position: 'RB',
    ...overrides,
  }
}

const season = (season: number, gamesPlayed: number, gamesMissed: number) => ({
  season, gamesPlayed, durability: { gamesMissed },
})

describe('availabilityTriples', () => {
  it('flattens the recent window, most recent season first', () => {
    const player = record({
      name: 'mccaffrey',
      seasons: [season(2023, 16, 1), season(2025, 17, 0), season(2024, 4, 13)],
    })
    expect(availabilityTriples(player)).toEqual([2025, 17, 0, 2024, 4, 13, 2023, 16, 1])
  })

  it('keeps only the recent window however many seasons a career has', () => {
    const player = record({
      name: 'veteran',
      seasons: [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map((year) => season(year, 17, 0)),
    })
    expect(availabilityTriples(player)).toHaveLength(AVAILABILITY_SEASONS * 3)
    expect(availabilityTriples(player)?.[0]).toBe(2025)
  })

  it('is undefined for a player with no seasons on record', () => {
    expect(availabilityTriples(record({ name: 'rookie' }))).toBeUndefined()
    expect(availabilityTriples(record({ name: 'rookie', seasons: [] }))).toBeUndefined()
  })

  it('skips a season with no durability row rather than recording a clean one', () => {
    // A producer that types `seasons` narrowly still publishes the field it
    // does have. Reading a missing count as zero would put "never hurt" in the
    // index for every player it touched, which is worse than saying nothing.
    const player = record({
      name: 'partial',
      seasons: [season(2025, 17, 0), { season: 2024 }, { season: 2023, gamesPlayed: 17 }],
    })
    expect(availabilityTriples(player)).toEqual([2025, 17, 0])
  })
})

const weeks = (points: number[]) => points.map((fantasyPointsPpr) => ({ fantasyPointsPpr }))

describe('consistencyFrom', () => {
  it('measures the spread of a real season of weekly scores', () => {
    const flat = consistencyFrom(record({
      name: 'metronome', seasons: [{ season: 2025, weekly: weeks(Array(17).fill(15)) }],
    }))
    const swingy = consistencyFrom(record({
      name: 'boomer', seasons: [{ season: 2025, weekly: weeks([2, 40, 1, 38, 3, 35, 0, 42, 2, 30, 1, 33, 4, 28, 2, 31, 5]) }],
    }))
    expect(flat?.[0]).toBe(0)
    expect(swingy![0]).toBeGreaterThan(0.8)
    expect(swingy![1]).toBe(17)
  })

  it('reads the most recent usable season, not a blend', () => {
    // A player's role is what is being measured, and roles change between
    // seasons often enough that averaging two describes nobody.
    const pair = consistencyFrom(record({
      name: 'changed',
      seasons: [
        { season: 2024, weekly: weeks(Array(17).fill(4)) },
        { season: 2025, weekly: weeks(Array(17).fill(15)) },
      ],
    }))
    expect(pair?.[1]).toBe(17)
    expect(pair?.[0]).toBe(0)
  })

  it('abstains on too small a sample or too low a mean', () => {
    expect(consistencyFrom(record({ name: 'hurt', seasons: [{ season: 2025, weekly: weeks([12, 14, 9]) }] }))).toBeUndefined()
    // A near-zero mean makes the ratio explode and says nothing about a floor.
    expect(consistencyFrom(record({ name: 'deep', seasons: [{ season: 2025, weekly: weeks(Array(17).fill(0.5)) }] }))).toBeUndefined()
    expect(consistencyFrom(record({ name: 'rookie' }))).toBeUndefined()
  })
})

describe('buildPlayerShards', () => {
  it('carries availability in the index, not just the bucket', () => {
    // The draft board prices the whole pool at once and cannot fetch 128
    // buckets to do it, so this window has to reach the index itself.
    const built = buildPlayerShards({
      generatedAt: 'now',
      players: [record({ name: 'bijan', seasons: [season(2025, 17, 0), season(2024, 17, 0)] })],
    })
    expect(built.index.players[0]?.a).toEqual([2025, 17, 0, 2024, 17, 0])
  })

  it('carries consistency in the index too', () => {
    const built = buildPlayerShards({
      generatedAt: 'now',
      players: [record({ name: 'steady', seasons: [{ season: 2025, weekly: weeks(Array(17).fill(15)) }] })],
    })
    expect(built.index.players[0]?.c).toEqual([0, 17])
  })

  it('omits both fields entirely for a player with no history', () => {
    const built = buildPlayerShards({ generatedAt: 'now', players: [record({ name: 'rookie' })] })
    expect(built.index.players[0]).not.toHaveProperty('a')
    expect(built.index.players[0]).not.toHaveProperty('c')
  })

  it('still routes every player to a bucket', () => {
    const players = [record({ name: 'a' }), record({ name: 'b', seasons: [season(2025, 17, 0)] })]
    const built = buildPlayerShards({ generatedAt: 'now', players })
    const stored = built.buckets.flatMap((bucket) => bucket.body.players)
    expect(stored).toHaveLength(2)
    for (const entry of built.index.players) {
      expect(built.buckets[entry.d]?.body.players.some((p) => p.ids.gsis === entry.g)).toBe(true)
    }
  })
})
