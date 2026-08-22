import type { Player, ScoringType } from '../providers/types'
import { readRankingArtifact } from '../supabase/artifacts'
import { matchRows } from './match'
import type { RankRow } from './types'

export const LIVE_ADP_TEAM_COUNTS = [8, 10, 12, 14, 16] as const
export const DEFAULT_LIVE_ADP_TEAMS = 12
export type LiveAdpScoring = 'half' | 'ppr' | 'std' | 'dynasty' | 'rookie'

/**
 * How old the board may be and still count as live.
 *
 * The collector checks every 15 minutes, so this is many missed runs, not a hiccup. Past
 * it the snapshot is not a live market any more and reporting it as one is the
 * same mistake as standing a rank in for an ADP: `marketBaseline` prefers live
 * ADP over season ADP, so a stale board would quietly outrank a current one.
 */
export const LIVE_ADP_MAX_AGE_MS = 6 * 60 * 60 * 1000

export function isLiveAdpFresh(
  snapshot: LiveAdpSnapshot | null | undefined,
  now = Date.now(),
): boolean {
  if (!snapshot) return false
  // A snapshot with no timestamp cannot be shown to be current, and this is
  // the one field the collector always writes.
  if (!(snapshot.fetchedAt > 0)) return false
  return now - snapshot.fetchedAt <= LIVE_ADP_MAX_AGE_MS
}

export interface LiveAdpSet {
  id?: string
  scoring?: string
  meta?: { teams?: number; scoring?: string; format?: string; lastUpdated?: string | null }
  rows?: RankRow[]
}

/** FantasyPros stamps `published` in Eastern. August is EDT. */
export function parseFantasyProsPublishedAt(value?: string | null) {
  const match = String(value ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/)
  if (!match) return null
  const parsed = Date.parse(`${match[1]}T${match[2]}-04:00`)
  return Number.isFinite(parsed) ? parsed : null
}

export interface LiveAdpSnapshot {
  fetchedAt: number
  rows: RankRow[]
  sets?: LiveAdpSet[]
}

/** Map a league or collected-board scoring label onto a live-ADP format slug. */
export function liveAdpScoringSlug(scoring?: string | ScoringType | null): LiveAdpScoring {
  const value = String(scoring ?? '').toLowerCase()
  if (value.includes('dynasty')) return 'dynasty'
  if (value.includes('rookie')) return 'rookie'
  if (value === 'std' || value === 'standard' || value.endsWith('-std')) return 'std'
  if (value.includes('ppr') && !value.includes('half')) return 'ppr'
  return 'half'
}

export function draftWizardAdpSetId(teams: number, scoring?: string | ScoringType | null) {
  const slug = liveAdpScoringSlug(scoring)
  return slug === 'half' ? `draftwizard-adp-${teams}` : `draftwizard-adp-${slug}-${teams}`
}

export function fantasyProsRtAdpSetId(scoring?: string | ScoringType | null) {
  const slug = liveAdpScoringSlug(scoring)
  return slug === 'half' ? 'fantasypros-rtadp' : `fantasypros-rtadp-${slug}`
}

/** Closest collected board (8/10/12/14/16). Missing or invalid size uses 12. */
export function nearestLiveAdpTeams(teams: number | null | undefined): number {
  if (!(Number(teams) > 0)) return DEFAULT_LIVE_ADP_TEAMS
  return LIVE_ADP_TEAM_COUNTS.reduce((best, count) => (
    Math.abs(count - Number(teams)) < Math.abs(best - Number(teams)) ? count : best
  ))
}

function setScoring(set: LiveAdpSet): LiveAdpScoring {
  return liveAdpScoringSlug(set.meta?.scoring ?? set.meta?.format ?? set.scoring)
}

/**
 * Rows for this scoring (and size, as a fallback). Prefers the FantasyPros
 * real-time board the public page prints, then the Draft Wizard board for
 * the nearest collected size, then the half-PPR FP board, then any rows on
 * the snapshot (older artifacts only stored that one board).
 */
