import type { DraftPick } from '../providers/types'

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
