import type { DraftPick, DraftSession, KeeperEntry, KeeperSource, Player } from '../providers/types'
import { pickNumberFor } from './snake'
import { occupiedPickNumbers, occupiesDraftSlot } from './pickSlots'
import { mirrorDraftState } from '../supabase/cloudStore'

const PREFIX = 'draft-assistant:keepers:'

export function keeperStorageKey(providerId: string | undefined, draftId: string | undefined): string {
  return `${providerId ?? ''}:${draftId ?? ''}`
}

function isKeeperEntry(value: unknown): value is KeeperEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<KeeperEntry>
  return (
    typeof entry.playerId === 'string' &&
    entry.playerId.length > 0 &&
    typeof entry.rosterId === 'string' &&
    (entry.round == null || typeof entry.round === 'number')
  )
}

/**
 * Manual keepers persist in localStorage, not sessionStorage like the queue:
 * they are league facts that outlive a tab, and re-entering twelve teams'
 * keepers because someone closed the window is not a thing anyone will do.
 */
export function loadKeepers(draftKey: string): KeeperEntry[] {
  try {
    const raw = localStorage.getItem(PREFIX + draftKey)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isKeeperEntry).map((entry) => ({
      playerId: entry.playerId,
      rosterId: entry.rosterId,
      round: entry.round ?? null,
      source: entry.source === 'espn' || entry.source === 'sleeper' ? entry.source : 'manual',
    }))
  } catch {
    return []
  }
}

export function saveKeepers(draftKey: string, entries: KeeperEntry[]) {
  try {
    localStorage.setItem(PREFIX + draftKey, JSON.stringify(entries))
    void mirrorDraftState(draftKey)
  } catch {
    /* storage full or blocked -- the in-memory list still drives this session */
  }
}

export interface KeeperConflict {
  playerId: string
  /** What you entered by hand. */
  manual: KeeperEntry
  /** What the league site published. */
  synced: KeeperEntry
  reason: 'team' | 'round'
}

export interface MergedKeepers {
  keepers: KeeperEntry[]
  conflicts: KeeperConflict[]
}

/**
 * League-site keepers win over hand-entered ones, because the site is the
 * league of record once it has locked selections. Manual entries the site
 * disagrees with are surfaced as conflicts rather than silently rewritten --
 * you enter keepers days before ESPN publishes them, and a value quietly
 * changing under you is worse than being told it changed.
 */
export function mergeKeepers(manual: KeeperEntry[], synced: KeeperEntry[]): MergedKeepers {
  const byPlayer = new Map<string, KeeperEntry>()
  const conflicts: KeeperConflict[] = []
  for (const entry of manual) byPlayer.set(entry.playerId, entry)
  for (const entry of synced) {
    const previous = byPlayer.get(entry.playerId)
    if (previous && previous.source === 'manual') {
      if (previous.rosterId !== entry.rosterId) {
        conflicts.push({ playerId: entry.playerId, manual: previous, synced: entry, reason: 'team' })
      } else if (entry.round != null && previous.round != null && previous.round !== entry.round) {
        conflicts.push({ playerId: entry.playerId, manual: previous, synced: entry, reason: 'round' })
      }
    }
    byPlayer.set(entry.playerId, entry)
  }
  return { keepers: [...byPlayer.values()], conflicts }
}

/** Replaces every entry from `source`, leaving entries from other sources alone. */
export function replaceKeepersFromSource(
  entries: KeeperEntry[],
  source: KeeperSource,
  next: KeeperEntry[],
): KeeperEntry[] {
  const kept = entries.filter((entry) => entry.source !== source)
  return mergeKeepers(kept, next).keepers
}

export function upsertKeeper(entries: KeeperEntry[], entry: KeeperEntry): KeeperEntry[] {
  const without = entries.filter((item) => item.playerId !== entry.playerId)
  return [...without, entry]
}

export function removeKeeper(entries: KeeperEntry[], playerId: string): KeeperEntry[] {
  return entries.filter((entry) => entry.playerId !== playerId)
}

const COST_ROUNDS_PREFIX = 'draft-assistant:keepers-cost-rounds:'

/**
 * League rule: whether a keeper consumes its team's pick in that round.
 *
 * Default is yes -- that is how ESPN, Sleeper, and most keeper leagues work.
 * Some leagues park keepers on the roster before the draft and still run a
 * full snake, so this is stored per draft rather than as a global preference.
 */
export function loadKeepersCostRoundPicks(draftKey: string): boolean {
  try {
    const raw = localStorage.getItem(COST_ROUNDS_PREFIX + draftKey)
    return raw !== '0' && raw !== 'false'
  } catch {
    return true
  }
}

export function saveKeepersCostRoundPicks(draftKey: string, value: boolean) {
  try {
    localStorage.setItem(COST_ROUNDS_PREFIX + draftKey, value ? '1' : '0')
    void mirrorDraftState(draftKey)
  } catch {
    /* in-memory state still drives this session */
  }
}

// Re-exported so existing callers keep importing these from `keepers`; they
// live in `pickSlots` so the extension bundle can take them without this
// module's Supabase mirroring. See `src/draft/pickSlots.ts`.
export { occupiedPickNumbers, occupiesDraftSlot } from './pickSlots'

export interface KeeperPickOptions {
  /** When false, keepers stay taken/on the roster but do not consume a snake slot. */
  costRoundPicks?: boolean
}

