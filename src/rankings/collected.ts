import type { Player, ScoringType } from '../providers/types'
import { readRankingArtifact } from '../supabase/artifacts'
import { matchRows } from './match'
import { normalizeSetRanks } from './consensus'
import { loadImportedSets, saveImportedSets } from './store'
import type { MatchedRankRow, RankRow, RankSet } from './types'
import { isLiveAdpSetId } from './types'

/**
 * Reads the snapshot written by `npm run scrape:rankings`.
 *
 * The scraper mirrors its output into public/rankings/, so this is a plain
 * static fetch with no server involved. A missing file is a normal state --
 * the collector may simply not have run yet -- and reads as null, not an error.
 */

const COLLECTED_URL = '/rankings/latest.json'
const SUPPORTED_SCHEMA = 2

/** Sets installed from a snapshot are namespaced so a reinstall can replace them. */
export const COLLECTED_PREFIX = 'collected:'

export type Granularity = 'format' | 'board'

interface CollectedSet {
  id: string
  label: string
  scoring: string
  sourceUrl: string
  fetchedAt: number
  rows: RankRow[]
}

export interface CollectedSnapshot {
  schemaVersion: number
  fetchedAt: number
  stats: { sets: number; rows: number; players: number }
  sets: CollectedSet[]
}

/**
 * Collected boards label their formats 'half' and 'standard'; the app's
 * ScoringType calls those 'half_ppr' and 'std'. Expert sets already store the
 * ScoringType spelling, so normalizing here is what lets one comparison match
 * sets from both sources -- previously `RankSet.scoring` held two different
 * vocabularies behind one type, kept quiet by an `as` cast.
 */
function toScoring(value: string): ScoringType {
  if (value === 'ppr') return 'ppr'
  if (value === 'half' || value === 'half_ppr') return 'half_ppr'
  if (value === 'standard' || value === 'std') return 'std'
  return 'unknown'
}

export async function fetchCollectedSnapshot(
  signal?: AbortSignal,
): Promise<CollectedSnapshot | null> {
  let data: CollectedSnapshot
  try {
    const payload = await readRankingArtifact('rankings-latest', COLLECTED_URL, { cache: 'no-store', signal })
    if (!payload) return null
    data = payload as CollectedSnapshot
  } catch {
    return null
  }
  if (data?.schemaVersion !== SUPPORTED_SCHEMA || !Array.isArray(data.sets)) {
    throw new Error(
      `Collected rankings are schema v${data?.schemaVersion ?? '?'}; this build reads v${SUPPORTED_SCHEMA}. Re-run npm run scrape:rankings.`,
    )
  }
  return data
}

const sourceGroup = (id: string) => id.split('-')[0] ?? id
const rowKey = (row: RankRow) =>
  `${row.name.toLowerCase()}|${row.team ?? ''}|${row.position ?? ''}`

/**
 * Merges the boards of one group into a single ordered list.
 *
 * RotoWire publishes ten rows per position per expert, so a player's `overall`
 * is only meaningful within his own board -- concatenating them would interleave
 * QB1 with RB1. ADP is the one field that orders across positions, so it is
 * preferred whenever the group reports it broadly. FantasyPros boards are
 * already a single global 1..N list and pass through untouched.
 */
function mergeRows(sets: CollectedSet[]): RankRow[] {
  const all = sets.flatMap((set) => set.rows)
  const withAdp = all.filter((row) => row.adp != null).length
  const useAdp = all.length > 0 && withAdp / all.length >= 0.8

  const best = new Map<string, RankRow>()
  for (const row of all) {
    const key = rowKey(row)
    const rank = useAdp ? row.adp ?? Infinity : row.overall ?? Infinity
    const existing = best.get(key)
    const existingRank = existing
      ? (useAdp ? existing.adp ?? Infinity : existing.overall ?? Infinity)
      : Infinity
    if (!existing || rank < existingRank) best.set(key, row)
  }

  // normalizeSetRanks re-sorts by `overall` and reassigns 1..N, so seeding it
  // with ADP yields a correct cross-positional order.
  return [...best.values()].map((row) => ({
    ...row,
    overall: useAdp ? row.adp ?? 9999 : row.overall ?? 9999,
  }))
}

