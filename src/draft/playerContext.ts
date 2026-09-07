import type { DraftPick, Player, SlotCounts } from '../providers/types'
import { fillRoster, needForPosition, type PositionNeed } from './rosterNeeds'
import { draftSpread, survivalProbability } from './survival'

const UNRANKED = 9999

export type MarketBaselineSource = 'live ADP' | 'ADP'

function usableAdp(value: number | null | undefined): value is number {
  return value != null && value > 0 && value < 9000
}

/**
 * Where the market says a player goes, or null when no market says.
 *
 * Live ADP first: the hourly board is where players are actually going in
 * drafts happening right now, so it beats a preseason average fixed before
 * camp cuts, a holdout, or a Week 1 depth-chart move. Season ADP is the next
 * best thing.
 *
 * Rank is deliberately NOT a third fallback. A consensus or search rank is an
 * ordering, not a draft position, and standing one in produced a number that
 * looked like a market and was not -- every caller here compares this against
 * a pick number. Same rule `spreadFor` follows: null so the caller can say
 * "unknown" instead of guessing.
 */
export function marketBaseline(player: Player): { value: number; source: MarketBaselineSource } | null {
  if (usableAdp(player.liveAdp)) {
    return { value: player.liveAdp, source: 'live ADP' }
  }
  if (usableAdp(player.adp)) {
    return { value: player.adp, source: 'ADP' }
  }
  return null
}

/**
 * What the ESPN overlay prints next to a suggestion.
 *
 * Same fallback the rest of the app uses: live ADP when the hourly board
 * has him, season ADP when it does not, nothing that is only a rank. Value
 * vs the pick on the clock rides along so the row can show a steal or a
 * reach without the overlay redoing the math. VORP is included as a last
 * number when there is no market at all.
 */
export interface SuggestionGlance {
  team: string | null
  liveAdp: number | null
  adp: number | null
  vorp: number | null
  marketSource: MarketBaselineSource | null
  marketValue: number | null
  vsPick: number | null
}

export function suggestionGlance(player: Player, currentPickNo: number): SuggestionGlance {
  const baseline = marketBaseline(player)
  return {
    team: player.team,
    liveAdp: usableAdp(player.liveAdp) ? player.liveAdp : null,
    adp: usableAdp(player.adp) ? player.adp : null,
    vorp: player.vorp ?? null,
    marketSource: baseline?.source ?? null,
    marketValue: baseline?.value ?? null,
    vsPick: baseline ? Math.round(currentPickNo - baseline.value) : null,
  }
}

export interface TakenBy {
  pickNo: number
  round: number
  teamName: string
  isKeeper: boolean
}

export interface PlayerDraftContext {
  /** Set when the player is already off the board. */
  takenBy: TakenBy | null
  /** Where he sits among players at his position still on the board. */
  positionRank: number
  /** How many at his position are already gone. */
  positionDrafted: number
  /** Players left in his tier at his position, including him. */
  tierRemaining: number | null
  /** Whether he fills a hole on your roster right now. */
  need: PositionNeed
  /** Picks between the market's expectation and the pick on the clock. */
  valueVsPick: number | null
  baselineSource: MarketBaselineSource | null
  /** Your next turn, or null when you have no seat or the draft is done. */
  yourNextPickNo: number | null
  /**
   * Whether the market says he lasts until your next turn. Null when there is
   * nothing to compare -- no seat, no ranking, or you are on the clock now.
   */
  lastsUntilYourPick: boolean | null
  /**
   * Modeled probability he is still available at your next turn, from his
   * market baseline and real expert-disagreement spread (never a fabricated
   * one -- see `spreadFor`). Null when there's nothing to compare, or when no
   * source gives us a spread to model with.
   */
  survivalProbability: number | null
}

/**
 * What the draft itself says about one player.
 *
 * The Draft Room already knows all of this -- it just never reached the player
 * modal, which showed career stats without a word about whether to take him.
 */
export function playerDraftContext(options: {
  player: Player
  players: Player[]
  picks: DraftPick[]
  slots: SlotCounts
  yourSlot: number | null
  currentPickNo: number
  yourNextPickNo: number | null
  /** Draft slot -> team name, so a drafted player can name his new team. */
  teamNameBySlot?: Map<number, string>
}): PlayerDraftContext {
  const { player, players, picks, slots, yourSlot, currentPickNo, yourNextPickNo, teamNameBySlot } = options
  const taken = new Set(picks.map((pick) => pick.playerId))
  const rankOf = (item: Player) => (item.searchRank > 0 ? item.searchRank : UNRANKED)
  const samePosition = players.filter((item) => item.position === player.position)
  const available = samePosition
    .filter((item) => !taken.has(item.id))
    .sort((a, b) => rankOf(a) - rankOf(b))

  const positionRank = Math.max(1, available.findIndex((item) => item.id === player.id) + 1)
  const positionDrafted = samePosition.length - available.length
  const tierRemaining =
    player.tier == null
      ? null
      : available.filter((item) => item.tier === player.tier).length

  const yourPlayers = picks
    .filter((pick) => pick.draftSlot === yourSlot)
    .map((pick) => players.find((item) => item.id === pick.playerId))
    .filter((item): item is Player => Boolean(item))
  const need = needForPosition(slots, fillRoster(slots, yourPlayers), player.position)

  const baseline = marketBaseline(player)
  const valueVsPick = baseline ? Math.round(currentPickNo - baseline.value) : null
  const spread = draftSpread(player, baseline?.value)
  const survival =
    baseline == null || spread == null || yourNextPickNo == null || yourNextPickNo <= currentPickNo
      ? null
      : survivalProbability(baseline.value, spread, yourNextPickNo)
  const lastsUntilYourPick =
    yourNextPickNo == null || yourNextPickNo <= currentPickNo
      ? null
      : survival != null
        ? survival >= 0.5
        : baseline != null
          ? baseline.value > yourNextPickNo
          : null

  const takenPick = picks.find((pick) => pick.playerId === player.id)
  const takenBy: TakenBy | null = takenPick
    ? {
        pickNo: takenPick.pickNo,
        round: takenPick.round,
        teamName: teamNameBySlot?.get(takenPick.draftSlot) ?? `Slot ${takenPick.draftSlot}`,
        isKeeper: takenPick.isKeeper,
      }
    : null

  return {
    takenBy,
    positionRank,
    positionDrafted,
    tierRemaining,
    need,
    valueVsPick,
    baselineSource: baseline?.source ?? null,
    yourNextPickNo,
    lastsUntilYourPick,
    survivalProbability: survival,
  }
}
