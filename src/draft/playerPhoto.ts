import type { Player } from '../providers/types'

const ESPN_TEAM_LOGO: Record<string, string> = {
  WAS: 'wsh',
  WSH: 'wsh',
  JAC: 'jax',
  JAX: 'jax',
  LA: 'lar',
}

export type PhotoPlayer = Pick<
  Player,
  'id' | 'firstName' | 'lastName' | 'position' | 'team' | 'espnId' | 'sleeperId'
>

export function nflTeamLogoUrl(team: string | null | undefined): string | null {
  if (!team) return null
  const code = ESPN_TEAM_LOGO[team.toUpperCase()] ?? team.toLowerCase()
  if (!/^[a-z]{2,3}$/.test(code)) return null
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${code}.png`
}

export function playerPhotoUrls(player: PhotoPlayer): string[] {
  if (player.position === 'DEF') {
    const url = nflTeamLogoUrl(player.team || player.id)
    return url ? [url] : []
  }

  const urls: string[] = []
  if (player.espnId) {
    urls.push(`https://a.espncdn.com/i/headshots/nfl/players/full/${encodeURIComponent(player.espnId)}.png`)
  }
  const sleeperId = player.sleeperId ?? (player.espnId ? undefined : player.id)
  if (sleeperId) {
    urls.push(`https://sleepercdn.com/content/nfl/players/thumb/${encodeURIComponent(sleeperId)}.jpg`)
  }
  return urls
}
