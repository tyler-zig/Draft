import { readPlayerCacheEntry, writePlayerCache } from '../api/playerCache'
import {
  getDraft,
  getDraftPicks,
  getLeague,
  getLeagueDrafts,
  getLeagueUsers,
  getNflPlayers,
  getUser,
  getUserLeagues,
  sleeperAvatarUrl,
  type SleeperDraft,
  type SleeperLeague,
  type SleeperLeagueUser,
  type SleeperPick,
  type SleeperPlayer,
} from '../api/sleeper'
import {
  defaultSlotCounts,
  type ConnectedUser,
  type DraftPick,
  type DraftProvider,
  type DraftSession,
  type DraftStatus,
  type DraftType,
  type KeeperEntry,
  type LeagueSummary,
  type PlayoffWeeks,
  type Player,
  type ScoringType,
  type SlotCounts,
} from './types'
import { slotsFromRosterPositions, slotsFromSettings } from '../draft/rosterNeeds'

const FANTASY_POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DST'])

function mapScoring(raw: string | undefined, league?: SleeperLeague): ScoringType {
  const fromMeta = raw?.toLowerCase()
  if (fromMeta === 'ppr') return 'ppr'
  if (fromMeta === 'half_ppr' || fromMeta === 'half' || fromMeta === 'half-ppr') {
    return 'half_ppr'
  }
  if (fromMeta === 'std' || fromMeta === 'standard' || fromMeta === 'non-ppr') {
    return 'std'
  }
  const rec = league?.scoring_settings?.rec
  if (rec === 1) return 'ppr'
  if (rec === 0.5) return 'half_ppr'
  if (rec === 0) return 'std'
  return 'unknown'
}

function mapDraftType(raw: string | undefined): DraftType {
  if (raw === 'auction') return 'auction'
  if (raw === 'linear') return 'linear'
  return 'snake'
}

function mapDraftStatus(raw: string | undefined): DraftStatus {
  if (raw === 'drafting') return 'drafting'
  if (raw === 'complete') return 'complete'
  if (raw === 'paused') return 'paused'
  return 'pre_draft'
}

function mapLeagueStatusScoring(league: SleeperLeague): ScoringType {
  return mapScoring(undefined, league)
}

/**
 * Sleeper publishes its playoff window as `playoff_week_start` plus
 * `playoff_rounds` (which counts rounds including the championship). The
 * window is read honestly and clamped to the 18-week season; callers fall
 * back to `DEFAULT_PLAYOFF_WEEKS` when the league does not report one.
 */
export function parsePlayoffWeeks(league: Pick<SleeperLeague, 'settings'> | null): PlayoffWeeks | null {
  const start = league?.settings?.playoff_week_start
  if (typeof start !== 'number' || start < 1 || start > 18) return null
  const rounds = league?.settings?.playoff_rounds
  const count = typeof rounds === 'number' && rounds >= 1 && rounds <= 4 ? rounds : 3
  return { start, end: Math.min(18, start + count - 1) }
}

function resolveSlots(draft: SleeperDraft, league: SleeperLeague | null): SlotCounts {
  if (league?.roster_positions?.length) {
    return slotsFromRosterPositions(league.roster_positions)
  }
  const fromSettings = slotsFromSettings(draft.settings ?? {})
  const hasAny = Object.values(fromSettings).some((n) => n > 0)
  return hasAny ? fromSettings : defaultSlotCounts()
}

function mapPick(pick: SleeperPick): DraftPick {
  return {
    playerId: pick.player_id,
    pickedByUserId: pick.picked_by || null,
    rosterId: pick.roster_id == null ? null : String(pick.roster_id),
    round: pick.round,
    draftSlot: pick.draft_slot,
    pickNo: pick.pick_no,
    isKeeper: Boolean(pick.is_keeper),
    meta: pick.metadata
      ? {
          firstName: pick.metadata.first_name ?? '',
          lastName: pick.metadata.last_name ?? '',
          position: pick.metadata.position ?? '',
          team: pick.metadata.team ?? null,
          injuryStatus: pick.metadata.injury_status ?? null,
        }
      : null,
  }
}

