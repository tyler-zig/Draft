import { describe, expect, it } from 'vitest'
import { injuryTone, isSevereInjury } from './injuryStatus'

describe('injuryTone', () => {
  it('treats weekly report statuses as a caution', () => {
    expect(injuryTone('QUESTIONABLE')).toBe('warn')
    expect(injuryTone('Questionable')).toBe('warn')
    expect(injuryTone('Doubtful')).toBe('warn')
    expect(injuryTone('NA')).toBe('warn')
  })

  it('treats IR, PUP, out, and suspensions as unavailable', () => {
    expect(injuryTone('IR')).toBe('out')
    expect(injuryTone('INJURY_RESERVE')).toBe('out')
    expect(injuryTone('Injured Reserve')).toBe('out')
    expect(injuryTone('PUP')).toBe('out')
    expect(injuryTone('OUT')).toBe('out')
    expect(injuryTone('Sus')).toBe('out')
    expect(injuryTone('SUSPENSION')).toBe('out')
    expect(injuryTone('NFI')).toBe('out')
  })

  it('ignores a healthy or missing designation', () => {
    expect(injuryTone(null)).toBeNull()
    expect(injuryTone('ACTIVE')).toBeNull()
    expect(injuryTone('')).toBeNull()
  })
})

describe('isSevereInjury', () => {
  it('is true only for unavailable designations', () => {
    expect(isSevereInjury('IR')).toBe(true)
    expect(isSevereInjury('Questionable')).toBe(false)
    expect(isSevereInjury(null)).toBe(false)
  })
})
