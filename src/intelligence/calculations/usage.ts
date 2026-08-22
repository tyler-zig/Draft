export interface OpportunityRow {
  playerId: string
  team: string
  carries: number
  targets: number
  week?: number
}

export interface RedZoneOpportunity {
  playerId: string
  team: string
  kind: 'carry' | 'target'
  week?: number
}

export interface SnapRow {
  playerId: string
  team: string
  gameId: string
  offenseSnaps: number
}

const ratio = (part: number, whole: number) => whole > 0 ? part / whole : null

export function calculateOpportunityShares(rows: OpportunityRow[], redZone: RedZoneOpportunity[]) {
  const team = new Map<string, number>(), player = new Map<string, number>()
  for (const row of rows) {
    const opportunities = row.carries + row.targets
    const key = `${row.team}|${row.week ?? '*'}`
    team.set(key, (team.get(key) ?? 0) + opportunities)
    player.set(row.playerId, (player.get(row.playerId) ?? 0) + opportunities)
  }
  const redZoneTeam = new Map<string, number>(), redZonePlayer = new Map<string, number>()
  for (const row of redZone) {
    const key = `${row.team}|${row.week ?? '*'}`
    redZoneTeam.set(key, (redZoneTeam.get(key) ?? 0) + 1)
    redZonePlayer.set(row.playerId, (redZonePlayer.get(row.playerId) ?? 0) + 1)
  }
  return new Map([...player].map(([playerId, opportunities]) => {
    const playerRows = rows.filter((row) => row.playerId === playerId)
    const windows = [...new Set(playerRows.map((row) => `${row.team}|${row.week ?? '*'}`))]
    const teamOpportunities = windows.reduce((sum, value) => sum + (team.get(value) ?? 0), 0)
    const redZoneOpportunities = redZonePlayer.get(playerId) ?? 0
    const teamRedZoneOpportunities = windows.reduce((sum, value) => sum + (redZoneTeam.get(value) ?? 0), 0)
    return [playerId, { opportunities, touchShare: ratio(opportunities, teamOpportunities), redZoneOpportunities, redZoneTouchShare: ratio(redZoneOpportunities, teamRedZoneOpportunities) }]
  }))
}

export function calculateSnapShares(rows: SnapRow[]) {
  const teamGame = new Map<string, number>()
  for (const row of rows) {
    const key = `${row.team}|${row.gameId}`
    teamGame.set(key, Math.max(teamGame.get(key) ?? 0, row.offenseSnaps))
  }
  const players = new Map<string, { snaps: number; possible: number; games: Set<string> }>()
  for (const row of rows) {
    const value = players.get(row.playerId) ?? { snaps: 0, possible: 0, games: new Set<string>() }
    value.snaps += row.offenseSnaps
    if (!value.games.has(row.gameId)) {
      value.possible += teamGame.get(`${row.team}|${row.gameId}`) ?? 0
      value.games.add(row.gameId)
    }
    players.set(row.playerId, value)
  }
  return new Map([...players].map(([playerId, value]) => [playerId, { offenseSnaps: value.snaps, snapShare: ratio(value.snaps, value.possible) }]))
}
