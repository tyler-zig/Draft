export interface RosterWeek {
  playerId: string
  team: string
  week: number
  status: string
}

const EXCLUDED_STATUSES = new Set(['DEV', 'CUT'])

export function calculateGamesMissed(
  roster: RosterWeek[],
  teamGames: Set<string>,
  participated: Set<string>,
) {
  const missedWeeks: number[] = []
  const byStatus: Record<string, number> = {}
  const eligible = new Map<string, RosterWeek[]>()
  for (const row of roster) {
    if (EXCLUDED_STATUSES.has(row.status) || !teamGames.has(`${row.team}|${row.week}`)) continue
    const key = `${row.playerId}|${row.week}`
    eligible.set(key, [...(eligible.get(key) ?? []), row])
  }
  for (const rows of eligible.values()) {
    if (rows.some((row) => participated.has(`${row.playerId}|${row.team}|${row.week}`))) continue
    const row = rows[0]
    missedWeeks.push(row.week)
    const status = rows.find((item) => item.status === 'ACT')?.status || row.status || 'UNKNOWN'
    byStatus[status] = (byStatus[status] ?? 0) + 1
  }
  return { gamesMissed: missedWeeks.length, missedWeeks: [...new Set(missedWeeks)].sort((a, b) => a - b), byStatus }
}
