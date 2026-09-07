import { describe, expect, it } from 'vitest'
import type { Player } from '../providers/types'
import { choppedNeedScale, choppedTerms } from './chopped'

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

describe('choppedTerms', () => {
  const base = { horizonPickNo: 8, teams: 18, yourPlayers: [] as Player[] }

  it('waits on a quarterback in the first five rounds', () => {
    const terms = choppedTerms({ ...base, player: player({ id: 'qb', position: 'QB' }) })
    expect(terms).toContainEqual({ label: 'Wait on QB', delta: -32, reason: 'Wait on QB' })
  })

  it('stops waiting on QB after the early-round window', () => {
    const terms = choppedTerms({
      ...base,
      horizonPickNo: 91,
      player: player({ id: 'qb', position: 'QB' }),
    })
    expect(terms.some((term) => term.label === 'Wait on QB')).toBe(false)
  })

  it('penalizes a rookie and a week-1 injury', () => {
    const rookie = choppedTerms({ ...base, player: player({ id: 'kid', yearsExp: 0 }) })
    expect(rookie.some((term) => term.label === 'Rookie volatility')).toBe(true)
    const ir = choppedTerms({ ...base, player: player({ id: 'hurt', injuryStatus: 'IR' }) })
    expect(ir.some((term) => term.label === 'Week-1 injury risk' && term.delta === -30)).toBe(true)
    const q = choppedTerms({ ...base, player: player({ id: 'q', injuryStatus: 'Questionable' }) })
    expect(q.some((term) => term.delta === -18 && term.reason === 'Questionable')).toBe(true)
  })

  it('prefers a consensus floor over a volatile rank', () => {
    const floor = choppedTerms({ ...base, player: player({ id: 'lock', rankStdDev: 2 }) })
    expect(floor).toContainEqual({ label: 'High-floor consensus', delta: 10, reason: 'High-floor consensus' })
    const boom = choppedTerms({ ...base, player: player({ id: 'bust', rankStdDev: 14 }) })
    expect(boom).toContainEqual({ label: 'Volatile rank', delta: -16, reason: 'Volatile rank' })
  })

  it('flags a second player on an early bye and a shared early-bye stack', () => {
    const owned = player({ id: 'chase', position: 'WR', team: 'CIN', bye: 6, fullName: 'Ja\'Marr Chase' })
    const pile = choppedTerms({
      ...base,
      yourPlayers: [owned],
      player: player({ id: 'brown', position: 'RB', team: 'CIN', bye: 6 }),
    })
    expect(pile.some((term) => term.label === 'Early bye week 6')).toBe(true)

    const stack = choppedTerms({
      ...base,
      yourPlayers: [owned],
      player: player({ id: 'burrow', position: 'QB', team: 'CIN', bye: 6, fullName: 'Joe Burrow' }),
    })
    expect(stack.some((term) => term.label.startsWith('Shared early bye'))).toBe(true)
  })

  it('uses weeks 1-4 SoS, not a playoff window', () => {
    const easy = choppedTerms({
      ...base,
      player: player({ id: 'soft', playoffSos: { averageMatchupRank: 8, rank: 3, games: 4 } }),
    })
    expect(easy).toContainEqual({ label: 'Easy weeks 1–4', delta: 12, reason: 'Easy weeks 1–4' })
    const tough = choppedTerms({
      ...base,
      player: player({ id: 'hard', playoffSos: { averageMatchupRank: 28, rank: 26, games: 4 } }),
    })
    expect(tough).toContainEqual({ label: 'Tough weeks 1–4', delta: -12, reason: 'Tough weeks 1–4' })
  })
})
