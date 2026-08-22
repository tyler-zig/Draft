import type {
  DraftPick,
  DraftSession,
  DraftStatus,
  DraftType,
  KeeperEntry,
  LeagueSummary,
  Player,
  ScoringType,
  SlotCounts,
} from '../providers/types'
import { defaultSlotCounts } from '../providers/types'
import { slotsFromRosterPositions } from '../draft/rosterNeeds'
import { pickNumberFor } from '../draft/snake'

export const ESPN_BRIDGE_SOURCE = 'draft-assistant-extension'
export const ESPN_APP_SOURCE = 'draft-assistant-app'

export interface EspnAvailableLeague {
  leagueId: string
  name?: string
  season: string
}

export interface EspnSnapshot {
  leagueId?: string
  season?: string
  teamId?: string
  pageUrl?: string
  swid?: string | null
  fetchedAt: number
  error?: string
  waiting?: boolean
  /** Set by the injector when ESPN's league subtype is a mock / practice clone. */
  isPractice?: boolean
  league?: EspnLeaguePayload
  players?: EspnPlayerEntry[]
  availableLeagues?: EspnAvailableLeague[]
}

export interface EspnLeaguePayload {
  id?: number
  /** String form ESPN uses on some payloads: NONE / DRAFT_LOBBY / MOCKDRAFT_LOBBY / CUSTOM_MOCK. */
  leagueSubType?: string
  leagueSubTypeId?: number
  settings?: {
    name?: string
    size?: number
    leagueSubType?: string
    leagueSubTypeId?: number
    draftSettings?: {
      type?: string
      pickTimeout?: number
      pickOrder?: number[]
      availableDate?: number
      /** Keepers allowed per team this season. */
      keeperCount?: number
      keeperCountFuture?: number
    }
    rosterSettings?: {
      lineupSlotCounts?: Record<string, number>
    }
    scoringSettings?: {
      scoringItems?: Array<{
        statId: number
        points: number
        /** Per-position overrides, keyed by ESPN lineup-slot id. TE premium. */
        pointsOverrides?: Record<string, number>
      }>
    }
  }
  status?: {
    currentMatchupPeriod?: number
  }
  draftDetail?: {
    drafted?: boolean
    inProgress?: boolean
    picks?: EspnRawPick[]
  }
  teams?: EspnTeam[]
  members?: EspnMember[]
}

export interface EspnRosterEntry {
  playerId?: number
  lineupSlotId?: number
  playerPoolEntry?: {
    id?: number
    /** Round this player costs to keep this season. */
    keeperValue?: number
    keeperValueFuture?: number
    player?: EspnPlayerEntry['player']
  }
}

export interface EspnTeam {
  id: number
  abbrev?: string
  location?: string
  nickname?: string
  name?: string
  logo?: string | null
  primaryOwner?: string
  owners?: string[]
  draftPosition?: number
  roster?: {
    entries?: EspnRosterEntry[]
  }
}

export interface EspnMember {
  id: string
  displayName?: string
  firstName?: string
  lastName?: string
}

export interface EspnRawPick {
  playerId?: number
  teamId?: number
  roundId?: number
  roundPickNumber?: number
  overallPickNumber?: number
  keeper?: boolean
  reservedForKeeper?: boolean
}

/** A rostered player ESPN says is keepable, with the round he would cost. */
export interface EspnKeeperCandidate {
  playerId: string
  rosterId: string
  round: number | null
}

export interface EspnPlayerEntry {
  id?: number
  player?: {
    id?: number
    fullName?: string
    firstName?: string
    lastName?: string
    defaultPositionId?: number
    proTeamId?: number
    injured?: boolean
    injuryStatus?: string
    jersey?: string
    draftRanksByRankType?: Record<string, { rank?: number }>
    /** Trimmed by the injector to this one field: ESPN's real ADP. */
    ownership?: { averageDraftPosition?: number }
  }
  defaultPositionId?: number
  fullName?: string
  firstName?: string
  lastName?: string
  proTeamId?: number
}

