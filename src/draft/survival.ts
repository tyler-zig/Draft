/** Standard normal CDF via the Abramowitz-Stegun erf approximation (max error ~1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const t = 1 / (1 + p * ax)
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax)
  return sign * y
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

/**
 * Spread for a player's draft position, from real expert disagreement --
 * never fabricated. Prefers FantasyPros's own per-player rank std-dev; falls
 * back to the enabled sources' best/worst range (divided by 4, the usual
 * range-to-std-dev rule of thumb for a roughly normal small sample). Null
 * when neither exists, so the caller can say "unknown" instead of guessing.
 */
export function spreadFor(player: {
  rankStdDev?: number | null
  rankLow?: number | null
  rankHigh?: number | null
}): number | null {
  if (player.rankStdDev != null && player.rankStdDev > 0) return player.rankStdDev
  if (player.rankLow != null && player.rankHigh != null && player.rankHigh > player.rankLow) {
    return (player.rankHigh - player.rankLow) / 4
  }
  return null
}

/**
 * Coarse prior when no expert range is published. ~12% of ADP, clamped so
 * early picks are not treated as locks and late ones are not a coin flip.
 */
export function defaultSpread(mean: number): number {
  if (!(mean > 0)) return 8
  return Math.max(6, Math.min(18, mean * 0.12))
}

/** Expert spread when we have one; otherwise the ADP prior. */
export function draftSpread(
  player: {
    rankStdDev?: number | null
    rankLow?: number | null
    rankHigh?: number | null
  },
  mean?: number | null,
): number | null {
  const expert = spreadFor(player)
  if (expert != null) return expert
  if (mean != null && mean > 0) return defaultSpread(mean)
  return null
}

/**
 * Standard normal sample via Box-Muller, for simulating how far a CPU picker
 * strays from the board. `rng` is injected so tests can pin the outcome; each
 * call consumes two uniforms, and values at 0 or 1 are clamped so Math.log
 * cannot return -Infinity or 0.
 */
export function sampleNormal(rng: () => number = Math.random): number {
  const u1 = Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, rng()))
  const u2 = Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, rng()))
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function survivePast(mean: number, stdDev: number, pickNo: number): number {
  if (stdDev <= 0) return pickNo <= mean ? 1 : 0
  const z = (pickNo - mean) / stdDev
  return Math.min(1, Math.max(0, 1 - normalCdf(z)))
}

/**
 * Probability a player drafted from Normal(mean, stdDev) is still available
 * at `nextPickNo`. When `availableAt` is set, this is conditional on him
 * already being on the board there -- unconditional P(slot >= next) is ~0
 * for anyone who has fallen past ADP, which printed "80% gone" on
 * back-to-back picks.
 */
export function survivalProbability(
  mean: number,
  stdDev: number,
  nextPickNo: number,
  availableAt?: number | null,
): number {
  if (availableAt != null && nextPickNo <= availableAt) return 1
  const surviveTo = survivePast(mean, stdDev, nextPickNo)
  if (availableAt == null) return surviveTo
  const gap = nextPickNo - availableAt
  // Back-to-back (or one intervening pick): the next team takes one player.
  // Unconditional ADP already expired, so the old CDF printed 80% gone.
  if (gap <= 1) return 1
  const alreadyHere = survivePast(mean, stdDev, availableAt)
  const pastAdp = (availableAt - mean) / Math.max(stdDev, 1)
  if (alreadyHere <= 1e-3 || pastAdp >= 2.5) {
    return Math.exp(-gap / Math.max(stdDev, 6))
  }
  return Math.min(1, surviveTo / alreadyHere)
}

/**
 * Score nudge for the current pick: take someone who will be gone, wait on
 * someone who will still be there. Continuous so a slightly worse player who
 * will not last can beat a better one you can get later, without flipping a
 * large value gap.
 */
export function survivalAdjustment(survival: number): { delta: number; reason: string | null } {
  const urgency = 1 - survival
  let delta = urgency * 40
  if (survival >= 0.65) delta -= (survival - 0.5) * 30
  return {
    delta,
    reason: urgency > 0.5 ? `${Math.round(urgency * 100)}% gone by next pick` : null,
  }
}

/**
 * Score for a pick you have not reached yet: expected value you can
 * actually capture. A higher-VORP player who will be gone is not the
 * best available at your seat.
 */
export function waitSurvivalAdjustment(
  survival: number,
  baseValue: number,
): { delta: number; reason: string | null } {
  const gone = 1 - survival
  return {
    delta: -gone * Math.max(0, baseValue) * 0.9,
    reason: gone > 0.5
      ? `${Math.round(gone * 100)}% gone by your pick`
      : survival >= 0.7
        ? 'Likely there at your pick'
        : null,
  }
}
