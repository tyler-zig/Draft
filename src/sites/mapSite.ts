import { defaultSlotCounts, type DraftPick, type DraftSession, type LeagueSummary, type Player } from '../providers/types'
import type { SiteProviderId, SiteSnapshot } from './types'

export function siteDraftId(season: string, leagueId: string) {
  return `${season}:${leagueId}`
}

export function parseSiteDraftId(draftId: string) {
  const [season, ...rest] = draftId.split(':')
  const leagueId = rest.join(':')
  if (!season || !leagueId) throw new Error(`Invalid site draft id: ${draftId}`)
  return { season, leagueId }
}

export function snapshotIds(snapshot: SiteSnapshot) {
  const leagueId = snapshot.leagueId || ''
  const season = snapshot.season || '2026'
  if (!leagueId) throw new Error(`${labelFor(snapshot.provider)} snapshot is missing a league id`)
  return { leagueId, season }
}

export function mapSiteLeague(snapshot: SiteSnapshot): LeagueSummary {
  const { leagueId, season } = snapshotIds(snapshot)
  const league = snapshot.league
  if (!league) throw new Error(`${labelFor(snapshot.provider)} snapshot has no league payload`)
  return {
    id: leagueId,
    name: league.name || `${labelFor(snapshot.provider)} ${leagueId}`,
    season,
    teamCount: league.teamCount || league.teams.length,
    status: league.draftStatus,
    scoringType: league.scoringType,
    keeperCount: league.keeperCount ?? null,
    draftId: siteDraftId(season, leagueId),
    draftStatus: league.draftStatus,
    avatar: null,
    teams: league.teams.map((team) => ({
      id: team.id,
      name: team.name,
      isYou: Boolean(team.isYou || (snapshot.teamId && team.id === snapshot.teamId)),
    })),
  }
}

export function mapSiteSession(snapshot: SiteSnapshot, yourUserId: string): DraftSession {
  const league = mapSiteLeague(snapshot)
  const { leagueId, season } = snapshotIds(snapshot)
  const teams = snapshot.league?.teams ?? []
  const teamCount = league.teamCount || teams.length || 12
  const order = Array.from({ length: teamCount }, (_, index) => {
    const slot = index + 1
    const team = teams.find((item) => item.draftSlot === slot) ?? teams[index]
    const userId = team?.id ?? String(slot)
    return {
      slot,
      rosterId: userId,
      userId,
      displayName: team?.name ?? `Slot ${slot}`,
      teamName: team?.name ?? `Slot ${slot}`,
      isYou: userId === yourUserId,
    }
  })
  const slots = defaultSlotCounts()
  const rosterPositions = Object.entries(slots).flatMap(([position, count]) => Array.from({ length: count }, () => position))
  const lastRound = Math.max(1, ...(snapshot.league?.picks ?? []).map((pick) => pick.round), rosterPositions.length)
  return {
    provider: snapshot.provider,
    draftId: siteDraftId(season, leagueId),
    leagueId,
    name: league.name,
    type: snapshot.league?.draftType ?? 'snake',
    status: snapshot.league?.draftStatus ?? 'pre_draft',
    season,
    scoringType: league.scoringType,
    teams: teamCount,
    rounds: lastRound,
    pickTimer: snapshot.league?.pickTimer ?? null,
    slots,
    rosterPositions,
    order,
    yourUserId,
    yourSlot: order.find((slot) => slot.isYou)?.slot ?? null,
    startTime: null,
    keeperCount: snapshot.league?.keeperCount ?? null,
    receptionPremium: null,
    // Yahoo/NFL snapshots do not report a playoff window; callers fall back
    // to the standard weeks 15-17 default.
    playoffWeeks: null,
  }
}

export function mapSitePicks(snapshot: SiteSnapshot, directory: Player[] = []): DraftPick[] {
  const players = indexPlayers(directory)
  return (snapshot.league?.picks ?? []).map((pick) => {
    const matched = matchPlayer(pick.playerId, pick.playerName, snapshot.provider, players)
    return {
      playerId: matched?.id ?? pick.playerId,
      pickedByUserId: pick.teamId,
      rosterId: pick.teamId,
      round: pick.round,
      draftSlot: Number(pick.teamId) || 1,
      pickNo: pick.pickNo,
      isKeeper: Boolean(pick.isKeeper),
      meta: matched
        ? {
            firstName: matched.firstName,
            lastName: matched.lastName,
            position: matched.position,
            team: matched.team,
            injuryStatus: matched.injuryStatus,
          }
        : pick.playerName
          ? { firstName: pick.playerName, lastName: '', position: '', team: null, injuryStatus: null }
          : null,
    }
  }).sort((a, b) => a.pickNo - b.pickNo)
}

function labelFor(provider: SiteProviderId) {
  return provider === 'yahoo' ? 'Yahoo' : 'NFL.com'
}

function indexPlayers(directory: Player[]) {
  const byId = new Map<string, Player>()
  const byName = new Map<string, Player>()
  for (const player of directory) {
    for (const id of [player.id, player.sleeperId, player.espnId, player.yahooId, player.gsisId]) {
      if (id) byId.set(id, player)
    }
    byName.set(player.fullName.toLowerCase(), player)
  }
  return { byId, byName }
}

function matchPlayer(
  playerId: string,
  playerName: string | undefined,
  provider: SiteProviderId,
  index: ReturnType<typeof indexPlayers>,
) {
  const bySite = provider === 'yahoo'
    ? [...index.byId.values()].find((player) => player.yahooId === playerId)
    : undefined
  if (bySite) return bySite
  return index.byId.get(playerId) ?? (playerName ? index.byName.get(playerName.toLowerCase()) : undefined)
}
