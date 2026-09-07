import type { Player, SlotCounts } from '../providers/types'
import { EMPTY_SLOTS } from '../providers/types'

const FLEX_ELIGIBLE = new Set(['RB', 'WR', 'TE'])
const SUPER_FLEX_ELIGIBLE = new Set(['QB', 'RB', 'WR', 'TE'])

export type RosterSlotKey = keyof SlotCounts

export interface FilledSlot {
  key: RosterSlotKey
  label: string
  player: Player | null
}

export type NeedKind = 'starter' | 'flex' | 'superflex' | 'bench'

export interface PositionNeed {
  kind: NeedKind
  label: string
}

export function emptySlotCounts(): SlotCounts {
  return { ...EMPTY_SLOTS }
}

export function slotsFromRosterPositions(positions: string[]): SlotCounts {
  const counts = emptySlotCounts()
  for (const raw of positions) {
    const key = normalizeSlot(raw)
    if (!key) continue
    counts[key] += 1
  }
  return counts
}

export function slotsFromSettings(settings: {
  slots_qb?: number
  slots_rb?: number
  slots_wr?: number
  slots_te?: number
  slots_k?: number
  slots_flex?: number
  slots_super_flex?: number
  slots_def?: number
  slots_bn?: number
}): SlotCounts {
  return {
    QB: settings.slots_qb ?? 0,
    RB: settings.slots_rb ?? 0,
    WR: settings.slots_wr ?? 0,
    TE: settings.slots_te ?? 0,
    FLEX: settings.slots_flex ?? 0,
    SUPER_FLEX: settings.slots_super_flex ?? 0,
    K: settings.slots_k ?? 0,
    DEF: settings.slots_def ?? 0,
    BN: settings.slots_bn ?? 0,
  }
}

export function normalizeSlot(raw: string): RosterSlotKey | null {
  const p = raw.toUpperCase()
  if (p === 'DST' || p === 'D/ST' || p === 'DEF') return 'DEF'
  if (p === 'PK' || p === 'K') return 'K'
  if (p === 'SUPER_FLEX' || p === 'SUPERFLEX' || p === 'Q/W/R/T') {
    return 'SUPER_FLEX'
  }
  if (
    p === 'FLEX' ||
    p === 'REC_FLEX' ||
    p === 'WRRB_FLEX' ||
    p === 'W/R/T' ||
    p === 'W/R' ||
    p === 'W/T'
  ) {
    return 'FLEX'
  }
  // IR / taxi are reserve slots. Nobody drafts into them; counting them as
  // bench made a chopped league with 2 IR look like it had two extra rounds.
  if (p === 'IR' || p === 'TAXI' || p === 'TAXI_SQUAD' || p === 'RESERVE') return null
  if (p === 'BN' || p === 'BENCH') return 'BN'
  if (p === 'QB' || p === 'RB' || p === 'WR' || p === 'TE') return p
  return 'BN'
}

function takeFirst(
  remaining: Player[],
  pred: (player: Player) => boolean,
): Player | null {
  const index = remaining.findIndex(pred)
  if (index < 0) return null
  const [player] = remaining.splice(index, 1)
  return player ?? null
}

const FILL_ORDER: Array<{
  key: RosterSlotKey
  pred: (player: Player) => boolean
}> = [
  { key: 'QB', pred: (p) => p.position === 'QB' },
  { key: 'RB', pred: (p) => p.position === 'RB' },
  { key: 'WR', pred: (p) => p.position === 'WR' },
  { key: 'TE', pred: (p) => p.position === 'TE' },
  { key: 'K', pred: (p) => p.position === 'K' },
  { key: 'DEF', pred: (p) => p.position === 'DEF' },
  { key: 'FLEX', pred: (p) => FLEX_ELIGIBLE.has(p.position) },
  { key: 'SUPER_FLEX', pred: (p) => SUPER_FLEX_ELIGIBLE.has(p.position) },
  { key: 'BN', pred: () => true },
]

export function fillRoster(slots: SlotCounts, players: Player[]): FilledSlot[] {
  const remaining = [...players]
  const filled: FilledSlot[] = []

  for (const { key, pred } of FILL_ORDER) {
    const count = slots[key]
    for (let i = 0; i < count; i += 1) {
      const ordinal = count > 1 ? `${key}${i + 1}` : key
      filled.push({
        key,
        label: key === 'SUPER_FLEX' ? (count > 1 ? `SF ${i + 1}` : 'SF') : ordinal,
        player: takeFirst(remaining, pred),
      })
    }
  }

  return filled
}

export function needForPosition(
  slots: SlotCounts,
  filled: FilledSlot[],
  position: string,
): PositionNeed {
  if (position in slots && position !== 'FLEX' && position !== 'SUPER_FLEX' && position !== 'BN') {
    const key = position as RosterSlotKey
    const total = slots[key]
    const taken = filled.filter((s) => s.key === key && s.player).length
    if (taken < total) {
      const label = total > 1 ? `Fill ${key}${taken + 1}` : `Fill ${key}`
      return { kind: 'starter', label }
    }
  }

  if (FLEX_ELIGIBLE.has(position) && filled.some((s) => s.key === 'FLEX' && !s.player)) {
    return { kind: 'flex', label: 'Fill FLEX' }
  }

  if (
    SUPER_FLEX_ELIGIBLE.has(position) &&
    filled.some((s) => s.key === 'SUPER_FLEX' && !s.player)
  ) {
    return { kind: 'superflex', label: 'Fill Superflex' }
  }

  return { kind: 'bench', label: 'Best available' }
}

export function isFlexEligible(position: string): boolean {
  return FLEX_ELIGIBLE.has(position)
}
