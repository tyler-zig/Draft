import type { DraftPick, DraftSession } from '../providers/types'
import { ownerSlotForPick } from './snake'

/**
 * Which board slots a set of picks occupies.
 *
 * Split out of `keepers.ts` so callers that only need this arithmetic do not
 * drag in that module's Supabase mirroring: the Chrome extension bundles these
 * two functions and nothing else from the draft code would justify shipping a
 * database client to a content script.
 */

/** A pick the snake still has to make -- keepers that do not cost a round sit at pick 0 or below. */
export function occupiesDraftSlot(pick: DraftPick): boolean {
  return pick.pickNo > 0
}

export function occupiedPickNumbers(picks: DraftPick[]): Set<number> {
  return new Set(picks.filter(occupiesDraftSlot).map((pick) => pick.pickNo))
}

/**
 * The furthest pick the room has actually reached.
 *
 * Keepers are excluded on purpose. They are made before anyone is on the
 * clock and sit at the picks they cost, so counting them would put the
 * frontier in the middle of the board before the draft has started -- and a
 * keeper reserved in a late round would push it to the end. What is left is
 * the high-water mark of picks somebody was on the clock for.
 */
export function draftFrontier(picks: DraftPick[]): number {
  let frontier = 0
  for (const pick of picks) {
    if (pick.isKeeper || !occupiesDraftSlot(pick)) continue
    if (pick.pickNo > frontier) frontier = pick.pickNo
  }
  return frontier
}

/** The room facts needed to say which team a pick belongs to. */
type PickRoom = Pick<DraftSession, 'order' | 'teams' | 'type' | 'pickOwners'>

/**
 * Which team slot a pick belongs to.
 *
 * `DraftPick.draftSlot` is a provider-reported field and is not always the
 * team's slot. ESPN falls back to `roundPickNumber` when it cannot match the
 * team (`mapEspn.ts`), and in a snake's even rounds that is the *reversed*
 * position -- so a pick lands on another team's roster.
 *
 * `rosterId` is the provider's own team id and is the authoritative link, so
 * it wins. Failing that, the slot implied by the overall pick number is a
 * better answer than the reported one, because `pickNo` is what the board and
 * the pick strip already agree on. The reported slot is the last resort.
 */
export function pickTeamSlot(pick: DraftPick, room: PickRoom): number {
  if (pick.rosterId) {
    const owner = room.order.find((slot) => slot.rosterId === pick.rosterId)
    if (owner) return owner.slot
  }
  if (pick.pickNo > 0 && room.teams > 0) {
    return ownerSlotForPick(pick.pickNo, room.teams, room.type, room.pickOwners).slot
  }
  return pick.draftSlot
}

/**
 * Rewrites every pick's `draftSlot` to the team that actually owns it.
 *
 * Done once where picks enter the app so that rosters, recommendations,
 * grades and the overlay all read a self-consistent board -- those consumers
 * take a slot number rather than a session, and normalising here beats
 * threading the room through each of them.
 */
export function normalizePickSlots<T extends DraftPick>(picks: T[], room: PickRoom | undefined): T[] {
  if (!room || !room.order.length) return picks
  let changed = false
  const next = picks.map((pick) => {
    const slot = pickTeamSlot(pick, room)
    if (slot === pick.draftSlot) return pick
    changed = true
    return { ...pick, draftSlot: slot }
  })
  return changed ? next : picks
}
