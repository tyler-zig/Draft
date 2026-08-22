import { describe, expect, it } from 'vitest'
import { normalizeTwitterHandle, parseTwitterCatalog, twitterHandleFor, twitterUrl } from './playerTwitter'

const catalog = parseTwitterCatalog({
  schemaVersion: 1,
  source: 'test',
  bySleeper: { '6770': 'Joe_Burrow10' },
  byEspn: { '3139477': '@PatMahomes' },
  byGsis: { '00-0033873': 'https://x.com/CMC_22' },
})

describe('player Twitter lookup', () => {
  it('accepts sourced handles and rejects placeholders', () => {
    expect(normalizeTwitterHandle('Joe_Burrow10')).toBe('Joe_Burrow10')
    expect(normalizeTwitterHandle('@PatMahomes')).toBe('PatMahomes')
    expect(normalizeTwitterHandle('https://x.com/CMC_22')).toBe('CMC_22')
    expect(normalizeTwitterHandle('NA')).toBeNull()
    expect(normalizeTwitterHandle('not a handle!!')).toBeNull()
  })

  it('resolves by sleeper, ESPN, then GSIS id', () => {
    expect(twitterHandleFor({ sleeperId: '6770' }, catalog)).toBe('Joe_Burrow10')
    expect(twitterHandleFor({ espnId: '3139477' }, catalog)).toBe('PatMahomes')
    expect(twitterHandleFor({ gsisId: '00-0033873' }, catalog)).toBe('CMC_22')
    expect(twitterHandleFor({ sleeperId: 'missing' }, catalog)).toBeNull()
    expect(twitterUrl('Joe_Burrow10')).toBe('https://x.com/Joe_Burrow10')
  })
})