const PRO_TEAMS: Record<number, string> = {
  0: 'FA',
  1: 'ATL',
  2: 'BUF',
  3: 'CHI',
  4: 'CIN',
  5: 'CLE',
  6: 'DAL',
  7: 'DEN',
  8: 'DET',
  9: 'GB',
  10: 'TEN',
  11: 'IND',
  12: 'KC',
  13: 'LV',
  14: 'LAR',
  15: 'MIA',
  16: 'MIN',
  17: 'NE',
  18: 'NO',
  19: 'NYG',
  20: 'NYJ',
  21: 'PHI',
  22: 'ARI',
  23: 'PIT',
  24: 'LAC',
  25: 'SF',
  26: 'SEA',
  27: 'TB',
  28: 'WSH',
  29: 'CAR',
  30: 'JAX',
  33: 'BAL',
  34: 'HOU',
}

/**
 * ESPN's `defaultPositionId` space, which is NOT the lineup-slot space used by
 * SLOT_ID_TO_POS below. The two overlap only at 2 (RB) and 16 (DEF), so mixing
 * them silently drops QBs, WRs and Ks and relabels TEs as WRs.
 *
 * Verified against the public player feed: Josh Allen=1, Jahmyr Gibbs=2,
 * Ja'Marr Chase=3, Brock Bowers=4, Harrison Butker=5, "Bills D/ST"=16.
 * Ids 7 and 9-13 are IDP positions with no slot in this app, and players
 * carrying them are intentionally skipped by the caller.
 */
const POSITION_BY_ID: Record<number, string> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'DEF',
}

const SLOT_ID_TO_POS: Record<string, string> = {
  '0': 'QB',
  '2': 'RB',
  '4': 'WR',
  '6': 'TE',
  '7': 'SUPER_FLEX',
  '16': 'DEF',
  '17': 'K',
  '20': 'BN',
  '21': 'BN',
  '23': 'FLEX',
}

export function espnDraftId(season: string, leagueId: string): string {
  return `${season}:${leagueId}`
}

export function parseEspnDraftId(draftId: string): {
  season: string
  leagueId: string
} {
  const [season, leagueId] = draftId.split(':')
  if (!season || !leagueId) {
    throw new Error('Invalid ESPN draft id')
  }
  return { season, leagueId }
}

/** Matches `extension/espn-suggest.js` so the overlay can pair app recs with a live snapshot. */
export function espnSnapshotPickStamp(snapshot: EspnSnapshot | null | undefined): string {
  const picks = snapshot?.league?.draftDetail?.picks ?? []
  const last = picks[picks.length - 1]
  return `${picks.length}:${last?.playerId ?? ''}:${last?.overallPickNumber ?? ''}:${last?.roundId ?? ''}:${last?.roundPickNumber ?? ''}`
}

/**
 * ESPN's league-specific Practice Draft clones the real league into a
 * `CUSTOM_MOCK` (subtype 5). Public mock-lobby rooms are `MOCKDRAFT_LOBBY`
 * (subtype 4). Either is a throwaway draft and must not be treated as the
 * league's real board.
 */
const PRACTICE_SUBTYPES = new Set(['CUSTOM_MOCK', 'MOCKDRAFT_LOBBY', 'PRACTICE', 'MOCK'])
const PRACTICE_SUBTYPE_IDS = new Set([4, 5])

