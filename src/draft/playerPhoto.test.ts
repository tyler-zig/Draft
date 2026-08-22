import { describe, expect, it } from 'vitest'
import { nflTeamLogoUrl, playerPhotoUrls, type PhotoPlayer } from './playerPhoto'

function player(overrides: Partial<PhotoPlayer> = {}): PhotoPlayer {
  return {
    id: '1',
    firstName: 'Test',
    lastName: 'Runner',
    position: 'RB',
    team: 'CHI',
    ...overrides,
  }
}

describe('playerPhotoUrls', () => {
  it('prefers an ESPN headshot and falls back to Sleeper', () => {
    expect(playerPhotoUrls(player({ espnId: '42', sleeperId: '900' }))).toEqual([
      'https://a.espncdn.com/i/headshots/nfl/players/full/42.png',
      'https://sleepercdn.com/content/nfl/players/thumb/900.jpg',
    ])
  })

  it('uses the Sleeper id when ESPN is missing', () => {
    expect(playerPhotoUrls(player({ id: '4046' }))).toEqual([
      'https://sleepercdn.com/content/nfl/players/thumb/4046.jpg',
    ])
  })

  it('uses an NFL logo for defenses', () => {
    expect(playerPhotoUrls(player({ position: 'DEF', team: 'WAS', id: 'WAS' }))).toEqual([
      'https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png',
    ])
  })
})

describe('nflTeamLogoUrl', () => {
  it('maps common NFL abbreviations onto ESPN logo codes', () => {
    expect(nflTeamLogoUrl('CHI')).toBe('https://a.espncdn.com/i/teamlogos/nfl/500/chi.png')
    expect(nflTeamLogoUrl('WAS')).toBe('https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png')
    expect(nflTeamLogoUrl(null)).toBeNull()
  })
})
