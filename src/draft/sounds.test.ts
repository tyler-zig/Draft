import { describe, expect, it } from 'vitest'
import { addedPickCount, pickIdentity } from './sounds'

describe('draft sound triggers', () => {
  it('is silent on the first snapshot so a mid-draft join does not replay the board', () => {
    const { added, next } = addedPickCount(null, [
      { pickNo: 1, playerId: 'a' },
      { pickNo: 2, playerId: 'b' },
    ])
    expect(added).toBe(0)
    expect(next.size).toBe(2)
  })

  it('counts only newly arrived picks', () => {
    const previous = new Set([pickIdentity({ pickNo: 1, playerId: 'a' })])
    const { added } = addedPickCount(previous, [
      { pickNo: 1, playerId: 'a' },
      { pickNo: 2, playerId: 'b' },
      { pickNo: 3, playerId: 'c' },
    ])
    expect(added).toBe(2)
  })
})