export function isEspnPracticeLeague(league?: EspnLeaguePayload | null): boolean {
  if (!league) return false
  const name = String(league.settings?.name ?? '')
  if (/\b(?:practice|mock)\s+draft\b/i.test(name)) return true
  const subtype = league.settings?.leagueSubType ?? league.leagueSubType
  const normalized = typeof subtype === 'string' ? subtype.trim().toUpperCase().replace(/[ -]+/g, '_') : subtype
  if (typeof normalized === 'string' && (PRACTICE_SUBTYPES.has(normalized) || normalized.includes('MOCK') || normalized.includes('PRACTICE'))) return true
  if (Number(normalized) === 4 || Number(normalized) === 5) return true
  const subtypeId = league.settings?.leagueSubTypeId ?? league.leagueSubTypeId
  return PRACTICE_SUBTYPE_IDS.has(Number(subtypeId))
}

export function isEspnDraftRoomPage(pageUrl?: string | null): boolean {
  if (!pageUrl) return false
  try {
    const path = new URL(pageUrl, 'https://fantasy.espn.com').pathname
    return /\/(?:football\/)?(?:draft|waitingroom)(?:\/|$)/i.test(path)
  } catch {
    return /\/(?:football\/)?(?:draft|waitingroom)\b/i.test(pageUrl)
  }
}

/** Draft / waiting / mock-lobby tabs should not be reused as "Open ESPN Fantasy". */
export function isEspnTransientRoomUrl(pageUrl?: string | null): boolean {
  if (!pageUrl) return false
  try {
    const path = new URL(pageUrl, 'https://fantasy.espn.com').pathname
    return /\/(?:football\/)?(?:draft|waitingroom|mockdraftlobby)(?:\/|$)/i.test(path)
  } catch {
    return /\/(?:draft|waitingroom|mockdraftlobby)\b/i.test(pageUrl)
  }
}

export function isEspnPracticeSnapshot(snapshot: EspnSnapshot | null | undefined): boolean {
  if (!snapshot) return false
  if (snapshot.isPractice) return true
  if (isEspnPracticeLeague(snapshot.league)) return true
  const page = snapshot.pageUrl ?? ''
  return /\/(?:mockdraftlobby|waitingroom)\b/i.test(page)
}

export function espnSnapshotDraftId(snapshot: EspnSnapshot): string | null {
  if (!snapshot.league || !snapshot.leagueId) return null
  return espnDraftId(snapshot.season || '2026', snapshot.leagueId)
}

export function isLiveEspnFollowTarget(snapshot: EspnSnapshot): boolean {
  if (!snapshot.league || snapshot.error) return false
  if (snapshot.league.draftDetail?.inProgress === true) return true
  if (snapshot.league.draftDetail?.drafted === true) return false
  return isEspnPracticeSnapshot(snapshot) && isEspnDraftRoomPage(snapshot.pageUrl)
}

/**
 * The extension only holds one ESPN snapshot. Follow a different league id
 * when that snapshot is a live practice/mock or in-progress draft — or when
 * we are back on a real league after a throwaway practice room died.
 */
export function shouldFollowEspnSnapshot(routeDraftId: string, snapshot: EspnSnapshot): boolean {
  const liveId = espnSnapshotDraftId(snapshot)
  if (!liveId || liveId === routeDraftId) return false
  if (isLiveEspnFollowTarget(snapshot)) return true
  return !isEspnPracticeSnapshot(snapshot)
}

function leagueDisplayName(league: EspnLeaguePayload, leagueId: string, practice: boolean): string {
  const name = league.settings?.name || `ESPN ${leagueId}`
  if (!practice || /practice|mock/i.test(name)) return name
  return `${name} (Practice)`
}

/** ESPN's lineup-slot id for TE, the position premium leagues single out. */
const TE_SLOT_ID = '6'

/**
 * Points per reception for the league as a whole.
 *
 * ESPN expresses TE premium as `pointsOverrides` on the same reception item
 * rather than a separate stat, so reading `points` alone reports a 1.5-PPR-TE
 * league as plain PPR. The base rate still classifies the league -- the
 * premium is reported separately by `mapReceptionPoints`.
 */
function receptionItem(league: EspnLeaguePayload) {
  return league.settings?.scoringSettings?.scoringItems?.find(
    (item) => item.statId === 53,
  )
}