function optionalId(value: string | number | null | undefined) {
  return value == null || value === '' ? undefined : String(value)
}

function optionalNumber(value: string | number | null | undefined) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function mapSleeperPlayer(id: string, raw: SleeperPlayer): Player | null {
  const position = raw.position === 'DST' ? 'DEF' : (raw.position ?? '')
  const fantasy = (raw.fantasy_positions ?? []).map((p) =>
    p === 'DST' ? 'DEF' : p,
  )
  const isFantasy =
    FANTASY_POS.has(position) || fantasy.some((p) => FANTASY_POS.has(p))
  if (!isFantasy) return null
  if (raw.active === false && position !== 'DEF') return null

  const firstName = raw.first_name ?? ''
  const lastName = raw.last_name ?? (position === 'DEF' ? id : '')
  const fullName = raw.full_name || `${firstName} ${lastName}`.trim() || id

  const rank =
    typeof raw.search_rank === 'number' && raw.search_rank > 0
      ? raw.search_rank
      : 9999

  return {
    id,
    firstName,
    lastName,
    fullName: fullName || id,
    position: position || fantasy[0] || 'BN',
    team: raw.team ?? (position === 'DEF' ? id : null),
    searchRank: rank,
    injuryStatus: raw.injury_status ?? null,
    number: raw.number == null ? null : String(raw.number),
    yearsExp: raw.years_exp ?? null,
    bye: raw.bye_week ?? null,
    sleeperId: id,
    espnId: optionalId(raw.espn_id),
    yahooId: optionalId(raw.yahoo_id),
    age: raw.age ?? null,
    height: raw.height ?? null,
    weight: optionalNumber(raw.weight),
    depthChartOrder: raw.depth_chart_order ?? null,
    depthChartPosition: raw.depth_chart_position ?? null,
    gsisId: optionalId(raw.gsis_id),
    sportradarId: optionalId(raw.sportradar_id),
    fantasyDataId: optionalId(raw.fantasy_data_id),
  }
}

async function fetchPlayers(): Promise<Player[]> {
  const raw = await getNflPlayers()
  const players: Player[] = []
  for (const [id, value] of Object.entries(raw ?? {})) {
    const mapped = mapSleeperPlayer(id, value)
    if (mapped) players.push(mapped)
  }
  players.sort((a, b) => a.searchRank - b.searchRank)
  await writePlayerCache(players)
  return players
}

/** One in-flight refresh at a time, however many callers ask for players. */
let refreshing: Promise<Player[]> | null = null
function refreshPlayers(): Promise<Player[]> {
  refreshing ??= fetchPlayers().finally(() => { refreshing = null })
  return refreshing
}

/**
 * Serves the cached directory immediately and refreshes an aged-out copy in
 * the background, so only a first-ever visit waits on Sleeper's ~3 MB player
 * dump. A stale directory is a day old at worst; a blocked page is ~2s of
 * nothing, every day.
 */
async function loadPlayers(): Promise<Player[]> {
  const cached = await readPlayerCacheEntry()
  if (!cached) return refreshPlayers()
  if (cached.stale) {
    // Deliberately not awaited. A failed background refresh must not turn a
    // usable cached directory into an error.
    void refreshPlayers().catch(() => {})
  }
  return cached.players
}

function toLeagueSummary(
  league: SleeperLeague,
  draft: SleeperDraft | null,
): LeagueSummary {
  return {
    id: league.league_id,
    name: league.name,
    season: league.season,
    teamCount: league.total_rosters,
    status: league.status,
    scoringType: mapLeagueStatusScoring(league),
    keeperCount: league.settings?.max_keepers ?? null,
    draftId: draft?.draft_id ?? league.draft_id,
    draftStatus: draft ? mapDraftStatus(draft.status) : null,
    avatar: league.avatar,
  }
}

