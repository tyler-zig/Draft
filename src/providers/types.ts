/**
 * Provider-agnostic draft types.
 *
 * ESPN is filled by the Chrome sync extension (not cookie paste).
 */
export type ProviderId = 'sleeper' | 'espn' | 'yahoo' | 'nfl' | 'demo'

export type ScoringType = 'ppr' | 'half_ppr' | 'std' | 'unknown'

export type DraftType = 'snake' | 'linear' | 'auction'

/**
 * How the season is scored after the draft. Chopped is Sleeper's last-man-
 * standing redraft: no playoffs, weekly floor matters more than late-season
 * upside. Detection lives in the Sleeper mapper.
 */
export type LeagueFormat = 'redraft' | 'keeper' | 'dynasty' | 'chopped' | 'best_ball'

export type DraftStatus = 'pre_draft' | 'drafting' | 'paused' | 'complete'

export const CURRENT_SEASON = '2026'

/**
 * The league's playoff window, when the site reports it. Weeks are 1-based
 * NFL regular-season weeks. The default covers the standard 14-week regular
 * season with a three-week playoff (15-17).
 */
export interface PlayoffWeeks {
  start: number
  end: number
}

export const DEFAULT_PLAYOFF_WEEKS: PlayoffWeeks = { start: 15, end: 17 }

export const FANTASY_POSITIONS = [
  'QB',
  'RB',
  'WR',
  'TE',
  'K',
  'DEF',
] as const

export type FantasyPosition = (typeof FANTASY_POSITIONS)[number]

export interface SlotCounts {
  QB: number
  RB: number
  WR: number
  TE: number
  FLEX: number
  SUPER_FLEX: number
  K: number
  DEF: number
  BN: number
}

export interface LeagueTeamOption {
  id: string
  name: string
  isYou?: boolean
}

export interface LeagueSummary {
  id: string
  name: string
  season: string
  teamCount: number
  status: string
  scoringType: ScoringType
  /** Keepers allowed per team, when the league site says. */
  keeperCount?: number | null
  draftId: string | null
  draftStatus: DraftStatus | null
  avatar: string | null
  teams?: LeagueTeamOption[]
  /** ESPN league-specific practice / public mock — not the real draft. */
  isPractice?: boolean
  leagueFormat?: LeagueFormat
}

export interface DraftSlot {
  slot: number
  rosterId: string
  userId: string | null
  displayName: string
  teamName: string
  isYou: boolean
  /** Fantasy team logo from Sleeper or ESPN when the site publishes one. */
  avatar?: string | null
}

export interface DraftSession {
  provider: ProviderId
  draftId: string
  leagueId: string
  name: string
  type: DraftType
  status: DraftStatus
  season: string
  scoringType: ScoringType
  teams: number
  rounds: number
  pickTimer: number | null
  /**
   * When the current pick expires, from a live host clock. Null when the
   * site only publishes the configured timeout (`pickTimer`) or the clock
   * is paused.
   */
  clockEndsAt?: number | null
  clockPaused?: boolean
  slots: SlotCounts
  rosterPositions: string[]
  order: DraftSlot[]
  yourUserId: string
  yourSlot: number | null
  startTime: number | null
  /** Keepers allowed per team, when the league site says. */
  keeperCount?: number | null
  /**
   * Positions paid a different rate per reception, when the league does that.
   * ESPN calls this TE premium; the scoring type alone cannot express it.
   */
  receptionPremium?: { position: string; points: number }[] | null
  /**
   * Full per-stat scoring settings, when the provider publishes them in a
   * form we can read. Sleeper does (its keys are self-describing, e.g.
   * `pass_td`, `rec_yd`); ESPN's `scoringItems` are keyed by numeric stat id
   * without a published mapping, so ESPN sessions leave this null and value
   * calculations fall back to the plain PPR/half/standard split.
   */
  scoringSettings?: Record<string, number> | null
  /**
   * The league's playoff weeks, when the provider reports them. Sleeper does
   * (`playoff_week_start` + `playoff_rounds`); the other providers leave it
   * null and callers fall back to `DEFAULT_PLAYOFF_WEEKS`. Chopped / last-man-
   * standing leagues have no playoffs, so this stays null and callers must
   * not apply the default window.
   */
  playoffWeeks?: PlayoffWeeks | null
  leagueFormat?: LeagueFormat
  /**
   * Who owns each pick, indexed by pick number minus one, when the provider
   * publishes its board instead of leaving us to infer it.
   *
   * Snake parity is a guess, and leagues break it: ESPN runs keeper rounds in
   * straight draft order and only starts snaking afterwards, and third-round
   * reversal is a common house rule. ESPN ships every pick of the board up
   * front -- round, round-pick, and team -- so when it does, that is the
   * truth and `snake.ts` reads it rather than recomputing it. Entries may be
   * null where the provider said nothing; those fall back to snake math.
   */
  pickOwners?: (number | null)[] | null
  /** ESPN practice / mock draft cloned from a real league or the public lobby. */
  isPractice?: boolean
}

