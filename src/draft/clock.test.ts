import { describe, expect, it } from 'vitest'
import { formatPickClock, remainingPickSeconds } from './clock'

describe('formatPickClock', () => {
  it('formats minutes and seconds the way ESPN does', () => {
    expect(formatPickClock(90)).toBe('1:30')
    expect(formatPickClock(7)).toBe('0:07')
    expect(formatPickClock(0)).toBe('0:00')
  })
})

describe('remainingPickSeconds', () => {
  it('uses the frozen remaining value while paused', () => {
    expect(remainingPickSeconds({ remaining: 41, endsAt: null, paused: true }, 1_000)).toBe(41)
  })

  it('counts down from endsAt when the clock is running', () => {
    expect(remainingPickSeconds({ remaining: 90, endsAt: 10_000, paused: false }, 4_200)).toBe(6)
  })

  it('does not go negative after the pick expires', () => {
    expect(remainingPickSeconds({ remaining: 1, endsAt: 10_000 }, 12_000)).toBe(0)
  })
})