function classifyReceptionPoints(points: number): ScoringType {
  if (points >= 0.9) return 'ppr'
  if (points >= 0.4) return 'half_ppr'
  return 'std'
}

/**
 * The league's scoring format.
 *
 * ESPN publishes only the stats a league actually scores, so a standard league
 * has no reception item at all -- its absence is the answer, not a missing
 * one. Distinguishing that from a payload with no scoring settings whatsoever
 * matters: `unknown` is not a market, so it makes every ADP fall back to a
 * cross-market blend and picks the wrong expert board.
 */
function mapScoring(league: EspnLeaguePayload): ScoringType {
  const items = league.settings?.scoringSettings?.scoringItems
  // Nothing published -- most likely a practice clone served on one of the
  // slim view sets `espn-inject.js` falls back to.
  if (!items?.length) return 'unknown'
  const rec = items.find((item) => item.statId === 53)
  if (!rec) return 'std'
  return classifyReceptionPoints(rec.points)
}

/**
 * Reception points per position, when the league pays some positions more.
 * Null when every position scores the same, which is the common case.
 */
export function mapReceptionPremium(league: EspnLeaguePayload): { position: string; points: number }[] | null {
  const rec = receptionItem(league)
  const overrides = rec?.pointsOverrides
  if (!rec || !overrides) return null
  const premium: { position: string; points: number }[] = []
  for (const [slotId, points] of Object.entries(overrides)) {
    if (typeof points !== 'number' || points === rec.points) continue
    const position = slotId === TE_SLOT_ID ? 'TE' : SLOT_ID_TO_POS[slotId] ?? `Slot ${slotId}`
    premium.push({ position, points })
  }
  return premium.length ? premium : null
}

/**
 * ESPN statId -> our canonical scoring-settings key (`SETTINGS_STAT_MAP` in
 * `src/api/playerHistorical.ts`), for the stat categories that dataset
 * actually carries per player-season.
 *
 * ESPN's own numeric ids have no published schema. This table is not a
 * guess: it's the community-maintained mapping from `cwendt94/espn-api`
 * (Python; the one this codebase's own `receptionItem()` already trusts for
 * statId 53), cross-checked against `ffverse/ffscrapr`'s independent R
 * implementation, which reads scoring points from this exact same
 * `scoringSettings.scoringItems` array. Some categories have two known ids
 * (e.g. 3 and 22 both name "passingYards") -- both are listed, since a given
 * league's settings only ever contain one of a pair and either must resolve
 * to the same field.
 */
const ESPN_STAT_ID_TO_KEY: Record<number, string> = {
  3: 'pass_yd', 22: 'pass_yd',
  4: 'pass_td',
  20: 'pass_int',
  24: 'rush_yd', 40: 'rush_yd',
  25: 'rush_td',
  41: 'rec', 53: 'rec',
  42: 'rec_yd', 61: 'rec_yd',
  43: 'rec_td',
}

/**
 * Full per-stat scoring settings, converted from ESPN's statId-keyed array
 * into the same `pass_yd`/`pass_td`/... shape Sleeper already provides, so
 * both providers share one downstream scoring calculation
 * (`pointsFromSettings` in `src/api/playerHistorical.ts`). Null when the
 * league publishes no items we recognize, so callers fall back to the plain
 * PPR/half/standard split rather than compute from an empty settings object.
 */
export function mapScoringSettings(league: EspnLeaguePayload): Record<string, number> | null {
  const items = league.settings?.scoringSettings?.scoringItems
  if (!items?.length) return null
  const settings: Record<string, number> = {}
  for (const item of items) {
    const key = ESPN_STAT_ID_TO_KEY[item.statId]
    if (key) settings[key] = item.points
  }
  return Object.keys(settings).length ? settings : null
}

function mapDraftType(raw: string | undefined): DraftType {
  if (raw === 'AUCTION' || raw === 'SALARY_CAP') return 'auction'
  if (raw === 'SNAKE') return 'snake'
  return 'linear'
}

