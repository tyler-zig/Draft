import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const path = resolve(import.meta.dirname, '..', process.argv[2] ?? 'public/intelligence/latest.json')
const value = JSON.parse(await readFile(path, 'utf8'))
if (value.schemaVersion !== 1 || !Array.isArray(value.players) || !value.players.length) throw new Error('Invalid intelligence artifact: no players.')
for (const player of value.players) {
  if (!player?.ids?.gsis || !Array.isArray(player.seasons)) throw new Error(`Invalid player: ${player?.name ?? 'unknown'}`)
  for (const season of player.seasons) for (const metric of ['touchShare', 'redZoneTouchShare', 'snapShare']) {
    const number = season?.usage?.[metric]
    if (number != null && (!Number.isFinite(number) || number < 0 || number > 1.001)) throw new Error(`Invalid ${metric} for ${player.name}`)
  }
}
if (!value.schedule?.teams || Object.keys(value.schedule.teams).length !== 32) throw new Error('Invalid intelligence artifact: schedule must cover 32 teams.')
if (!value.matchups?.byScoring?.ppr) throw new Error('Invalid intelligence artifact: matchup ranks are missing.')
for (const scoring of ['ppr', 'half', 'standard']) {
  for (const position of ['QB', 'RB', 'WR', 'TE']) {
    const ranks = Object.values(value.matchups.byScoring[scoring]?.[position] ?? {}).map((entry) => entry.rank).sort((left, right) => left - right)
    if (ranks.length !== 32 || ranks[0] !== 1 || ranks.at(-1) !== 32) throw new Error(`Invalid ${scoring} ${position} matchup ranks`)
  }
}
console.log(JSON.stringify({ valid: true, schemaVersion: value.schemaVersion, players: value.players.length, seasons: value.seasons, scheduleSeason: value.schedule.season, scheduleTeams: Object.keys(value.schedule.teams).length }))
