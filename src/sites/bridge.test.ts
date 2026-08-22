import { describe, expect, it } from 'vitest'
import { parseSiteRef, siteTeamPageUrl } from './bridge'

describe('parseSiteRef', () => {
  it('reads a Yahoo league path and optional team seat', () => {
    expect(parseSiteRef('yahoo', 'https://football.fantasysports.yahoo.com/f1/123456/3')).toMatchObject({
      leagueId: '123456', teamId: '3',
    })
    expect(parseSiteRef('yahoo', '123456')?.url).toBe(siteTeamPageUrl('yahoo', '123456'))
  })

  it('reads an NFL.com league URL', () => {
    expect(parseSiteRef('nfl', 'https://fantasy.nfl.com/league/7654321?teamId=2')).toMatchObject({
      leagueId: '7654321', teamId: '2',
    })
    expect(parseSiteRef('nfl', '7654321')?.leagueId).toBe('7654321')
  })

  it('rejects a foreign host', () => {
    expect(parseSiteRef('nfl', 'https://example.com/league/1')).toBeNull()
    expect(parseSiteRef('yahoo', 'https://fantasy.espn.com/f1/1')).toBeNull()
  })
})