function mapStatus(league: EspnLeaguePayload): DraftStatus {
  if (league.draftDetail?.inProgress) return 'drafting'
  if (league.draftDetail?.drafted) return 'complete'
  return 'pre_draft'
}

function teamName(team: EspnTeam): string {
  const combined = `${team.location ?? ''} ${team.nickname ?? ''}`.trim()
  return combined || team.name || team.abbrev || `Team ${team.id}`
}

function espnTeamLogo(team: EspnTeam | undefined): string | null {
  const logo = team?.logo?.trim()
  return logo && /^https?:\/\//i.test(logo) ? logo : null
}

function slotCounts(league: EspnLeaguePayload): {
  slots: SlotCounts
  rosterPositions: string[]
} {
  const counts = league.settings?.rosterSettings?.lineupSlotCounts
  if (!counts) {
    const fallback = defaultSlotCounts()
    return {
      slots: fallback,
      rosterPositions: Object.entries(fallback).flatMap(([pos, n]) =>
        Array.from({ length: n }, () => pos),
      ),
    }
  }
  const rosterPositions: string[] = []
  for (const [id, n] of Object.entries(counts)) {
    const pos = SLOT_ID_TO_POS[id]
    if (!pos || n <= 0) continue
    for (let i = 0; i < n; i += 1) rosterPositions.push(pos)
  }
  return {
    slots: slotsFromRosterPositions(rosterPositions),
    rosterPositions,
  }
}

function buildTeamSlots(league: EspnLeaguePayload): Map<number, number> {
  const map = new Map<number, number>()
  const teams = [...(league.teams ?? [])]
  const teamCount = league.settings?.size ?? teams.length
  const draftType = mapDraftType(league.settings?.draftSettings?.type)
  const pickOrder = league.settings?.draftSettings?.pickOrder ?? []
  if (pickOrder.length === teamCount && new Set(pickOrder).size === teamCount) {
    pickOrder.forEach((teamId, index) => map.set(Number(teamId), index + 1))
    return map
  }

  // A keeper reservation in any round still proves its team's draft slot.
  // ESPN practice drafts often publish only the user's keeper history before
  // anyone else has picked, so preserve partial evidence and fill around it.
  const usedSlots = new Set<number>()
  for (const pick of league.draftDetail?.picks ?? []) {
    if (!pick.teamId || !pick.roundId || !pick.roundPickNumber) continue
    const slot = draftType === 'snake' && pick.roundId % 2 === 0
      ? teamCount - pick.roundPickNumber + 1
      : pick.roundPickNumber
    if (slot < 1 || slot > teamCount) continue
    const existing = map.get(pick.teamId)
    if (existing === slot) continue
    if (existing != null || usedSlots.has(slot)) continue
    map.set(pick.teamId, slot)
    usedSlots.add(slot)
  }
  if (map.size === teamCount) return map

  teams.sort(
    (a, b) => (a.draftPosition ?? a.id) - (b.draftPosition ?? b.id),
  )
  const openSlots = Array.from({ length: teamCount }, (_, index) => index + 1)
    .filter((slot) => !usedSlots.has(slot))
  for (const team of teams) {
    if (map.has(team.id)) continue
    const preferred = team.draftPosition
    const preferredIndex = preferred == null ? -1 : openSlots.indexOf(preferred)
    const slot = preferredIndex >= 0
      ? openSlots.splice(preferredIndex, 1)[0]
      : openSlots.shift()
    if (slot != null) map.set(team.id, slot)
  }
  return map
}