export function liveAdpSetForTeams(
  snapshot: LiveAdpSnapshot | null | undefined,
  teams?: number | null,
  scoring?: string | ScoringType | null,
): LiveAdpSet | null {
  const sets = snapshot?.sets ?? []
  if (!sets.length) return null
  const wantedTeams = nearestLiveAdpTeams(teams)
  const wantedScoring = liveAdpScoringSlug(scoring)
  const formatted = sets.find((set) => set.id === fantasyProsRtAdpSetId(wantedScoring))
  if (formatted?.rows?.length) return formatted
  const sized = sets.find((set) => (
    set.id === draftWizardAdpSetId(wantedTeams, wantedScoring)
    || (Number(set.meta?.teams) === wantedTeams && setScoring(set) === wantedScoring)
  ))
  if (sized?.rows?.length) return sized
  const blended = sets.find((set) => set.id === 'fantasypros-rtadp')
  if (blended?.rows?.length) return blended
  return sets.find((set) => set.rows?.length) ?? null
}

export function liveAdpRowsForTeams(
  snapshot: LiveAdpSnapshot | null | undefined,
  teams?: number | null,
  scoring?: string | ScoringType | null,
): RankRow[] {
  const selected = liveAdpSetForTeams(snapshot, teams, scoring)
  if (selected?.rows?.length) return selected.rows
  return snapshot?.rows ?? []
}

/**
 * The 15-minute live ADP snapshot (kind `adp-latest`), or null when it is
 * unavailable. Newer artifacts carry one set per league size and format;
 * older ones have a single blended FantasyPros board.
 */
export async function fetchLiveAdpSnapshot(signal?: AbortSignal): Promise<LiveAdpSnapshot | null> {
  try {
    const payload = await readRankingArtifact('adp-latest', 'rankings/adp-latest.json', { cache: 'no-store', signal }) as { fetchedAt?: number; sets?: LiveAdpSet[]; rows?: RankRow[] } | null
    if (!payload) return null
    const sets = payload.sets ?? []
    const rows = sets.length ? sets.flatMap((set) => set.rows ?? []) : payload.rows ?? []
    if (!rows.length && !sets.length) return null
    return { fetchedAt: payload.fetchedAt ?? 0, rows, sets }
  } catch (error) {
    // A cancelled request is the caller's business; a failed one just means no
    // live board, and the column renders blank rather than erroring the room.
    if (signal?.aborted) throw error
    return null
  }
}

/** Attach the matching board's draft position; the rest stay blank. */
export function applyLiveAdp(
  players: Player[],
  snapshot: LiveAdpSnapshot | null | undefined,
  teams?: number | null,
  scoring?: string | ScoringType | null,
): Player[] {
  // Stale is the same as absent: leave the column blank rather than presenting
  // an old board as the live market.
  if (!isLiveAdpFresh(snapshot)) return players
  const selected = liveAdpSetForTeams(snapshot, teams, scoring)
  const rows = selected?.rows?.length ? selected.rows : snapshot?.rows ?? []
  if (!rows.length) return players
  const { matched } = matchRows(rows, players)
  const publishedAt = parseFantasyProsPublishedAt(selected?.meta?.lastUpdated) ?? snapshot?.fetchedAt ?? null
  const liveByPlayer = new Map<string, RankRow>()
  for (const row of matched) if (row.playerId) liveByPlayer.set(row.playerId, row)
  if (!liveByPlayer.size) return players
  return players.map((player) => {
    const row = liveByPlayer.get(player.id)
    if (!row) return player
    return {
      ...player,
      liveAdp: row.adp ?? null,
      liveAdpLastOne: row.adpLastOne ?? null,
      liveAdpLastSeven: row.adpLastSeven ?? null,
      liveAdpVsLastOne: row.adpVsLastOne ?? null,
      liveAdpVsLastSeven: row.adpVsLastSeven ?? null,
      liveAdpPublishedAt: publishedAt,
    }
  })
}

export const liveAdpQuery = {
  queryKey: ['rankings', 'adp-latest'] as const,
  queryFn: ({ signal }: { signal?: AbortSignal }) => fetchLiveAdpSnapshot(signal),
  // The board is checked every 15 minutes, so an hour-long staleTime meant a re-scrape
  // could not reach an open tab at all. Short enough to pick up a fresh run,
  // and it refetches when the tab regains focus -- which is what happens right
  // after you go and re-run the collector.
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: true,
  retry: false as const,
}
