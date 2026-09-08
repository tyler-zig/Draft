/**
 * Availability: how much of a season a player is actually likely to be on the
 * field, and what that is worth on a draft board.
 *
 * The engine's base value is `vorp * 3`, and VORP comes from a consensus
 * season projection -- a figure computed as if every player takes all 17
 * games. That assumption is invisible in the number, so the board priced a
 * back who has missed 26 games in three years exactly like one who has missed
 * none, and the only injury term in the engine keyed on `injuryStatus`, a
 * designation that is empty for everyone healthy in September. The player
 * whose risk is a pattern rather than a current designation was the one case
 * the board could not see at all.
 *
 * Two separate things are modeled here, because they are separate claims:
 *
 *   - `projectedAvailability`, from games actually missed. Backward-looking
 *     evidence about a specific player.
 *   - `ageDecline`, from the position's aging curve. A forward-looking claim
 *     about a cohort, which applies to a player with a spotless injury record
 *     just the same.
 *
 * Both are returned as fractions of the player's own base value rather than
 * flat point totals: a 12% haircut means the same thing on a first-round back
 * and a twelfth-round one, where a flat -30 would be a rounding error on the
 * first and disqualifying on the second.
 */

/** Seasons of history to read, most recent first. */
export const WINDOW = 3

/**
 * Recency weights across that window. A back who missed nine games two years
 * ago and none since is telling you something different from one who missed
 * nine last year, and an unweighted rate cannot say which is which.
 */
const RECENCY_WEIGHTS = [3, 2, 1]

/**
 * League-wide share of games missed by a rostered skill player. Everything
 * below is expressed relative to this, so a leaguemate-average player scores
 * zero adjustment and only real deviation moves a board.
 */
export const BASELINE_MISS_RATE = 0.11

/**
 * Strength of the prior, in weighted-game equivalents. One 17-game season is
 * 51 weighted games at the top of the window, so a prior of 24 lets a single
 * healthy or lost season move the estimate without letting it decide the
 * matter -- which is the honest reading of one season of injury data.
 */
const PRIOR_WEIGHT = 24

/**
 * How much of a player's deviation from baseline repeats next season.
 *
 * Games missed predicts games missed, but far more weakly than the raw rate
 * suggests: most of an injury history is variance that does not recur, and
 * regressing only via the prior above would still carry a torn ACL forward at
 * full strength forever. Half is the defensible reading of the effect; it is
 * deliberately not 1.
 */
const CARRYOVER = 0.55

/**
 * Chopped dies on a single empty week, so availability is worth more there.
 * Applied only to the availability term -- aging is the same claim in every
 * format.
 */
export const CHOPPED_AVAILABILITY_MULTIPLIER = 1.6

export interface SeasonDurability {
  season: number
  gamesPlayed: number
  gamesMissed: number
}

export interface AvailabilityEstimate {
  /** Modeled share of the season he plays, already regressed and damped. */
  projectedAvailability: number
  /** Games missed over the window -- the raw evidence, for display. */
  gamesMissed: number
  /** Seasons of history the estimate rests on. */
  seasons: number
  /** nflverse ids from the same shard row; used to fill a blank ESPN/Sleeper id. */
  espnId?: string | null
  sleeperId?: string | null
  gsisId?: string | null
}

/**
 * Parses the flat `[season, played, missed, ...]` triples carried in the
 * intelligence shard index. Anything malformed is dropped rather than
 * defaulted, so a bad row cannot read as a clean season.
 */
export function seasonsFromTriples(triples: readonly number[] | null | undefined): SeasonDurability[] {
  if (!triples?.length) return []
  const seasons: SeasonDurability[] = []
  for (let i = 0; i + 2 < triples.length; i += 3) {
    const season = triples[i]!
    const gamesPlayed = triples[i + 1]!
    const gamesMissed = triples[i + 2]!
    if (![season, gamesPlayed, gamesMissed].every((value) => Number.isFinite(value))) continue
    if (gamesPlayed < 0 || gamesMissed < 0 || gamesPlayed + gamesMissed === 0) continue
    seasons.push({ season, gamesPlayed, gamesMissed })
  }
  return seasons.sort((a, b) => b.season - a.season).slice(0, WINDOW)
}

/**
 * Projected share of the season a player is available, from his recent record.
 *
 * Shrinks the observed miss rate toward the league baseline by sample size,
 * then damps what is left by `CARRYOVER`. Null with no seasons on record --
 * a rookie has no durability evidence, and inventing an average one for him
 * would state a fact we do not have.
 */
