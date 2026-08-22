import { describe, expect, it } from 'vitest'
import { byeWeekDistribution, formatByePositions, scoreByeFit } from './byeWeeks'

describe('bye week distribution', () => {
  it('groups rostered players by bye and flags a same-position stack', () => {
    const rows = byeWeekDistribution([
      { bye: 10, position: 'RB' },
      { bye: 10, position: 'RB' },
      { bye: 10, position: 'WR' },
      { bye: 5, position: 'QB' },
      { bye: null, position: 'TE' },
      null,
    ])
    expect(rows).toEqual([
      { week: 5, count: 1, byPosition: [{ position: 'QB', count: 1 }], stacked: false },
      {
        week: 10,
        count: 3,
        byPosition: [{ position: 'RB', count: 2 }, { position: 'WR', count: 1 }],
        stacked: true,
      },
    ])
    expect(formatByePositions(rows[1]!.byPosition)).toBe('2 RB · WR')
  })

  it('returns nothing when no player has a known bye', () => {
    expect(byeWeekDistribution([{ bye: null, position: 'RB' }, undefined])).toEqual([])
  })
})

describe('scoreByeFit', () => {
  it('rewards a starter whose bye week is still empty', () => {
    expect(scoreByeFit({
      bye: 9, position: 'WR', addingStarter: true,
      roster: [{ bye: 5, position: 'QB', starter: true }],
    })).toEqual({ delta: 10, reason: 'Open bye 9' })
  })

  it('penalizes adding another starter to a crowded bye week', () => {
    expect(scoreByeFit({
      bye: 10, position: 'WR', addingStarter: true,
      roster: [
        { bye: 10, position: 'RB', starter: true },
        { bye: 10, position: 'WR', starter: true },
        { bye: 10, position: 'TE', starter: true },
      ],
    })).toEqual({ delta: -28, reason: '4 starters on bye 10' })
  })

  it('calls out a same-position stack before a generic starter pile-up', () => {
    expect(scoreByeFit({
      bye: 7, position: 'RB', addingStarter: true,
      roster: [
        { bye: 7, position: 'RB', starter: true },
        { bye: 7, position: 'RB', starter: true },
      ],
    })).toEqual({ delta: -25, reason: '3 RBs on bye 7' })
  })

  it('does not reward an unused bye when the player is a bench add', () => {
    expect(scoreByeFit({
      bye: 12, position: 'RB', addingStarter: false,
      roster: [],
    })).toEqual({ delta: 0, reason: null })
  })
})