/**
 * Who owns each pick, straight from ESPN's published board.
 *
 * ESPN ships every row of the draft up front -- 180 of them for a 12x15 --
 * carrying `overallPickNumber`, `roundId`, `roundPickNumber` and `teamId`,
 * with `playerId: -1` on the picks nobody has made yet. Those placeholder rows
 * are not picks, but they are the draft order, and inferring that order from
 * snake parity instead gets it wrong: a keeper league runs its keeper rounds
 * in straight draft order and only starts snaking afterwards, so parity agrees
 * with ESPN in round 1 and 3 and mirrors every other round.
 *
 * Returns null when ESPN published nothing usable, so callers fall back to the
 * snake math rather than trusting a half-built board.
 */
function buildPickOwners(league: EspnLeaguePayload, teamSlots: Map<number, number>): (number | null)[] | null {
  const picks = league.draftDetail?.picks ?? []
  if (!picks.length) return null
  const owners: (number | null)[] = []
  let known = 0
  for (const pick of picks) {
    const overall = Number(pick.overallPickNumber)
    if (!(overall > 0) || pick.teamId == null) continue
    const slot = teamSlots.get(pick.teamId)
    if (slot == null) continue
    while (owners.length < overall) owners.push(null)
    if (owners[overall - 1] == null) known += 1
    owners[overall - 1] = slot
  }
  return known > 0 ? owners : null
}

function snapshotIds(snapshot: EspnSnapshot) {
  const leagueId = snapshot.leagueId
  const season = snapshot.season || '2026'
  if (!leagueId) {
    throw new Error('ESPN snapshot has no league id')
  }
  return { leagueId, season }
}

export function mapEspnLeague(snapshot: EspnSnapshot): LeagueSummary {
  const league = snapshot.league
  const { leagueId, season } = snapshotIds(snapshot)
  if (!league) {
    throw new Error('ESPN snapshot has no league payload')
  }
  const practice = isEspnPracticeSnapshot(snapshot)
  return {
    id: leagueId,
    name: leagueDisplayName(league, leagueId, practice),
    season,
    teamCount: league.settings?.size ?? league.teams?.length ?? 0,
    status: mapStatus(league),
    scoringType: mapScoring(league),
    keeperCount: practice ? null : league.settings?.draftSettings?.keeperCount ?? null,
    draftId: espnDraftId(season, leagueId),
    draftStatus: mapStatus(league),
    avatar: null,
    isPractice: practice,
    teams: (league.teams ?? []).map((team) => ({
      id: String(team.id),
      name: teamName(team),
      isYou: Boolean(
        (snapshot.teamId && String(team.id) === snapshot.teamId) ||
          (snapshot.swid &&
            (team.primaryOwner === snapshot.swid ||
              team.owners?.includes(snapshot.swid))),
      ),
    })),
  }
}

export function mapEspnSession(
  snapshot: EspnSnapshot,
  yourUserId: string,
): DraftSession {
  const league = snapshot.league
  const { leagueId, season } = snapshotIds(snapshot)
  if (!league) {
    throw new Error('ESPN snapshot has no league payload')
  }
  const { slots, rosterPositions } = slotCounts(league)
  const teamSlots = buildTeamSlots(league)
  const members = new Map(
    (league.members ?? []).map((m) => [m.id, m.displayName ?? m.id]),
  )
  const teams = league.teams ?? []
  const teamCount = league.settings?.size ?? teams.length
  const order = Array.from({ length: teamCount }, (_, i) => {
    const slot = i + 1
    const team = teams.find((t) => teamSlots.get(t.id) === slot) ?? teams[i]
    const userId = team ? String(team.id) : String(slot)
    const ownerName = team?.primaryOwner
      ? members.get(team.primaryOwner)
      : undefined
    return {
      slot,
      rosterId: userId,
      userId,
      displayName: ownerName || (team ? teamName(team) : `Slot ${slot}`),
      teamName: team ? teamName(team) : `Slot ${slot}`,
      avatar: espnTeamLogo(team),
      isYou: userId === yourUserId,
    }
  })

  const practice = isEspnPracticeSnapshot(snapshot)
  return {
    provider: 'espn',
    draftId: espnDraftId(season, leagueId),
    leagueId,
    name: leagueDisplayName(league, leagueId, practice),
    type: mapDraftType(league.settings?.draftSettings?.type),
    status: mapStatus(league),
    season,
    scoringType: mapScoring(league),
    teams: teamCount,
    rounds: Math.max(rosterPositions.length, 1),
    pickTimer: league.settings?.draftSettings?.pickTimeout ?? null,
    slots,
    rosterPositions,
    order,
    yourUserId,
    yourSlot: order.find((s) => s.isYou)?.slot ?? null,
    startTime: league.settings?.draftSettings?.availableDate ?? null,
    keeperCount: practice ? null : league.settings?.draftSettings?.keeperCount ?? null,
    receptionPremium: mapReceptionPremium(league),
    scoringSettings: mapScoringSettings(league),
    // The ESPN settings payload does not publish a playoff week window;
    // callers fall back to the standard weeks 15-17 default.
    playoffWeeks: null,
    pickOwners: buildPickOwners(league, teamSlots),
    isPractice: practice,
  }
}