export const sleeperProvider: DraftProvider = {
  id: 'sleeper',
  label: 'Sleeper',
  capabilities: { draftPick: false, autoPick: false },

  async getLeagues(username, season) {
    const sleeperUser = await getUser(username)
    if (!sleeperUser) {
      throw new Error(`No Sleeper user named "${username}"`)
    }
    const user: ConnectedUser = {
      userId: sleeperUser.user_id,
      username: sleeperUser.username,
      displayName: sleeperUser.display_name,
    }
    const leagues = (await getUserLeagues(user.userId, season)) ?? []
    const summaries = await Promise.all(
      leagues.map(async (league) => {
        const drafts = (await getLeagueDrafts(league.league_id)) ?? []
        const latest = drafts[0] ?? null
        return toLeagueSummary(league, latest)
      }),
    )
    return { user, leagues: summaries }
  },

  async getDraft(draftId, yourUserId) {
    const draft = await getDraft(draftId)
    if (!draft) {
      throw new Error('Draft not found on Sleeper')
    }
    const league = draft.league_id ? await getLeague(draft.league_id) : null
    const users: SleeperLeagueUser[] = draft.league_id
      ? ((await getLeagueUsers(draft.league_id)) ?? [])
      : []
    const userById = new Map(users.map((u) => [u.user_id, u]))

    const teams = draft.settings?.teams ?? league?.total_rosters ?? 12
    const orderMap = draft.draft_order ?? {}
    const slotToRoster = draft.slot_to_roster_id ?? {}

    const slotToUser = new Map<number, string>()
    for (const [userId, slot] of Object.entries(orderMap)) {
      slotToUser.set(slot, userId)
    }

    const order = Array.from({ length: teams }, (_, i) => {
      const slot = i + 1
      const userId = slotToUser.get(slot) ?? null
      const user = userId ? userById.get(userId) : undefined
      return {
        slot,
        rosterId: String(slotToRoster[String(slot)] ?? slot),
        userId,
        displayName: user?.display_name ?? (userId ? `Team ${slot}` : `Slot ${slot}`),
        teamName: user?.metadata?.team_name ?? user?.display_name ?? `Team ${slot}`,
        avatar: sleeperAvatarUrl(user?.metadata?.avatar) ?? sleeperAvatarUrl(user?.avatar),
        isYou: userId === yourUserId,
      }
    })

    const yourSlot = order.find((s) => s.isYou)?.slot ?? null

    const session: DraftSession = {
      provider: 'sleeper',
      draftId: draft.draft_id,
      leagueId: draft.league_id ?? '',
      name: draft.metadata?.name || league?.name || 'Sleeper draft',
      type: mapDraftType(draft.type),
      status: mapDraftStatus(draft.status),
      season: draft.season,
      scoringType: mapScoring(draft.metadata?.scoring_type, league ?? undefined),
      teams,
      rounds: draft.settings?.rounds ?? 15,
      pickTimer: draft.settings?.pick_timer ?? null,
      slots: resolveSlots(draft, league),
      rosterPositions: league?.roster_positions ?? [],
      order,
      yourUserId,
      yourSlot,
      startTime: draft.start_time,
      keeperCount: league?.settings?.max_keepers ?? null,
      scoringSettings: league?.scoring_settings ?? null,
      playoffWeeks: parsePlayoffWeeks(league),
    }
    return session
  },

  async getPicks(draftId) {
    const picks = (await getDraftPicks(draftId)) ?? []
    return picks.map(mapPick)
  },

  /**
   * Sleeper publishes keepers as picks flagged `is_keeper`, so they are already
   * on the board -- this just names them for the keeper editor.
   */
  async getKeepers(draftId): Promise<KeeperEntry[]> {
    const picks = (await getDraftPicks(draftId)) ?? []
    return picks
      .filter((pick) => pick.is_keeper && pick.player_id)
      .map((pick) => ({
        playerId: pick.player_id,
        rosterId: pick.roster_id == null ? String(pick.draft_slot) : String(pick.roster_id),
        round: pick.round ?? null,
        source: 'sleeper' as const,
      }))
  },

  getPlayers: loadPlayers,
}