export function estimateAvailability(seasons: SeasonDurability[]): AvailabilityEstimate | null {
  if (!seasons.length) return null
  let weightedMissed = 0
  let weightedGames = 0
  let missed = 0
  seasons.slice(0, WINDOW).forEach((season, index) => {
    const weight = RECENCY_WEIGHTS[index] ?? 1
    weightedMissed += weight * season.gamesMissed
    weightedGames += weight * (season.gamesPlayed + season.gamesMissed)
    missed += season.gamesMissed
  })
  if (weightedGames <= 0) return null
  const shrunk = (weightedMissed + PRIOR_WEIGHT * BASELINE_MISS_RATE) / (weightedGames + PRIOR_WEIGHT)
  const projectedMiss = BASELINE_MISS_RATE + (shrunk - BASELINE_MISS_RATE) * CARRYOVER
  return {
    projectedAvailability: Math.min(1, Math.max(0, 1 - projectedMiss)),
    gamesMissed: missed,
    seasons: Math.min(seasons.length, WINDOW),
  }
}

/**
 * Age at which a position's production starts falling, and how fast per year.
 *
 * Running backs are the steep case and the reason this exists: the workload
 * that makes a back valuable is the same workload that ends his peak early.
 * Quarterbacks barely decline inside a redraft horizon, so their curve is
 * nearly flat rather than absent -- a 39-year-old is still a real risk.
 */
const AGE_CURVES: Record<string, { cliff: number; perYear: number; max: number }> = {
  RB: { cliff: 27, perYear: 0.055, max: 0.28 },
  WR: { cliff: 29, perYear: 0.038, max: 0.22 },
  TE: { cliff: 30, perYear: 0.034, max: 0.20 },
  QB: { cliff: 35, perYear: 0.030, max: 0.18 },
}

/**
 * Fraction of base value to remove for age: 0 for a player at or under his
 * position's cliff, and for positions with no curve (K, DEF, and anyone whose
 * age no source publishes).
 */
export function ageDecline(position: string, age: number | null | undefined): number {
  if (age == null || !Number.isFinite(age)) return 0
  const curve = AGE_CURVES[position]
  if (!curve || age <= curve.cliff) return 0
  return Math.min(curve.max, (age - curve.cliff) * curve.perYear)
}

export interface AvailabilityTerm {
  label: string
  delta: number
  reason: string | null
}

/**
 * The score terms for one player: an availability discount measured against a
 * league-average season, and an age discount against his position's curve.
 *
 * `baseValue` is the player's own pre-adjustment score, so both terms scale
 * with what is actually at stake. A negative or zero base yields nothing --
 * discounting a player who is already worthless is not a judgment worth
 * printing in a breakdown.
 */
export function availabilityTerms(options: {
  position: string
  age?: number | null
  availability?: AvailabilityEstimate | null
  baseValue: number
  chopped?: boolean
}): AvailabilityTerm[] {
  const { position, age, availability, baseValue, chopped = false } = options
  if (!(baseValue > 0)) return []
  const terms: AvailabilityTerm[] = []

  if (availability) {
    const baseline = 1 - BASELINE_MISS_RATE
    const edge = (availability.projectedAvailability - baseline) / baseline
    const delta = edge * baseValue * (chopped ? CHOPPED_AVAILABILITY_MULTIPLIER : 1)
    if (Math.abs(delta) >= 1) {
      const share = `${Math.round(availability.projectedAvailability * 100)}% projected availability`
      const span = `${availability.seasons} season${availability.seasons === 1 ? '' : 's'}`
      // Only the discount gets a `reason`. Reasons are what the board says out
      // loud about a pick, and "he has been healthy" is not why you are taking
      // someone -- surfacing it would push the reason that actually decided
      // the pick out of the headline for most of the pool. The bonus still
      // scores, and still shows its own line in the breakdown.
      terms.push(delta < 0
        ? {
            label: 'Injury history',
            delta,
            reason: `${availability.gamesMissed} games missed in ${span} - ${share}`,
          }
        : { label: `Durable (${share})`, delta, reason: null })
    }
  }

  const decline = ageDecline(position, age)
  if (decline > 0) {
    terms.push({
      label: 'Age curve',
      delta: -decline * baseValue,
      reason: `Age ${age} ${position}`,
    })
  }

  return terms
}
