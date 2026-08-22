import { describe, expect, it } from 'vitest'
import { toNumber } from './text.mjs'

describe('toNumber', () => {
  it('reads a plain number', () => {
    expect(toNumber('4.2')).toBe(4.2)
    expect(toNumber('1,234')).toBe(1234)
  })

  it('reads a real zero', () => {
    expect(toNumber('0')).toBe(0)
  })

  it('treats a blank cell as no value, not as zero', () => {
    // `Number('')` is 0, which made every blank ADP column read as "drafted
    // first overall" and, through last-write-wins merging, erased good values.
    expect(toNumber('')).toBeNull()
    expect(toNumber('   ')).toBeNull()
  })

  it('treats placeholder dashes as no value', () => {
    expect(toNumber('-')).toBeNull()
    expect(toNumber('—')).toBeNull()
    expect(toNumber('N/A')).toBeNull()
  })

  it('is null for absent input', () => {
    expect(toNumber(null)).toBeNull()
    expect(toNumber(undefined)).toBeNull()
  })

  it('still digs a number out of a decorated cell', () => {
    expect(toNumber('R3')).toBe(3)
  })
})
