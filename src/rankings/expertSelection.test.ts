import { describe, expect, it } from 'vitest'
import { oldestSync, scoringFor, type ExpertSnapshot } from './experts'
import { fantasyProsConsensusId, installedExpertSlugs, isFantasyProsSource, replaceFantasyProsSource } from './expertSelection'

describe('expert ranking selection', () => {
  it('maps league scoring and identifies fallback guesses', () => {
    expect(scoringFor('half_ppr')).toEqual({ scoring: 'half', detected: true })
    expect(scoringFor('std')).toEqual({ scoring: 'standard', detected: true })
    expect(scoringFor('unknown')).toEqual({ scoring: 'ppr', detected: false })
  })

  it('keeps FantasyPros consensus and individual experts mutually exclusive', () => {
    const enabled = ['builtin:sleeper', 'collected:rotowire-half', 'collected:fantasypros-ppr', 'expert:ppr:one']
    expect(replaceFantasyProsSource(enabled, [fantasyProsConsensusId('half')])).toEqual([
      'builtin:sleeper', 'collected:rotowire-half', 'collected:fantasypros-half',
    ])
    expect(replaceFantasyProsSource(enabled, ['expert:half:two'])).toEqual([
      'builtin:sleeper', 'collected:rotowire-half', 'expert:half:two',
    ])
  })

  it('identifies managed FantasyPros source ids', () => {
    expect(isFantasyProsSource('collected:fantasypros-ppr')).toBe(true)
    expect(isFantasyProsSource('expert:half:alpha')).toBe(true)
    expect(isFantasyProsSource('builtin:sleeper')).toBe(false)
    expect(isFantasyProsSource('collected:rotowire-ppr')).toBe(false)
  })

  it('extracts installed slugs and reports the oldest board sync', () => {
    expect(installedExpertSlugs(['expert:half:one', 'expert:ppr:skip', 'expert:half:two'], 'half')).toEqual(['one', 'two'])
    const snapshot = { experts: [{ fetchedAt: 30 }, { fetchedAt: 10 }, { fetchedAt: 20 }] } as ExpertSnapshot
    expect(oldestSync(snapshot)).toBe(10)
  })
})