/**
 * ESPN's placeholder id for a pick nobody has made yet.
 *
 * The whole board ships pre-filled with these, so picks have to be told apart
 * from scaffolding -- but not by sign. Team defenses carry negative ids of
 * their own (`-16034` is the Texans D/ST), so a `playerId > 0` test throws
 * every drafted defense out with the placeholders. Compare against this exact
 * value instead.
 */
const EMPTY_PICK_PLAYER_ID = -1

function pickHasPlayer(pick: { playerId?: number }): boolean {
  return pick.playerId != null && pick.playerId !== EMPTY_PICK_PLAYER_ID && pick.playerId !== 0
}

export function mapEspnPicks(snapshot: EspnSnapshot): DraftPick[] {
  const league = snapshot.league
  if (!league) return []
  const teamSlots = buildTeamSlots(league)
  const teamCount = league.settings?.size ?? league.teams?.length ?? teamSlots.size
  const draftType = mapDraftType(league.settings?.draftSettings?.type)
  // A row missing its overall pick number still sits on the published board,
  // so resolve it there before falling back to snake arithmetic.
  const owners = buildPickOwners(league, teamSlots)
  const players = new Map(
    mapEspnPlayers(snapshot).map((p) => [p.id, p]),
  )
  return (league.draftDetail?.picks ?? [])
    // Keeper rows arrive before ESPN stamps them with an overall pick number;
    // dropping them for want of that number hides keepers for the whole
    // window between the commissioner locking them and the draft starting.
    .filter((pick) => pickHasPlayer(pick) && Boolean(pick.overallPickNumber || (pick.roundId && pick.roundPickNumber) || pick.keeper || pick.reservedForKeeper))
    .map((pick) => {
      const playerId = String(pick.playerId)
      const player = players.get(playerId)
      const slot = pick.teamId ? teamSlots.get(pick.teamId) : undefined
      const round = pick.roundId ?? 1
      const draftSlot = slot ?? pick.roundPickNumber ?? 1
      const pickNo =
        pick.overallPickNumber ||
        (teamCount > 0 ? pickNumberFor(round, draftSlot, teamCount, draftType, owners) : 0)
      return {
        playerId,
        pickedByUserId: pick.teamId != null ? String(pick.teamId) : null,
        rosterId: pick.teamId != null ? String(pick.teamId) : null,
        round,
        draftSlot,
        pickNo,
        isKeeper: Boolean(pick.keeper || pick.reservedForKeeper),
        meta: player
          ? {
              firstName: player.firstName,
              lastName: player.lastName,
              position: player.position,
              team: player.team,
              injuryStatus: player.injuryStatus,
            }
          : null,
      }
    })
    .sort((a, b) => a.pickNo - b.pickNo)
}

