import type { DraftPick, DraftSlot, DraftType, Player, SlotCounts } from '../providers/types'
import { fillRoster } from '../draft/rosterNeeds'
import { pickNumberFor, type PickOwners } from '../draft/snake'

const NEED_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
const SUMMARY_KEYS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF', 'BN'] as const

export interface OverlayRosterSlot {
  key: string
  label: string
  name: string | null
  position: string | null
  team: string | null
  playerId: string | null
}

export interface OverlayNeed {
  position: string
  filled: number
  total: number
  open: number
  /** Same high / med / low the Draft Room uses for starter vs flex vs filled. */
  tone: 'high' | 'med' | 'low'
}

export interface OverlaySummary {
  key: string
  label: string
  filled: number
  total: number
  open: number
}

export interface OverlayBoardTeam {
  slot: number
  name: string
  abbrev: string
  you: boolean
}

export interface OverlayBoardCell {
  round: number
  slot: number
  pickNo: number
  name: string | null
  last: string | null
  position: string | null
  team: string | null
  playerId: string | null
  current: boolean
  yours: boolean
  keeper: boolean
}

export interface OverlayBoard {
  teams: OverlayBoardTeam[]
  rounds: number
  currentPickNo: number
  cells: OverlayBoardCell[]
}

export interface OverlayRoom {
  roster: OverlayRosterSlot[]
  drafted: number
  needs: OverlayNeed[]
  summary: OverlaySummary[]
  board: OverlayBoard
}

/**
 * Roster fill and draft-board cells for the ESPN overlay.
 *
 * Same `fillRoster` / snake math the Draft Room uses, flattened so the
 * overlay can paint without importing React or the session object.
 */
export function overlayRoom(options: {
  players: Player[]
  picks: DraftPick[]
  slots: SlotCounts
  yourSlot: number | null
  order: DraftSlot[]
  teams: number
  rounds: number
  type: DraftType
  pickOwners?: PickOwners
  currentPickNo: number
}): OverlayRoom {
  const {
    players,
    picks,
    slots,
    yourSlot,
    order,
    teams,
    rounds,
    type,
    pickOwners,
    currentPickNo,
  } = options
  const playerById = new Map(players.map((player) => [player.id, player]))
  const yourPlayers = picks
    .filter((pick) => pick.draftSlot === yourSlot)
    .map((pick) => playerById.get(pick.playerId))
    .filter((player): player is Player => Boolean(player))
  const filled = fillRoster(slots, yourPlayers)
  const roster: OverlayRosterSlot[] = filled.map((slot) => ({
    key: slot.key,
    label: slot.label,
    name: slot.player?.fullName ?? null,
    position: slot.player?.position ?? null,
    team: slot.player?.team ?? null,
    playerId: slot.player?.id ?? null,
  }))
  const drafted = roster.filter((slot) => slot.playerId).length
  const openFlex = filled.some((slot) => slot.key === 'FLEX' && !slot.player)

  const needs: OverlayNeed[] = NEED_POSITIONS
    .filter((position) => slots[position] > 0)
    .map((position) => {
      const total = slots[position]
      const taken = filled.filter((slot) => slot.key === position && slot.player).length
      const flexHelp = (position === 'RB' || position === 'WR' || position === 'TE') && openFlex
      return {
        position,
        filled: taken,
        total,
        open: Math.max(0, total - taken),
        tone: taken < total ? 'high' : flexHelp ? 'med' : 'low',
      }
    })

  const summary: OverlaySummary[] = SUMMARY_KEYS
    .filter((key) => slots[key] > 0)
    .map((key) => {
      const total = slots[key]
      const taken = filled.filter((slot) => slot.key === key && slot.player).length
      return {
        key,
        label: key === 'SUPER_FLEX' ? 'SF' : key,
        filled: taken,
        total,
        open: Math.max(0, total - taken),
      }
    })

  const byRoundSlot = new Map<string, DraftPick>()
  for (const pick of picks) {
    if (pick.pickNo < 1) continue
    byRoundSlot.set(`${pick.round}-${pick.draftSlot}`, pick)
  }

  const boardTeams: OverlayBoardTeam[] = order.map((slot) => ({
    slot: slot.slot,
    name: slot.teamName || slot.displayName,
    abbrev: teamAbbrev(slot.teamName || slot.displayName, slot.slot),
    you: slot.isYou,
  }))

  const cells: OverlayBoardCell[] = []
  for (let round = 1; round <= rounds; round += 1) {
    for (const slot of order) {
      const pickNo = pickNumberFor(round, slot.slot, teams, type, pickOwners)
      const pick = byRoundSlot.get(`${round}-${slot.slot}`)
        ?? picks.find((entry) => entry.pickNo === pickNo)
      const player = pick ? playerById.get(pick.playerId) : undefined
      cells.push({
        round,
        slot: slot.slot,
        pickNo,
        name: displayName(player, pick),
        last: lastName(player, pick),
        position: player?.position ?? pick?.meta?.position ?? null,
        team: player?.team ?? pick?.meta?.team ?? null,
        playerId: player?.id ?? pick?.playerId ?? null,
        current: !pick && pickNo === currentPickNo,
        yours: slot.slot === yourSlot,
        keeper: Boolean(pick?.isKeeper),
      })
    }
  }

  return {
    roster,
    drafted,
    needs,
    summary,
    board: { teams: boardTeams, rounds, currentPickNo, cells },
  }
}

function teamAbbrev(name: string, slot: number): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    const initials = `${words[0]![0] ?? ''}${words[words.length - 1]![0] ?? ''}`.toUpperCase()
    if (initials.length === 2) return initials
  }
  const compact = name.replace(/[^A-Za-z0-9]/g, '')
  return (compact.slice(0, 3) || `T${slot}`).toUpperCase()
}

function displayName(player: Player | undefined, pick: DraftPick | undefined): string | null {
  if (player?.fullName) return player.fullName
  if (!pick?.meta) return null
  const combined = `${pick.meta.firstName} ${pick.meta.lastName}`.trim()
  return combined || null
}

function lastName(player: Player | undefined, pick: DraftPick | undefined): string | null {
  if (player?.lastName) return player.lastName
  if (pick?.meta?.lastName) return pick.meta.lastName
  const full = displayName(player, pick)
  if (!full) return null
  return full.split(/\s+/).filter(Boolean).slice(-1)[0] ?? full
}
