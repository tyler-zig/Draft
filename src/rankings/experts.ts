import type { Player, ScoringType } from '../providers/types'
import { readRankingArtifact } from '../supabase/artifacts'
import { matchRows } from './match'
import { normalizeSetRanks } from './consensus'
import { loadImportedSets, saveImportedSets } from './store'
import type { MatchedRankRow, RankRow, RankSet } from './types'

/**
 * Individual FantasyPros expert boards, collected by `npm run scrape:experts`.
 *
 * One file per scoring format, so the app downloads only the board matching
 * the league it is connected to. Rows are [playerKey, rank] pairs against a
 * shared player dictionary; this module rehydrates them into RankRows.
 *
 * Each selected expert becomes its own RankSet, which means the existing
 * median/mean consensus machinery does the aggregation -- picking eight
 * experts and taking their median *is* a custom consensus.
 */

const SUPPORTED_SCHEMA = 1

/** Sets installed from expert boards are namespaced so a reinstall replaces them. */
export const EXPERT_PREFIX = 'expert:'

export type ExpertScoring = 'ppr' | 'half' | 'standard'

export const SCORING_LABELS: Record<ExpertScoring, string> = {
  ppr: 'PPR',
  half: 'Half PPR',
  standard: 'Standard',
}

interface StoredPlayer {
  n: string
  t: string | null
  p: string | null
  b: number | null
  ecr: number | null
  adp: number | null
}

export interface StoredExpert {
  slug: string
  name: string
  outlet: string | null
  fetchedAt: number
  count: number
  ranks: [string, number][]
}

export interface ExpertSnapshot {
  schemaVersion: number
  scoring: ExpertScoring
  fetchedAt: number
  expertCount: number
  playerCount: number
  experts: StoredExpert[]
  players: Record<string, StoredPlayer>
  failures: { expert: string; error: string }[]
}

/**
 * League scoring to the collected file. `unknown` falls back to PPR, which is
 * the most common format -- callers surface that it was a guess rather than a
 * detection.
 */
export function scoringFor(scoringType: ScoringType): {
  scoring: ExpertScoring
  detected: boolean
} {
  switch (scoringType) {
    case 'ppr':
      return { scoring: 'ppr', detected: true }
    case 'half_ppr':
      return { scoring: 'half', detected: true }
    case 'std':
      return { scoring: 'standard', detected: true }
    default:
      return { scoring: 'ppr', detected: false }
  }
}

const snapshotCache = new Map<ExpertScoring, Promise<ExpertSnapshot | null>>()

/**
 * Downloads one scoring format's expert board, once per session.
 *
 * Deliberately not wired to the caller's AbortSignal. This is an immutable
 * snapshot shared by every consumer, and tying it to one component's lifetime
 * meant a remount (React StrictMode, or a drawer closed quickly) cancelled the
 * download mid-flight -- after which React Query cached the cancellation as
 * "this league has no experts" for the rest of staleTime.
 */
export function fetchExpertSnapshot(
  scoring: ExpertScoring,
  _signal?: AbortSignal,
): Promise<ExpertSnapshot | null> {
  const cached = snapshotCache.get(scoring)
  if (cached) return cached
  const request = loadExpertSnapshot(scoring).catch((error: unknown) => {
    // A failed download must not be remembered, or one flaky request leaves the
    // panel empty for the rest of the session.
    snapshotCache.delete(scoring)
    throw error
  })
  snapshotCache.set(scoring, request)
  return request
}

/** Drops cached snapshots so the next request re-downloads. */
export function clearExpertSnapshotCache() {
  snapshotCache.clear()
}

async function loadExpertSnapshot(scoring: ExpertScoring): Promise<ExpertSnapshot | null> {
  let data: ExpertSnapshot
  try {
    const payload = await readRankingArtifact(`experts-${scoring}`, `rankings/experts-${scoring}.json`, { cache: 'no-store' })
    if (!payload) return null
    data = payload as ExpertSnapshot
  } catch {
    return null
  }
  if (data?.schemaVersion !== SUPPORTED_SCHEMA || !Array.isArray(data.experts)) {
    throw new Error(
      `Expert rankings are schema v${data?.schemaVersion ?? '?'}; this build reads v${SUPPORTED_SCHEMA}. Re-run npm run scrape:experts.`,
    )
  }
  return data
}

function toRows(expert: StoredExpert, players: Record<string, StoredPlayer>): RankRow[] {
  const rows: RankRow[] = []
  for (const [key, rank] of expert.ranks) {
    const player = players[key]
    if (!player) continue
    rows.push({
      name: player.n,
      team: player.t,
      position: player.p,
      overall: rank,
      byeWeek: player.b,
      adp: player.adp,
      // Only a real FantasyPros id is carried through; team-defense keys are
      // synthetic and would not match anything downstream.
      fantasyProsId: key.startsWith('T:') ? undefined : key,
    })
  }
  return rows
}

export function toExpertRankSets(
  snapshot: ExpertSnapshot,
  slugs: string[],
  directory: Player[],
): RankSet[] {
  const wanted = new Set(slugs)
  const sets: RankSet[] = []

  for (const expert of snapshot.experts) {
    if (!wanted.has(expert.slug)) continue
    const { matched, unmatched } = matchRows(toRows(expert, snapshot.players), directory)
    if (matched.length === 0) continue
    sets.push({
      id: `${EXPERT_PREFIX}${snapshot.scoring}:${expert.slug}`,
      label: expert.outlet ? `${expert.name} — ${expert.outlet}` : expert.name,
      scoring: snapshot.scoring === 'half' ? 'half_ppr' : snapshot.scoring === 'standard' ? 'std' : 'ppr',
      kind: 'import',
      fetchedAt: expert.fetchedAt,
      rows: normalizeSetRanks(matched as MatchedRankRow[]),
      unmatched,
    })
  }
  return sets
}

/**
 * Replaces every previously installed expert set with the current selection.
 * Consensus sets and hand-imported lists are left alone.
 */
export async function installExpertSets(
  snapshot: ExpertSnapshot,
  slugs: string[],
  directory: Player[],
): Promise<RankSet[]> {
  const fresh = toExpertRankSets(snapshot, slugs, directory)
  const existing = await loadImportedSets()
  const kept = existing.filter((set) => !set.id.startsWith(EXPERT_PREFIX))
  await saveImportedSets([...kept, ...fresh])
  return fresh
}

/** Oldest board in the snapshot — what "last synced" should honestly report. */
export function oldestSync(snapshot: ExpertSnapshot): number | null {
  if (snapshot.experts.length === 0) return null
  return Math.min(...snapshot.experts.map((e) => e.fetchedAt))
}
