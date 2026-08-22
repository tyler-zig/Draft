import type { Player, ScoringType } from '../providers/types'
import { matchRows } from './match'
import { parseRankingFile, rowsFromPastedRankings } from './parse'
import { normalizeSetRanks } from './consensus'
import { loadImportedSets, saveImportedSets } from './store'
import type { RankSet } from './types'

export async function importRankingFile(options: {
  filename: string
  text: string
  label?: string
  scoring?: ScoringType
  directory: Player[]
}): Promise<RankSet> {
  const rawRows = parseRankingFile(options.filename, options.text)
  if (rawRows.length === 0) {
    throw new Error('No player rows found in that file')
  }
  const { matched, unmatched } = matchRows(rawRows, options.directory)
  if (matched.length === 0) {
    throw new Error(
      `Could not match any of ${rawRows.length} rows. Use name, team, pos columns (or sleeper_id / espn_id).`,
    )
  }
  const set: RankSet = {
    id: `import:${Date.now()}`,
    label: options.label || options.filename.replace(/\.[^.]+$/, ''),
    scoring: options.scoring ?? 'unknown',
    kind: 'import',
    fetchedAt: Date.now(),
    rows: normalizeSetRanks(matched),
    unmatched,
  }
  const existing = await loadImportedSets()
  await saveImportedSets([...existing, set])
  return set
}

export async function importPastedRankings(options: {
  text: string
  label: string
  scoring?: ScoringType
  directory: Player[]
}): Promise<RankSet> {
  const rawRows = rowsFromPastedRankings(options.text)
  const { matched, unmatched } = matchRows(rawRows, options.directory)
  if (matched.length === 0) {
    throw new Error('Could not match any players. Include player name, team, and position when copying.')
  }
  const set: RankSet = {
    id: `import:${Date.now()}`,
    label: options.label.trim() || 'Pasted rankings',
    scoring: options.scoring ?? 'unknown',
    kind: 'import',
    fetchedAt: Date.now(),
    rows: normalizeSetRanks(matched),
    unmatched,
  }
  const existing = await loadImportedSets()
  await saveImportedSets([...existing, set])
  return set
}

export async function importScrapedRankings(options: {
  rows: import('./types').RankRow[]
  label: string
  directory: Player[]
}): Promise<RankSet> {
  const { matched, unmatched } = matchRows(options.rows, options.directory)
  if (matched.length === 0) throw new Error('The scraped page did not contain matchable player rows.')
  const set: RankSet = {
    id: `import:${Date.now()}`,
    label: options.label,
    scoring: 'unknown',
    kind: 'import',
    fetchedAt: Date.now(),
    rows: normalizeSetRanks(matched),
    unmatched,
  }
  const existing = await loadImportedSets()
  await saveImportedSets([...existing, set])
  return set
}

export async function deleteImportedSet(id: string): Promise<void> {
  const existing = await loadImportedSets()
  await saveImportedSets(existing.filter((set) => set.id !== id))
}