interface KeeperPickContext {
  teams: number
  rounds: number
  type: DraftSession['type']
  /** rosterId -> draft slot. */
  slotByRoster: Map<string, number>
  /** The provider's published board, when it has one. */
  owners: DraftSession['pickOwners']
}

function contextFor(session: DraftSession): KeeperPickContext {
  return {
    teams: session.teams,
    rounds: session.rounds,
    type: session.type,
    slotByRoster: new Map(session.order.map((slot) => [slot.rosterId, slot.slot])),
    owners: session.pickOwners,
  }
}

function keeperDraftPick(
  entry: KeeperEntry,
  rosterId: string,
  slot: number,
  round: number,
  pickNo: number,
  playersById?: Map<string, Player>,
): DraftPick {
  const player = playersById?.get(entry.playerId)
  return {
    playerId: entry.playerId,
    pickedByUserId: rosterId,
    rosterId,
    round,
    draftSlot: slot,
    pickNo,
    isKeeper: true,
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
}

function liftKeepersOffBoard(picks: DraftPick[]): DraftPick[] {
  if (!picks.some((pick) => pick.isKeeper && occupiesDraftSlot(pick))) return picks
  return picks.map((pick) => (pick.isKeeper && occupiesDraftSlot(pick) ? { ...pick, pickNo: 0 } : pick))
}

/**
 * Turns keeper entries into the picks they consume.
 *
 * Everything downstream -- availability, your roster, the board, recs -- reads
 * `DraftPick[]`, so keepers become picks rather than a parallel concept that
 * every consumer would have to learn about.
 *
 * Real picks win outright: once a draft is running (or ESPN has stamped a
 * keeper with an overall pick number) the board is the truth.
 *
 * When `costRoundPicks` is false, keepers still take the player and a roster
 * spot, but `pickNo` stays off the snake so every team still drafts each round.
 */
export function keeperPicks(
  keepers: KeeperEntry[],
  session: DraftSession,
  madePicks: DraftPick[] = [],
  playersById?: Map<string, Player>,
  options: KeeperPickOptions = {},
): DraftPick[] {
  const costRoundPicks = options.costRoundPicks !== false
  const context = contextFor(session)
  const drafted = new Set(madePicks.map((pick) => pick.playerId))
  const occupied = occupiedPickNumbers(madePicks)
  const byRoster = new Map<string, KeeperEntry[]>()
  for (const entry of keepers) {
    if (drafted.has(entry.playerId)) continue
    if (!context.slotByRoster.has(entry.rosterId)) continue
    const list = byRoster.get(entry.rosterId) ?? []
    list.push(entry)
    byRoster.set(entry.rosterId, list)
  }

  const picks: DraftPick[] = []
  let offBoard = 0
  for (const [rosterId, entries] of byRoster) {
    const slot = context.slotByRoster.get(rosterId)!
    if (!costRoundPicks) {
      for (const entry of entries) {
        offBoard += 1
        picks.push(keeperDraftPick(entry, rosterId, slot, entry.round ?? 0, -offBoard, playersById))
      }
      continue
    }

    const usedRounds = new Set<number>()
    // Rounds the site named are honoured first so an unpriced keeper cannot
    // squat on a round another keeper actually costs.
    const priced = entries.filter((entry) => entry.round != null)
    const unpriced = entries.filter((entry) => entry.round == null)
    const assigned: Array<{ entry: KeeperEntry; round: number }> = []

    for (const entry of priced) {
      let round = Math.min(Math.max(1, entry.round!), context.rounds)
      while (usedRounds.has(round) && round < context.rounds) round += 1
      while (usedRounds.has(round) && round > 1) round -= 1
      if (usedRounds.has(round)) continue
      usedRounds.add(round)
      assigned.push({ entry, round })
    }
    // No round cost means the common "keep N, lose your top N picks" rule.
    for (const entry of unpriced) {
      let round = 1
      while (usedRounds.has(round) && round <= context.rounds) round += 1
      if (round > context.rounds) continue
      usedRounds.add(round)
      assigned.push({ entry, round })
    }

    for (const { entry, round } of assigned) {
      const pickNo = pickNumberFor(round, slot, context.teams, context.type, context.owners)
      if (occupied.has(pickNo)) continue
      occupied.add(pickNo)
      picks.push(keeperDraftPick(entry, rosterId, slot, round, pickNo, playersById))
    }
  }
  return picks.sort((a, b) => a.pickNo - b.pickNo)
}

/** Made picks plus the picks keepers consume, in board order. */
export function withKeeperPicks(
  madePicks: DraftPick[],
  keepers: KeeperEntry[],
  session: DraftSession | undefined,
  playersById?: Map<string, Player>,
  options: KeeperPickOptions = {},
): DraftPick[] {
  const costRoundPicks = options.costRoundPicks !== false
  const boardPicks = costRoundPicks ? madePicks : liftKeepersOffBoard(madePicks)
  if (!session || !keepers.length) return boardPicks
  const synthetic = keeperPicks(keepers, session, boardPicks, playersById, { costRoundPicks })
  if (!synthetic.length) return boardPicks
  return [...boardPicks, ...synthetic].sort((a, b) => a.pickNo - b.pickNo)
}

/** How many keepers each team still has room for, when the league caps them. */
export function keeperRoom(
  keepers: KeeperEntry[],
  rosterId: string,
  keeperCount: number | null | undefined,
): number | null {
  if (keeperCount == null || keeperCount <= 0) return null
  const used = keepers.filter((entry) => entry.rosterId === rosterId).length
  return keeperCount - used
}
