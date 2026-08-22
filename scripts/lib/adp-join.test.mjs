import { describe, expect, it } from 'vitest'
import { buildAdpIndex, joinAdp } from './adp-join.mjs'

const artifact = {
  players: {
    '17240': { n: "Ja'Marr Chase", t: 'CIN', p: 'WR', adp: 3 },
    '23180': { n: 'Jahmyr Gibbs', t: 'DET', p: 'RB', adp: 1 },
    '19788': { n: 'No Adp Guy', t: 'GB', p: 'WR', adp: null },
    '19799': { n: 'Blank Cell Guy', t: 'NYJ', p: 'RB', adp: 0 },
    'T:SF:DEF': { n: '49ers', t: 'SF', p: 'DEF', adp: 140 },
  },
}

describe('buildAdpIndex', () => {
  it('indexes by FantasyPros id and by name', () => {
    const index = buildAdpIndex(artifact)
    expect(index.byId.get('17240')).toBe(3)
    expect(index.byName.get('jamarrchase:WR')).toBe(3)
  })

  it('skips players the artifact has no ADP for', () => {
    const index = buildAdpIndex(artifact)
    expect(index.byId.has('19788')).toBe(false)
  })

  it('treats a zero ADP as absent, not as the first overall pick', () => {
    const index = buildAdpIndex(artifact)
    expect(index.byId.has('19799')).toBe(false)
    expect(index.byName.has('blankcellguy:RB')).toBe(false)
  })

  it('keeps synthetic defense keys out of the id index', () => {
    const index = buildAdpIndex(artifact)
    expect(index.byId.has('T:SF:DEF')).toBe(false)
    // Still reachable by name, which is how defenses match elsewhere.
    expect(index.byName.get('ers:DEF')).toBe(140)
  })

  it('survives an artifact with no players', () => {
    expect(buildAdpIndex({}).byId.size).toBe(0)
    expect(buildAdpIndex(undefined).byName.size).toBe(0)
  })
})

describe('joinAdp', () => {
  const index = buildAdpIndex(artifact)

  it('fills ADP by FantasyPros id', () => {
    const { rows, filled } = joinAdp([{ name: "Ja'Marr Chase", position: 'WR', fantasyProsId: '17240' }], index)
    expect(filled).toBe(1)
    expect(rows[0].adp).toBe(3)
  })

  it('falls back to name and position when the id is missing', () => {
    const { rows, filled } = joinAdp([{ name: 'Jahmyr Gibbs', position: 'RB' }], index)
    expect(filled).toBe(1)
    expect(rows[0].adp).toBe(1)
  })

  it('does not overwrite an ADP the source reported itself', () => {
    const { rows, filled } = joinAdp([{ name: "Ja'Marr Chase", position: 'WR', fantasyProsId: '17240', adp: 99 }], index)
    expect(filled).toBe(0)
    expect(rows[0].adp).toBe(99)
  })

  it('leaves unknown players alone', () => {
    const { rows, filled } = joinAdp([{ name: 'Nobody At All', position: 'TE' }], index)
    expect(filled).toBe(0)
    expect(rows[0].adp).toBeUndefined()
  })

  it('does not mutate the rows it is given', () => {
    const original = { name: 'Jahmyr Gibbs', position: 'RB' }
    joinAdp([original], index)
    expect(original.adp).toBeUndefined()
  })
})
