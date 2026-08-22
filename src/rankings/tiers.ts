import type { Player } from '../providers/types'

const UNRANKED = 9999
const FALLBACK_GAP = 2

function spreadWidth(player: Pick<TierInput, 'rankLow' | 'rankHigh'>) {
  if (player.rankLow == null || player.rankHigh == null) return 0
  return Math.max(0, player.rankHigh - player.rankLow)
}

interface TierInput {
  id: string
  position: string
  rank: number
  /** Expert-spread bounds from `applyConsensusRanks`, when more than one source is enabled. */
  rankLow: number | null
  rankHigh: number | null
}

/**
 * Groups each position's ranked players into tiers.
 *
 * Two adjacent players belong to the same tier when the evidence doesn't
 * support a clean line between them:
 *
 * - With expert-spread data (`rankLow`/`rankHigh` from two or more enabled
 *   sources, and a real width), that's whenever their rank ranges overlap --
 *   some expert ranked the second player at or above where another expert
 *   ranked the first, so the "gap" is just disagreement, not a real tier break.
 *   A point estimate (`5–5`) is not spread.
 * - Without spread data (one source, or none), it falls back to a gap
 *   threshold that adapts to the current tier's own rank density, so a tight
 *   cluster at picks 1-12 and a sparse one at picks 200+ don't use the same
 *   absolute cutoff.
 *
 * Tiers are numbered 1..N within each position; unranked players get no tier.
 */
export function assignTiers(inputs: TierInput[]): Map<string, number> {
  const byPosition = new Map<string, TierInput[]>()
  for (const input of inputs) {
    if (input.rank <= 0 || input.rank >= UNRANKED) continue
    const list = byPosition.get(input.position) ?? []
    list.push(input)
    byPosition.set(input.position, list)
  }

  const tiers = new Map<string, number>()
  for (const list of byPosition.values()) {
    list.sort((a, b) => a.rank - b.rank)
    let tier = 1
    let tierGapSum = 0
    let tierGapCount = 0
    list.forEach((player, index) => {
      const prev = list[index - 1]
      if (prev) {
        const hasSpread = spreadWidth(prev) > 0 && spreadWidth(player) > 0
        const overlaps = hasSpread && prev.rankHigh! >= player.rankLow!
        const gap = player.rank - prev.rank
        const threshold = tierGapCount > 0 ? Math.max(FALLBACK_GAP, (tierGapSum / tierGapCount) * 1.6) : FALLBACK_GAP
        const sameTier = hasSpread ? overlaps : gap <= threshold
        if (!sameTier) {
          tier += 1
          tierGapSum = 0
          tierGapCount = 0
        } else {
          tierGapSum += gap
          tierGapCount += 1
        }
      }
      tiers.set(player.id, tier)
    })
  }
  return tiers
}

export function assignPlayerTiers(players: Player[]): Map<string, number> {
  return assignTiers(
    players.map((p) => ({
      id: p.id,
      position: p.position,
      rank: p.searchRank,
      rankLow: p.rankLow ?? null,
      rankHigh: p.rankHigh ?? null,
    })),
  )
}

/**
 * Display tier for a table row. A published or clustered `player.tier` wins;
 * otherwise fall back to the same overall-rank buckets the draft board uses.
 * Computed clusters are not capped — only this fallback is, so a missing
 * source does not invent Tier 20 from a deep overall rank.
 */
export function shownTier(player: Pick<Player, 'tier' | 'searchRank'>, fallback = 1) {
  if (player.tier != null) return player.tier
  const rank = player.searchRank > 0 ? player.searchRank : UNRANKED
  return Math.max(1, Math.min(6, Math.ceil((rank < 9000 ? rank : fallback) / 15)))
}

/** CSS only defines six pill colors; cycle so Tier 7 still has a color. */
export function tierColorClass(tier: number) {
  return `cc-tier-${((tier - 1) % 6) + 1}`
}
