import { applyPlayerIdCrosswalk, loadPlayerIdCrosswalk } from '../api/playerIdCrosswalk'
import { readPlayerCacheEntry, writePlayerCache } from '../api/playerCache'
import {
  getDraft,
  getDraftPicks,
  getDraftTradedPicks,
  getLeague,
  getLeagueDrafts,
  getLeagueUsers,
  getNflPlayers,
  getUser,
  getUserDrafts,
  getUserLeagues,
  sleeperAvatarUrl,
  type SleeperDraft,
  type SleeperLeague,
  type SleeperLeagueUser,
  type SleeperPick,
  type SleeperPlayer,
} from '../api/sleeper'
import {
  buildSleeperPickOwners,
  detectLeagueFormat,
  isSleeperMock,
  sleeperClockEndsAt,
  sleeperParentLeagueId,
} from '../draft/sleeperBoard'
import { parseSleeperRef } from '../draft/sleeperRef'
import { requestSleeperPick } from '../sites/sleeperPickBridge'
import {
  defaultSlotCounts,
  type ConnectedUser,
  type DraftPick,
  type DraftProvider,
  type DraftSession,
  type DraftStatus,
  type DraftType,
  type KeeperEntry,
  type LeagueFormat,
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
export function parsePlayoffWeeks(
  league: Pick<SleeperLeague, 'settings'> | null,
  format?: LeagueFormat | null,
): PlayoffWeeks | null {
  if (format === 'chopped') return null
  if (league?.settings?.playoff_teams === 0) return null
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

function optionalPositive(value: string | number | null | undefined) {
  if (value == null || value === '') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * Sleeper's pick docs: `picked_by` may be `""`, `roster_id` is a string, and
 * some rows omit `roster_id` / `draft_slot` / `round`. CPU mock picks also
 * send `roster_id: null`. Names always live on `metadata` even without the
 * 5MB player dump.
 */
export function mapSleeperPick(pick: SleeperPick): DraftPick {
  const pickNo = optionalPositive(pick.pick_no)
  const draftSlot = optionalPositive(pick.draft_slot)
  const round = optionalPositive(pick.round)
  return {
    playerId: String(pick.player_id ?? pick.metadata?.player_id ?? ''),
    pickedByUserId: pick.picked_by || null,
    rosterId: pick.roster_id == null || pick.roster_id === '' ? null : String(pick.roster_id),
    // Left at 0 when Sleeper omits it -- the GraphQL board always does.
    // `normalizePickSlots` fills it from `pickNo` and the team count, which is
    // the only place that arithmetic is actually knowable.
    round,
    draftSlot,
    pickNo,
    isKeeper: Boolean(pick.is_keeper),
    meta: pick.metadata
      ? {
          firstName: pick.metadata.first_name ?? '',
          lastName: pick.metadata.last_name ?? '',
          position: pick.metadata.position ?? '',
          team: pick.metadata.team ?? null,
          injuryStatus: pick.metadata.injury_status || null,
        }
      : null,
  }
}

function asPickList(raw: SleeperPick[] | null | undefined): SleeperPick[] {
  return Array.isArray(raw) ? raw : []
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
  const [raw, crosswalk] = await Promise.all([getNflPlayers(), loadPlayerIdCrosswalk()])
  const players: Player[] = []
  for (const [id, value] of Object.entries(raw ?? {})) {
    const mapped = mapSleeperPlayer(id, value)
    if (mapped) players.push(mapped)
  }
  players.sort((a, b) => a.searchRank - b.searchRank)
  const linked = applyPlayerIdCrosswalk(players, crosswalk)
  await writePlayerCache(linked)
  return linked
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
  // Sleeper's dump omits espn_id for most of the 2026 board. Fill from the
  // published Sleeper→ESPN sheet even when the cached directory predates it.
  const crosswalk = await loadPlayerIdCrosswalk()
  return applyPlayerIdCrosswalk(cached.players, crosswalk)
}

function toDraftSummary(draft: SleeperDraft): LeagueSummary {
  const mock = isSleeperMock(draft)
  const name = draft.metadata?.name || (mock ? 'Sleeper mock' : 'Sleeper draft')
  return {
    id: draft.draft_id,
    name: mock && !/\bmock\b/i.test(name) ? `${name} (Mock)` : name,
    season: draft.season,
    teamCount: draft.settings?.teams ?? 0,
    status: draft.status,
    scoringType: mapScoring(draft.metadata?.scoring_type),
    keeperCount: null,
    draftId: draft.draft_id,
    draftStatus: mapDraftStatus(draft.status),
    avatar: null,
    isPractice: mock,
    leagueFormat: detectLeagueFormat(null, draft),
  }
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
    leagueFormat: detectLeagueFormat(league, draft),
  }
}

export const sleeperProvider: DraftProvider = {
  id: 'sleeper',
  label: 'Sleeper',
  // Sleeper can be written to, but only through a logged-in sleeper.com tab
  // driven by the extension -- never on autopilot. `autoPick` stays false: the
  // room submits what the user confirms and nothing else.
  capabilities: { draftPick: true, autoPick: false },

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
    const [leagues, userDrafts] = await Promise.all([
      getUserLeagues(user.userId, season),
      getUserDrafts(user.userId, season).catch(() => [] as SleeperDraft[]),
    ])
    const summaries = await Promise.all(
      (leagues ?? []).map(async (league) => {
        const drafts = (await getLeagueDrafts(league.league_id)) ?? []
        const latest = drafts[0] ?? null
        return toLeagueSummary(league, latest)
      }),
    )
    const knownDraftIds = new Set(summaries.map((league) => league.draftId).filter(Boolean))
    for (const draft of userDrafts ?? []) {
      if (!draft?.draft_id || knownDraftIds.has(draft.draft_id)) continue
      const live = draft.status === 'drafting' || draft.status === 'paused'
      if (!isSleeperMock(draft) && !live) continue
      summaries.push(toDraftSummary(draft))
      knownDraftIds.add(draft.draft_id)
    }
    return { user, leagues: summaries }
  },

  async getDraft(draftId, yourUserId) {
    const draft = await getDraft(draftId)
    if (!draft) {
      throw new Error('Draft not found on Sleeper')
    }
    const parentLeagueId = sleeperParentLeagueId(draft)
    const isPractice = isSleeperMock(draft)
    const [league, users, tradedPicks] = await Promise.all([
      parentLeagueId ? getLeague(parentLeagueId) : Promise.resolve(null),
      parentLeagueId ? getLeagueUsers(parentLeagueId) : Promise.resolve([] as SleeperLeagueUser[] | null),
      getDraftTradedPicks(draft.draft_id).catch(() => [] as Awaited<ReturnType<typeof getDraftTradedPicks>>),
    ])
    const userById = new Map((users ?? []).map((u) => [u.user_id, u]))

    const teams = draft.settings?.teams ?? league?.total_rosters ?? 12
    const orderMap = draft.draft_order ?? {}
    const slotToRoster = draft.slot_to_roster_id ?? {}

    const slotToUser = new Map<number, string>()
    for (const [userId, slot] of Object.entries(orderMap)) {
      slotToUser.set(slot, userId)
    }
    const seatedIds = Object.keys(orderMap)
    const resolvedUserId = seatedIds.includes(yourUserId)
      ? yourUserId
      : isPractice && seatedIds.length === 1
        ? seatedIds[0]
        : yourUserId

    const order = Array.from({ length: teams }, (_, i) => {
      const slot = i + 1
      const userId = slotToUser.get(slot) ?? null
      const user = userId ? userById.get(userId) : undefined
      const vacant = !userId
      const cpuLabel = `CPU ${slot}`
      return {
        slot,
        rosterId: String(slotToRoster[String(slot)] ?? slot),
        userId,
        displayName: user?.display_name ?? (vacant && isPractice ? cpuLabel : userId ? `Team ${slot}` : `Slot ${slot}`),
        teamName: user?.metadata?.team_name ?? user?.display_name ?? (vacant && isPractice ? cpuLabel : `Team ${slot}`),
        avatar: sleeperAvatarUrl(user?.metadata?.avatar) ?? sleeperAvatarUrl(user?.avatar),
        isYou: userId === resolvedUserId,
      }
    })

    const yourSlot = order.find((s) => s.isYou)?.slot ?? null
    const type = mapDraftType(draft.type)
    const rounds = draft.settings?.rounds ?? 15
    const leagueFormat = detectLeagueFormat(league, draft)
    const pickOwners = buildSleeperPickOwners({
      teams,
      rounds,
      type,
      reversalRound: draft.settings?.reversal_round,
      slotToRosterId: slotToRoster,
      tradedPicks,
      season: draft.season,
    })

    const session: DraftSession = {
      provider: 'sleeper',
      draftId: draft.draft_id,
      leagueId: parentLeagueId ?? draft.draft_id,
      name: isPractice
        ? `${draft.metadata?.name || league?.name || 'Sleeper mock'} (Mock)`
        : draft.metadata?.name || league?.name || 'Sleeper draft',
      type,
      status: mapDraftStatus(draft.status),
      season: draft.season,
      scoringType: mapScoring(draft.metadata?.scoring_type, league ?? undefined),
      teams,
      rounds,
      pickTimer: draft.settings?.pick_timer ?? null,
      clockEndsAt: sleeperClockEndsAt(draft),
      clockPaused: mapDraftStatus(draft.status) === 'paused',
      slots: resolveSlots(draft, league),
      rosterPositions: league?.roster_positions ?? [],
      order,
      yourUserId: resolvedUserId,
      yourSlot,
      startTime: draft.start_time,
      keeperCount: league?.settings?.max_keepers ?? null,
      scoringSettings: league?.scoring_settings ?? null,
      playoffWeeks: parsePlayoffWeeks(league, leagueFormat),
      leagueFormat,
      pickOwners,
      isPractice,
    }
    return session
  },

  async getPicks(draftId) {
    return asPickList(await getDraftPicks(draftId)).map(mapSleeperPick)
  },

  /**
   * Sleeper publishes keepers as picks flagged `is_keeper`, so they are already
   * on the board -- this just names them for the keeper editor.
   */
  async getKeepers(draftId): Promise<KeeperEntry[]> {
    const picks = asPickList(await getDraftPicks(draftId))
    return picks
      .filter((pick) => pick.is_keeper && (pick.player_id || pick.metadata?.player_id))
      .map((pick) => ({
        playerId: String(pick.player_id ?? pick.metadata?.player_id ?? ''),
        rosterId: pick.roster_id == null ? String(pick.draft_slot ?? '') : String(pick.roster_id),
        round: pick.round ?? null,
        source: 'sleeper' as const,
      }))
  },

  getPlayers: loadPlayers,

  /**
   * Sleeper's `draft_pick_player` mutation, sent by the extension from a tab
   * that already holds the user's session. The app has no Sleeper credential
   * of its own and deliberately never asks for one.
   */
  async makePick(request) {
    const result = await requestSleeperPick(request)
    return { ok: result.ok, error: result.error ?? null }
  },
}

/**
 * Opens a Sleeper draft or league mock from a pasted URL / id. League mocks
 * do not appear in `getLeagues` because Sleeper leaves `league_id` null.
 */
export async function resolveSleeperDraftLink(raw: string, preferredUserId?: string) {
  const ref = parseSleeperRef(raw)
  if (!ref) {
    throw new Error('Paste a Sleeper draft, mock, or league link.')
  }
  let draftId = ref.kind === 'draft' ? ref.id : null
  if (ref.kind === 'league') {
    const league = await getLeague(ref.id)
    if (!league) throw new Error('League not found on Sleeper')
    draftId = league.draft_id
    if (!draftId) throw new Error('That league does not have a draft yet.')
  }
  const draft = await getDraft(draftId!)
  if (!draft) throw new Error('Draft not found on Sleeper')
  const seated = Object.keys(draft.draft_order ?? {})
  const userId = preferredUserId && seated.includes(preferredUserId)
    ? preferredUserId
    : seated.length === 1
      ? seated[0]
      : preferredUserId || draft.creators?.[0] || seated[0]
  if (!userId) {
    throw new Error('Find your Sleeper username first so we know which seat is yours.')
  }
  return {
    draftId: draft.draft_id,
    userId,
    isPractice: isSleeperMock(draft),
    name: draft.metadata?.name || 'Sleeper draft',
  }
}