function buildSet(
  id: string,
  label: string,
  scoring: string,
  fetchedAt: number,
  rows: RankRow[],
  directory: Player[],
): RankSet | null {
  const { matched, unmatched } = matchRows(rows, directory)
  if (matched.length === 0) return null
  return {
    id: `${COLLECTED_PREFIX}${id}`,
    label,
    scoring: toScoring(scoring),
    kind: 'import',
    fetchedAt,
    rows: normalizeSetRanks(matched as MatchedRankRow[]),
    unmatched,
  }
}

const SCORING_LABELS: Record<string, string> = {
  ppr: 'PPR',
  half: 'Half PPR',
  standard: 'Standard',
  dynasty: 'Dynasty',
  rookie: 'Rookie',
  unknown: 'Unknown scoring',
}

const GROUP_LABELS: Record<string, string> = {
  fantasypros: 'FantasyPros',
  rotowire: 'RotoWire',
}

/**
 * Turns a snapshot into RankSets against the current player directory.
 *
 * `format` collapses each source's boards into one set per scoring format --
 * roughly six entries, which is what the rankings picker is built to show.
 * `board` keeps all ~73 boards separate, which is only useful if you want to
 * weigh individual experts against each other.
 */
export function toRankSets(
  snapshot: CollectedSnapshot,
  directory: Player[],
  granularity: Granularity = 'format',
): RankSet[] {
  /**
   * The real-time ADP board is not a season ranking and must not be grouped
   * with one.
   *
   * `sourceGroup` splits on the first dash, so `fantasypros-rtadp` lands in the
   * same group as `fantasypros-half` -- and since both label themselves `half`,
   * the live board was merged straight into the half-PPR set. `mergeRows` then
   * keeps the lowest ADP per player, so the live number won every row it
   * covered: the Texans D/ST read 83 instead of the board's own 121. It reaches
   * the app on its own through `adp-latest.json` as `Player.liveAdp`.
   */
  const seasonSets = snapshot.sets.filter((set) => !isLiveAdpSetId(set.id))

  if (granularity === 'board') {
    return seasonSets
      .map((set) => buildSet(set.id, set.label, set.scoring, set.fetchedAt, set.rows, directory))
      .filter((set): set is RankSet => set !== null)
  }

  const groups = new Map<string, CollectedSet[]>()
  for (const set of seasonSets) {
    const key = `${sourceGroup(set.id)}|${set.scoring}`
    groups.set(key, [...(groups.get(key) ?? []), set])
  }

  const sets: RankSet[] = []
  for (const [key, members] of groups) {
    const [group, scoring] = key.split('|')
    const label = `${GROUP_LABELS[group] ?? group} — ${SCORING_LABELS[scoring] ?? scoring}`
    const built = buildSet(
      key.replace('|', '-'),
      label,
      scoring,
      Math.max(...members.map((set) => set.fetchedAt)),
      mergeRows(members),
      directory,
    )
    if (built) sets.push(built)
  }
  return sets.sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Replaces every previously installed collected set with the current snapshot.
 * Sets the user imported by hand are left alone.
 */
export async function installCollectedSets(
  snapshot: CollectedSnapshot,
  directory: Player[],
  granularity: Granularity = 'format',
): Promise<RankSet[]> {
  const fresh = toRankSets(snapshot, directory, granularity)
  if (fresh.length === 0) {
    throw new Error('None of the collected rows matched the current player directory.')
  }
  const existing = await loadImportedSets()
  const kept = existing.filter((set) => !set.id.startsWith(COLLECTED_PREFIX))
  await saveImportedSets([...kept, ...fresh])
  return fresh
}
