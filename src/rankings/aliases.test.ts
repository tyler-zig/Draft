import { describe, expect, it } from 'vitest'
import { NAME_ALIASES, resolveNameAlias } from './aliases'
import { normalizeName } from './normalize'
import { buildPlayerIndex, matchRow } from './match'
import type { Player } from '../providers/types'

const player = (overrides: Partial<Player>): Player => ({
  id: 'x', firstName: '', lastName: '', fullName: '', position: 'RB', team: 'NYJ',
  searchRank: 100, injuryStatus: null, number: null, yearsExp: null, bye: null, ...overrides,
})

describe('resolveNameAlias', () => {
  it('maps a nickname to the name Sleeper uses', () => {
    expect(resolveNameAlias('bam knight')).toBe('zonovan knight')
  })

  it('leaves names it does not know alone', () => {
    expect(resolveNameAlias('jahmyr gibbs')).toBe('jahmyr gibbs')
  })

  it('never maps a canonical name onto another entry', () => {
    // Both sides must converge on the same string, so a value that is also a
    // key would bounce a name through two hops and land somewhere wrong.
    for (const canonical of Object.values(NAME_ALIASES)) {
      expect(NAME_ALIASES[canonical]).toBeUndefined()
    }
  })
})

describe('normalizeName resolves aliases after stripping', () => {
  it('collapses a nickname carrying a generational suffix', () => {
    expect(normalizeName('Juice Wells Jr.')).toBe('antwane wells')
    expect(normalizeName('Antwane Wells Jr.')).toBe('antwane wells')
  })

  it.each([
    ['Hollywood Brown', 'Marquise Brown'],
    ['Bam Knight', 'Zonovan Knight'],
    ['Chip Trayanum', 'DeaMonte Trayanum'],
  ])('makes %s and %s the same name', (nickname, legal) => {
    expect(normalizeName(nickname)).toBe(normalizeName(legal))
  })
})

describe('matching through an alias', () => {
  it('matches a nickname row to the directory player', () => {
    const directory = [player({ id: '8122', sleeperId: '8122', fullName: 'Zonovan Knight', team: 'ARI' })]
    const index = buildPlayerIndex(directory)
    const hit = matchRow({ name: 'Bam Knight', team: 'ARI', position: 'RB', overall: 354 }, index)
    expect(hit?.sleeperId).toBe('8122')
  })

  it('matches when only the directory uses the nickname', () => {
    const directory = [player({ id: '8122', sleeperId: '8122', fullName: 'Bam Knight', team: 'ARI' })]
    const index = buildPlayerIndex(directory)
    const hit = matchRow({ name: 'Zonovan Knight', team: 'ARI', position: 'RB', overall: 354 }, index)
    expect(hit?.sleeperId).toBe('8122')
  })
})

describe('matching team defenses', () => {
  it('matches Houston Texans to Texans D/ST without an ESPN id', () => {
    const directory = [player({ id: '-16034', espnId: '-16034', fullName: 'Texans D/ST', position: 'DEF', team: 'HOU' })]
    const index = buildPlayerIndex(directory)
    const hit = matchRow({ name: 'Houston Texans', team: 'HOU', position: 'DEF', overall: 102, adp: 105.6 }, index)
    expect(hit?.id).toBe('-16034')
  })
})