export interface Player {
  id: string
  firstName: string
  lastName: string
  fullName: string
  position: string
  team: string | null
  searchRank: number
  injuryStatus: string | null
  number: string | null
  yearsExp: number | null
  bye: number | null
  sleeperId?: string
  espnId?: string
  yahooId?: string
  /** Profile fields retained from the Sleeper player directory. */
  age?: number | null
  height?: string | null
  weight?: number | null
  depthChartOrder?: number | null
  depthChartPosition?: string | null
  gsisId?: string
  sportradarId?: string
  fantasyDataId?: string
  consensusCount?: number
  /** Market ADP from the collected rankings, when a source reports one. */
  adp?: number | null
  /**
   * The FantasyPros real-time ADP board's draft position, from the
   * `adp-latest` snapshot. Absent when the player is not on the board or the
   * snapshot is unavailable — unlike `adp`, it never falls back to consensus.
   */
  liveAdp?: number | null
  /** FantasyPros last-1-day rolling ADP from the same live board. */
  liveAdpLastOne?: number | null
  /** FantasyPros last-7-day rolling ADP from the same live board. */
  liveAdpLastSeven?: number | null
  /** last-1-day window minus current live ADP. Positive = rising. */
  liveAdpVsLastOne?: number | null
  /** last-7-day window minus current live ADP. Positive = rising. */
  liveAdpVsLastSeven?: number | null
  /** Page `published` stamp for the board these windows came from. */
  liveAdpPublishedAt?: number | null
  /** Tier break from the collected rankings, when a source reports one. */
  tier?: number | null
  /**
   * Standard deviation of expert rank, when a source reports one (FantasyPros
   * does). Real per-player disagreement, not a derived estimate -- used to
   * judge how likely a player is to survive to a future pick.
   */
  rankStdDev?: number | null
  /** Enabled ranking-set provenance calculated by the consensus engine. */
  rankLow?: number | null
  rankHigh?: number | null
  rankUpdatedAt?: number | null
  rankingSources?: Array<{
    id: string
    label: string
    rank: number
    fetchedAt: number
  }>
  /**
   * Season projection scored to the connected league's format, from the
   * collected CBS / ESPN / FantasySharks consensus blended with Sleeper's
   * RotoWire feed. Blank when no projection row is published for the player.
   */
  projectedPoints?: number | null
  /** Per-source season lines behind the consensus projection, when collected. */
  projectionBreakdown?: import('../api/collectedProjections').ProjectionSourceLine[]
  /** Value over the replacement-level player at the same position. */
  vorp?: number | null
  /**
   * Strength of schedule over the window that matters: playoff weeks in H2H,
   * or weeks 1–4 in chopped. `rank` is the league-wide ordering (1 = easiest
   * slate) and null when no games fall in the window. Absent when the
   * schedule model is unavailable or the position is not matchup-modeled (DEF).
   */
  playoffSos?: { averageMatchupRank: number; rank: number | null; games: number } | null
}

export type KeeperSource = 'manual' | 'espn' | 'sleeper'

/**
 * A player kept before the draft starts.
 *
 * `round` is the round the keeper costs its team when that league rule is on.
 * ESPN reports it as `keeperValue`; leagues that just lop off the top picks
 * leave it unset, and `keeperPicks` then assigns the team's earliest open
 * rounds. Leagues that park keepers on the roster without spending a pick
 * leave the setting off and those rounds stay live.
 */
export interface KeeperEntry {
  playerId: string
  /** Team that keeps the player -- matches `DraftSlot.rosterId`. */
  rosterId: string
  round: number | null
  source: KeeperSource
}

export interface DraftPick {
  playerId: string
  pickedByUserId: string | null
  rosterId: string | null
  round: number
  draftSlot: number
  pickNo: number
  isKeeper: boolean
  meta: {
    firstName: string
    lastName: string
    position: string
    team: string | null
    injuryStatus: string | null
  } | null
}

export interface ConnectedUser {
  userId: string
  username: string
  displayName: string
}

export interface MakePickResult {
  ok: boolean
  /** Why the pick did not go through, phrased for the draft room. */
  error?: string | null
}

/**
 * League-site adapter. ESPN snapshots come from the Chrome extension.
 */
export interface DraftProvider {
  id: ProviderId
  label: string
  capabilities: {
    draftPick: boolean
    autoPick: boolean
  }
  getLeagues(
    username: string,
    season: string,
  ): Promise<{ user: ConnectedUser; leagues: LeagueSummary[] }>
  getDraft(draftId: string, yourUserId: string): Promise<DraftSession>
  getPicks(draftId: string): Promise<DraftPick[]>
  getPlayers(draftId?: string): Promise<Player[]>
  /**
   * Submits a real pick to the league site.
   *
   * Present only on providers that can write. `pickNo` is passed explicitly
   * rather than inferred inside the provider so the caller commits to the
   * board position it showed the user -- a pick submitted against a stale
   * number is the one mistake here that cannot be undone.
   */
  makePick?(request: { draftId: string; playerId: string; pickNo: number }): Promise<MakePickResult>
  /**
   * Keepers the league site has published. Absent when the provider cannot
   * report them; empty when it can but the league has not locked them yet.
   */
  getKeepers?(draftId: string): Promise<KeeperEntry[]>
}

export const EMPTY_SLOTS: SlotCounts = {
  QB: 0,
  RB: 0,
  WR: 0,
  TE: 0,
  FLEX: 0,
  SUPER_FLEX: 0,
  K: 0,
  DEF: 0,
  BN: 0,
}

export function defaultSlotCounts(): SlotCounts {
  return {
    QB: 1,
    RB: 2,
    WR: 2,
    TE: 1,
    FLEX: 1,
    SUPER_FLEX: 0,
    K: 1,
    DEF: 1,
    BN: 6,
  }
}
