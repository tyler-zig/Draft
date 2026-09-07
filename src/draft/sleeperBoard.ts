import type { SleeperDraft, SleeperLeague, SleeperTradedPick } from '../api/sleeper'
import type { DraftType, LeagueFormat } from '../providers/types'

/**
 * Who owns each pick on a Sleeper board.
 *
 * Sleeper does not publish a full pick-by-pick order the way ESPN does. The
 * snake math is usually enough, but two house rules break it: 3rd-round
 * reversal (`settings.reversal_round`) and mid-draft / pre-draft pick trades
 * (`/draft/{id}/traded_picks`). This builds the same `pickOwners` array the
 * rest of the room already reads.
 */
export function sleeperSlotForPick(
  pickNo: number,
  teams: number,
  type: DraftType,
  reversalRound = 0,
): number {
  if (pickNo < 1 || teams < 1) return 1
  const round = Math.ceil(pickNo / teams)
  const indexInRound = (pickNo - 1) % teams
  if (type === 'linear' || type === 'auction') return indexInRound + 1
  let reverse = type === 'snake' && round % 2 === 0
  if (reversalRound > 0 && round >= reversalRound) reverse = !reverse
  return reverse ? teams - indexInRound : indexInRound + 1
}

export function buildSleeperPickOwners(options: {
  teams: number
  rounds: number
  type: DraftType
  reversalRound?: number | null
  slotToRosterId?: Record<string, number> | null
  tradedPicks?: SleeperTradedPick[] | null
  season?: string | null
}): (number | null)[] | null {
  const { teams, rounds, type } = options
  if (type === 'auction' || teams < 1 || rounds < 1) return null

  const reversalRound = options.reversalRound && options.reversalRound > 0
    ? options.reversalRound
    : 0
  const slotToRoster = options.slotToRosterId ?? {}
  const rosterToSlot = new Map<number, number>()
  for (const [slot, rosterId] of Object.entries(slotToRoster)) {
    const parsed = Number(slot)
    if (parsed > 0) rosterToSlot.set(Number(rosterId), parsed)
  }

  const tradesByRoundRoster = new Map<string, number>()
  for (const trade of options.tradedPicks ?? []) {
    if (!trade || !(trade.round > 0) || trade.owner_id == null || trade.roster_id == null) {
      continue
    }
    if (options.season && trade.season && trade.season !== options.season) continue
    tradesByRoundRoster.set(`${trade.round}:${trade.roster_id}`, Number(trade.owner_id))
  }

  const needsPublishedBoard = reversalRound > 0 || tradesByRoundRoster.size > 0
  if (!needsPublishedBoard) return null

  const owners: number[] = []
  const total = teams * rounds
  for (let pickNo = 1; pickNo <= total; pickNo += 1) {
    const originalSlot = sleeperSlotForPick(pickNo, teams, type, reversalRound)
    const originalRoster = slotToRoster[String(originalSlot)]
    const tradedOwner = originalRoster == null
      ? undefined
      : tradesByRoundRoster.get(`${Math.ceil(pickNo / teams)}:${originalRoster}`)
    const tradedSlot = tradedOwner == null ? undefined : rosterToSlot.get(tradedOwner)
    owners.push(tradedSlot ?? originalSlot)
  }
  return owners
}

/**
 * When the current Sleeper pick expires.
 *
 * Sleeper publishes `last_picked` (ms) and `pick_timer` (seconds). The first
 * pick of a live draft uses `start_time` until someone is off the clock.
 * Slow / unlimited rooms leave `pick_timer` at 0 and we do not invent a clock.
 */
export function sleeperClockEndsAt(draft: Pick<SleeperDraft, 'status' | 'start_time' | 'last_picked' | 'settings'>): number | null {
  if (draft.status !== 'drafting') return null
  const timer = draft.settings?.pick_timer
  if (typeof timer !== 'number' || timer <= 0) return null
  const last = draft.last_picked ?? draft.start_time
  if (typeof last !== 'number' || last <= 0) return null
  const startedAt = last < 1e12 ? last * 1000 : last
  return startedAt + timer * 1000
}

const CHOPPED_NAME = /\bchopped\b|\blast[\s_-]?man[\s_-]?standing\b/

/**
 * Sleeper's published `settings.type` values. Chopped is 3 -- confirmed on
 * live league 1401696318404952064 ("Wisconsin Dudes"), which also carries
 * `last_chopped_leg` and draft `metadata.league_type: "3"`. 0 redraft, 1
 * keeper, 2 dynasty. A chopped league can still have `max_keepers`, so type
 * must win over that count.
 */
const SLEEPER_TYPE_CHOPPED = 3
const SLEEPER_TYPE_DYNASTY = 2
const SLEEPER_TYPE_KEEPER = 1

function textBlob(
  league: Pick<SleeperLeague, 'name' | 'metadata'> | null | undefined,
  draft?: Pick<SleeperDraft, 'metadata'> | null,
): string {
  const parts = [
    league?.name,
    league?.metadata?.name,
    league?.metadata?.description,
    league?.metadata?.league_type,
    league?.metadata?.format,
    draft?.metadata?.name,
    draft?.metadata?.description,
  ]
  return parts.filter((value): value is string => Boolean(value)).join(' ').toLowerCase()
}

function publishedType(
  league: Pick<SleeperLeague, 'settings'> | null | undefined,
  draft?: Pick<SleeperDraft, 'metadata'> | null,
): number | null {
  const fromSettings = league?.settings?.type
  if (typeof fromSettings === 'number') return fromSettings
  const fromDraft = draft?.metadata?.league_type
  if (fromDraft == null || fromDraft === '') return null
  const parsed = Number(fromDraft)
  return Number.isFinite(parsed) ? parsed : null
}

export function isSleeperMock(draft: Pick<SleeperDraft, 'league_id' | 'metadata'> | null | undefined): boolean {
  const type = draft?.metadata?.type?.toLowerCase() ?? ''
  if (type.includes('mock')) return true
  return Boolean(draft && !draft.league_id)
}

export function sleeperParentLeagueId(draft: Pick<SleeperDraft, 'league_id' | 'metadata'> | null | undefined): string | null {
  const fromDraft = draft?.league_id?.trim()
  if (fromDraft) return fromDraft
  const fromMeta = draft?.metadata?.league_id?.trim()
  return fromMeta || null
}

export function detectLeagueFormat(
  league: Pick<SleeperLeague, 'name' | 'settings' | 'metadata'> | null | undefined,
  draft?: Pick<SleeperDraft, 'metadata'> | null,
): LeagueFormat {
  const settings = league?.settings ?? {}
  const type = publishedType(league, draft)
  if (
    type === SLEEPER_TYPE_CHOPPED ||
    settings.chopped === 1 ||
    settings.last_man_standing === 1 ||
    settings.lms === 1 ||
    typeof settings.last_chopped_leg === 'number' ||
    CHOPPED_NAME.test(textBlob(league, draft))
  ) {
    return 'chopped'
  }
  if (settings.best_ball === 1) return 'best_ball'
  if (type === SLEEPER_TYPE_DYNASTY) return 'dynasty'
  if (type === SLEEPER_TYPE_KEEPER || (settings.max_keepers ?? 0) > 0) return 'keeper'
  return 'redraft'
}
