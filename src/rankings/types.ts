import type { ScoringType } from '../providers/types'

export type RankMethod = 'median' | 'mean'

export interface RankRow {
  name: string
  team: string | null
  position: string | null
  overall?: number
  score?: number
  sleeperId?: string
  espnId?: string
  /** Stable per-source ids, when the source publishes one. */
  fantasyProsId?: string
  rotowireId?: string
  /** Average draft position, where the source reports it. Lower is earlier. */
  adp?: number | null
  /** FantasyPros real-time rolling windows: last 1 day and last 7 days. */
  adpLastOne?: number | null
  adpLastSeven?: number | null
  /** Window minus current ADP. Positive means drafted earlier than that window. */
  adpVsLastOne?: number | null
  adpVsLastSeven?: number | null
  /** Expert spread behind `overall`: the best and worst rank any expert gave. */
  best?: number | null
  worst?: number | null
  stdDev?: number | null
  tier?: number | null
  positionRank?: string | null
  byeWeek?: number | null
}

export interface MatchedRankRow extends RankRow {
  overall: number
  sleeperId?: string
  espnId?: string
  playerId?: string
}

/**
 * How a collected board labels its market.
 *
 * The scrapers write FantasyPros' own spellings (`half`, `standard`) while a
 * DraftSession reports `half_ppr` / `std`. Both reach this field, so the type
 * says so rather than claiming a `ScoringType` and letting the mismatch pass
 * unnoticed -- `marketKey` in `consensus.ts` reconciles the two.
 */
export type RankSetScoring = ScoringType | 'half' | 'standard' | 'dynasty' | 'rookie'

export interface RankSet {
  id: string
  label: string
  scoring: RankSetScoring
  kind: 'builtin' | 'import'
  fetchedAt: number
  rows: MatchedRankRow[]
  unmatched: string[]
}

/**
 * Sets that carry the live draft board rather than a season-long ranking.
 *
 * The real-time board is already surfaced on its own as `Player.liveAdp`, and
 * it answers a different question: where players are going in drafts right
 * now, not where the season market has settled. Letting it into the season ADP
 * blend made both columns show one number and hid the market it was meant to
 * be compared against -- most visibly on defenses, which the live board takes
 * dozens of picks earlier than any season board.
 */
const LIVE_ADP_SET_IDS = ['fantasypros-rtadp', 'draftwizard-adp-']

export function isLiveAdpSetId(id: string): boolean {
  const bare = id.replace(/^collected:/, '')
  return LIVE_ADP_SET_IDS.some((prefix) => bare === prefix || bare.startsWith(prefix))
}

export interface RankSettings {
  enabledIds: string[]
  method: RankMethod
}

export const RANK_SETTINGS_KEY = 'draft-assistant:rank-settings'
export const RANK_SETS_KEY = 'rank-sets-v1'