/**
 * Keepers ESPN has published for the league.
 *
 * ESPN only fills this once the commissioner locks keeper selections, which is
 * often days before the draft -- until then the list is legitimately empty and
 * hand-entered keepers are all there is.
 */
export function mapEspnKeepers(snapshot: EspnSnapshot): KeeperEntry[] {
  const league = snapshot.league
  if (!league || isEspnPracticeSnapshot(snapshot)) return []
  return (league.draftDetail?.picks ?? [])
    .filter((pick) => Boolean(pick.keeper || pick.reservedForKeeper) && pickHasPlayer(pick) && pick.teamId != null)
    .map((pick) => ({
      playerId: String(pick.playerId),
      rosterId: String(pick.teamId),
      round: pick.roundId ?? null,
      source: 'espn' as const,
    }))
}

/**
 * Players ESPN says are keepable, with the round each would cost.
 *
 * Unlike `mapEspnKeepers` this is available the whole pre-draft window: it is
 * the rosters as they stand plus ESPN's `keeperValue`, so it prefills the
 * editor with candidates before anyone has chosen.
 */
export function mapEspnKeeperCandidates(snapshot: EspnSnapshot): EspnKeeperCandidate[] {
  const league = snapshot.league
  if (!league || isEspnPracticeSnapshot(snapshot)) return []
  const candidates: EspnKeeperCandidate[] = []
  for (const team of league.teams ?? []) {
    for (const entry of team.roster?.entries ?? []) {
      const playerId = entry.playerId ?? entry.playerPoolEntry?.id
      if (!playerId) continue
      const value = entry.playerPoolEntry?.keeperValue
      candidates.push({
        playerId: String(playerId),
        rosterId: String(team.id),
        round: typeof value === 'number' && value > 0 ? value : null,
      })
    }
  }
  return candidates
}

export function mapEspnPlayers(snapshot: EspnSnapshot): Player[] {
  const scoring = snapshot.league ? mapScoring(snapshot.league) : 'unknown'
  const rankKey = scoring === 'ppr' || scoring === 'half_ppr' ? 'PPR' : 'STANDARD'
  const players: Player[] = []
  for (const entry of snapshot.players ?? []) {
    const nested = entry.player
    const id = String(nested?.id ?? entry.id ?? '')
    if (!id) continue
    const positionId = nested?.defaultPositionId ?? entry.defaultPositionId
    const position = POSITION_BY_ID[positionId ?? -1]
    if (!position) continue
    const firstName = nested?.firstName ?? entry.firstName ?? ''
    const lastName = nested?.lastName ?? entry.lastName ?? ''
    const fullName =
      nested?.fullName ||
      entry.fullName ||
      `${firstName} ${lastName}`.trim() ||
      id
    const ranks = nested?.draftRanksByRankType
    const rank =
      ranks?.[rankKey]?.rank ?? ranks?.STANDARD?.rank ?? ranks?.PPR?.rank ?? 9999
    const injuryStatus = nested?.injuryStatus
    const injury =
      injuryStatus && injuryStatus !== 'ACTIVE' ? injuryStatus : null
    const proTeamId = nested?.proTeamId ?? entry.proTeamId ?? 0
    // ESPN publishes a real average draft position; `draftRanksByRankType` is
    // an editorial ranking, which is a different thing and belongs in
    // searchRank. Zero means "never drafted in any league", not "goes first".
    const espnAdp = nested?.ownership?.averageDraftPosition
    players.push({
      id,
      firstName,
      lastName,
      fullName,
      position,
      team: PRO_TEAMS[proTeamId] ?? null,
      searchRank: rank > 0 ? rank : 9999,
      injuryStatus: injury,
      number: nested?.jersey ?? null,
      yearsExp: null,
      bye: null,
      espnId: id,
      adp: typeof espnAdp === 'number' && espnAdp > 0 ? espnAdp : null,
    })
  }
  players.sort((a, b) => a.searchRank - b.searchRank)
  return players
}
