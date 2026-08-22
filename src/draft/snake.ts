import type { DraftType } from '../providers/types'

export interface RoundSlot {
  round: number
  slot: number
}

/**
 * The board a provider published: draft slot per pick, indexed by pick number
 * minus one. Null entries mean the provider said nothing about that pick.
 *
 * Every function here takes this as an optional last argument and prefers it
 * over snake arithmetic, because the arithmetic is an assumption and real
 * leagues break it -- ESPN runs keeper rounds in straight draft order before
 * it starts snaking, and third-round reversal is a common house rule. When a
 * provider does not publish a board this stays undefined and nothing changes.
 */
export type PickOwners = readonly (number | null)[] | null | undefined

function publishedSlot(owners: PickOwners, pickNo: number): number | null {
  const slot = owners?.[pickNo - 1]
  return slot != null && slot > 0 ? slot : null
}

export function ownerSlotForPick(
  pickNo: number,
  teams: number,
  type: DraftType,
  owners?: PickOwners,
): RoundSlot {
  if (pickNo < 1 || teams < 1) {
    return { round: 1, slot: 1 }
  }
  const round = Math.ceil(pickNo / teams)
  const published = publishedSlot(owners, pickNo)
  if (published != null) return { round, slot: published }
  const indexInRound = (pickNo - 1) % teams
  if (type === 'snake' && round % 2 === 0) {
    return { round, slot: teams - indexInRound }
  }
  return { round, slot: indexInRound + 1 }
}

export function currentPickNumber(picksMade: number): number {
  return picksMade + 1
}

/**
 * The lowest pick number nobody owns yet.
 *
 * Keeper picks are slotted into the rounds they cost, so a keeper league's
 * made picks are not a contiguous run from pick 1 and `picks.length + 1` walks
 * straight past the picks still on the board.
 */
export function nextOpenPickNumber(
  takenPickNos: Iterable<number>,
  total: number,
): number {
  const taken = takenPickNos instanceof Set ? takenPickNos : new Set(takenPickNos)
  for (let pick = 1; pick <= total; pick += 1) {
    if (!taken.has(pick)) return pick
  }
  return Math.max(total, 1)
}

export function isDraftOver(
  picksMade: number,
  teams: number,
  rounds: number,
): boolean {
  return picksMade >= teams * rounds
}

/** Picks remaining until `yourSlot` is on the clock (0 = on the clock now). */
export function picksUntilSlot(
  currentPickNo: number,
  yourSlot: number,
  teams: number,
  rounds: number,
  type: DraftType,
  takenPickNos?: Iterable<number>,
  owners?: PickOwners,
): number | null {
  if (type === 'auction') return null
  const total = teams * rounds
  const taken =
    takenPickNos === undefined
      ? null
      : takenPickNos instanceof Set
        ? takenPickNos
        : new Set(takenPickNos)
  let waiting = 0
  for (let pick = currentPickNo; pick <= total; pick += 1) {
    // Keeper-consumed slots never come on the clock, so they are not a wait.
    if (taken?.has(pick)) continue
    const { slot } = ownerSlotForPick(pick, teams, type, owners)
    if (slot === yourSlot) return waiting
    waiting += 1
  }
  return null
}

/**
 * The next pick number `yourSlot` actually owns, skipping slots keepers took.
 *
 * Distinct from `picksUntilSlot`, which counts how many picks happen first --
 * with keepers on the board the two are no longer the same number, so callers
 * that need "your next pick is 21" must not add the count to the current pick.
 */
export function nextPickNumberForSlot(
  currentPickNo: number,
  yourSlot: number,
  teams: number,
  rounds: number,
  type: DraftType,
  takenPickNos?: Iterable<number>,
  owners?: PickOwners,
): number | null {
  if (type === 'auction') return null
  const total = teams * rounds
  const taken =
    takenPickNos === undefined
      ? null
      : takenPickNos instanceof Set
        ? takenPickNos
        : new Set(takenPickNos)
  for (let pick = currentPickNo; pick <= total; pick += 1) {
    if (taken?.has(pick)) continue
    if (ownerSlotForPick(pick, teams, type, owners).slot === yourSlot) return pick
  }
  return null
}

/** The inverse of `ownerSlotForPick`: which pick a slot owns in a given round. */
export function pickNumberFor(
  round: number,
  slot: number,
  teams: number,
  type: DraftType,
  owners?: PickOwners,
): number {
  const start = (round - 1) * teams
  if (owners) {
    // Scan the round the caller asked for rather than assuming its direction.
    for (let offset = 0; offset < teams; offset += 1) {
      if (publishedSlot(owners, start + offset + 1) === slot) return start + offset + 1
    }
  }
  if (type === 'snake' && round % 2 === 0) {
    return start + (teams - slot + 1)
  }
  return start + slot
}
