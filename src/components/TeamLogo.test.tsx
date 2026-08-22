import { describe, expect, it } from 'vitest'
import { teamInitials } from './TeamLogo'

describe('teamInitials', () => {
  it('uses the first letter of the first two words', () => {
    expect(teamInitials('Harbor Hawks')).toBe('HH')
  })

  it('uses the first two letters of a single word', () => {
    expect(teamInitials('Showtime')).toBe('SH')
  })

  it('falls back when the league has no team name', () => {
    expect(teamInitials('')).toBe('TM')
  })
})
