import type { DraftPick, LeagueFormat, Player, SlotCounts } from '../providers/types'
import { availabilityTerms } from './availability'
import { positionConsistencyMedians } from './consistency'
import { choppedNeedScale, choppedTerms } from './chopped'
import { normalizeTeam } from '../rankings/normalize'
import { scoreByeFit } from './byeWeeks'
import { fillRoster, needForPosition } from './rosterNeeds'
import { isSevereInjury } from './injuryStatus'
import { marketBaseline } from './playerContext'
import { isUnsignedFreeAgent } from './freeAgents'
import { draftSpread, survivalAdjustment, survivalProbability, waitSurvivalAdjustment } from './survival'

export interface ScoreTerm {
  label: string
  delta: number
}

export interface Recommendation {
  player: Player
  score: number
  reason: string
  reasons: string[]
  /**
   * Every term that moved the score, in the order applied.
   *
   * `reasons` says what was noticed; this says what it was worth. Without it a
   * surprising suggestion can only be argued about -- which term won is not
   * recoverable from the total, and tuning this engine by description has a
   * poor record.
   */
  breakdown: ScoreTerm[]
  /** Modeled odds he's still there at your next turn; null with nothing to model. */
  survivalProbability: number | null
}

const UNRANKED = 9999

/**
 * Enough to clear any value gap the base score can produce, so that when the
 * remaining picks are all needed for starters, one always wins. Deliberately
 * outside the tuned range above: it settles the question rather than joining
 * the argument.
 *
 * Sized to the ceiling rather than picked for effect. A bench player's score
 * cannot realistically pass ~550 -- the base caps at `450 - rank` on the rank
 * fallback or `vorp * 3` (~405 on a real board), and the bonuses below add at
 * most another hundred or so. Anything past that separates the two groups
 * completely, and since this adds the *same* constant to every eligible
 * player, ordering within them is untouched either way: a larger number buys
 * no extra certainty, it only swamps the score breakdown it appears in.
 */
const FORCED_STARTER = 600

/**
 * Positions the override does not apply to, and the bonus they get instead.
 *
 * Kicker and defense are the two most streamable slots in fantasy -- there is
 * always one on waivers, and a roster spot can be cleared for it after the
 * draft. Treating an empty K slot as exactly as binding as an empty QB slot
 * put a kicker above an elite back on the board, which is not a trade any
 * drafter would make. They get a bonus big enough to beat ordinary bench
 * fodder and lose to a genuinely better player, which is the real choice.
 */
const STREAMABLE_STARTERS = new Set(['K', 'DEF'])
const STREAMABLE_STARTER = 120

/**
 * Picks left over which the streamable exemption dissolves.
 *
 * Streaming a kicker costs a bench spot and a waiver claim, which is a fine
 * trade with rounds still to come and a bad one with nothing left to spend.
 * So the discount is not a fixed opinion about kickers -- it is an opinion
 * about having somewhere better to put the pick, and it fades as that stops
 * being true. On the final pick it reaches `FORCED_STARTER` exactly: there is
 * no longer anything to trade the slot for, so the exemption has nothing left
 * to justify it.
 */
const STREAMABLE_LAST_ROUNDS = 2

export function availablePlayers(
  players: Player[],
  picks: DraftPick[],
): Player[] {
  const taken = new Set(picks.map((p) => p.playerId))
  return players.filter((p) => !taken.has(p.id))
}

function rankOf(player: Player): number {
  return player.searchRank > 0 ? player.searchRank : UNRANKED
}

/** rank -> score, from the players we can actually price. */
interface ScoreCurve {
  ranks: number[]
  scores: number[]
}

/**
 * Puts players with no projection on the same scale as those that have one.
 *
 * `vorp * 3` and `450 - rank` were both in use, and they are not the same
 * scale: a TE worth 18 VORP scored 54 while an unprojected defense at rank 150
 * scored 300. Kickers, defenses, rookies and role-change players are exactly
 * the ones without a projection row, so they floated to the top of every board
 * and dragged the "fill that slot" bonus up with them.
 *
 * So rather than a second formula, this reads the first one's answer: take the
 * players who do have VORP, and ask what a player at this rank is typically
 * worth. A rolling median damps the noise of one over- or under-projected
 * player near the target rank.
 */
function buildScoreCurve(players: Player[]): ScoreCurve | null {
  const anchors = players
    .filter((p) => p.vorp != null && p.searchRank > 0 && p.searchRank < UNRANKED && !isUnsignedFreeAgent(p))
    .map((p) => ({ rank: p.searchRank, score: p.vorp! * 3 }))
    .sort((a, b) => a.rank - b.rank)
  // Any anchor at all is enough to keep one scale. A curve built from two
  // players is crude, but crude and consistent beats precise and incomparable
  // -- the failure this exists to prevent is an unprojected player being
  // scored on a different, larger scale than a projected one.
  if (anchors.length === 0) return null

  const WINDOW = 5
  const ranks: number[] = []
  const scores: number[] = []
  for (let index = 0; index < anchors.length; index += 1) {
    const from = Math.max(0, index - Math.floor(WINDOW / 2))
    const window = anchors.slice(from, from + WINDOW).map((a) => a.score).sort((a, b) => a - b)
    ranks.push(anchors[index]!.rank)
    scores.push(window[Math.floor(window.length / 2)]!)
  }
  return { ranks, scores }
}

function scoreAtRank(rank: number, curve: ScoreCurve): number {
  const { ranks, scores } = curve
  if (rank <= ranks[0]!) return scores[0]!
  if (rank >= ranks[ranks.length - 1]!) return scores[scores.length - 1]!
  let low = 0
  let high = ranks.length - 1
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if (ranks[mid]! <= rank) low = mid
    else high = mid
  }
  const span = ranks[high]! - ranks[low]!
  if (span <= 0) return scores[low]!
  const t = (rank - ranks[low]!) / span
  return scores[low]! + t * (scores[high]! - scores[low]!)
}

/**
 * Base value for a player: VORP when we have it, and an estimate calibrated
 * against VORP when we do not -- never a second, larger scale.
 *
 * With no projections at all the curve is null and everyone falls back to rank
 * arithmetic together, which is self-consistent even though it is coarse.
 */
/**
 * FantasyPros Last 1 / Last 7 minus current live ADP. Positive means the
 * player is being drafted earlier than that window. Ignore 1-pick noise and
 * cap so a 20-pick riser cannot outrun VORP.
 */
export function liveAdpTrendAdjustment(player: Player): { delta: number; reason: string } | null {
  const oneDay = player.liveAdpVsLastOne
  const sevenDay = player.liveAdpVsLastSeven
  const vs = oneDay != null && Number.isFinite(oneDay) ? oneDay : sevenDay
  if (vs == null || !Number.isFinite(vs) || Math.abs(vs) < 2) return null
  const delta = Math.max(-18, Math.min(18, vs * 1.2))
  const window = oneDay != null && Number.isFinite(oneDay) ? '1 day' : '7 days'
  return {
    delta,
    reason: delta > 0 ? `Rising ADP vs last ${window}` : `Falling ADP vs last ${window}`,
  }
}

function baseScore(player: Player, curve: ScoreCurve | null): number {
  // No curve means nothing has a projection at all, so rank is the only scale
  // available and everyone is on it together.
  if (!curve) return Math.max(0, 450 - rankOf(player))
  if (player.vorp != null) return player.vorp * 3
  return scoreAtRank(rankOf(player), curve)
}


export function recommendPicks(options: {
  players: Player[]
  picks: DraftPick[]
  yourSlot: number | null
  slots: SlotCounts
  currentPickNo: number
  limit?: number
  queuedIds?: string[]
  /** Absolute pick number of your next turn. When that is still ahead, recs are who will be there then. */
  yourNextPickNo?: number | null
  /** The turn after `yourNextPickNo` -- on the clock, who will not last until then. */
  yourFollowingPickNo?: number | null
  leagueFormat?: LeagueFormat | null
  teams?: number
}): Recommendation[] {
  const {
    players,
    picks,
    yourSlot,
    slots,
    currentPickNo,
    limit = 5,
    queuedIds = [],
    yourNextPickNo = null,
    yourFollowingPickNo = null,
    leagueFormat = null,
    teams = 12,
  } = options
  const chopped = leagueFormat === 'chopped'
  const waiting = yourNextPickNo != null && yourNextPickNo > currentPickNo
  const horizonPickNo = waiting ? yourNextPickNo : currentPickNo
  const survivalAt = waiting
    ? yourNextPickNo
    : yourFollowingPickNo != null && yourFollowingPickNo > currentPickNo
      ? yourFollowingPickNo
      : null
  const queued = new Set(queuedIds)
  const pool = availablePlayers(players, picks).filter((player) => !isUnsignedFreeAgent(player))
  // Built from the whole pool, not just the available one, so the curve does
  // not shift under you as the draft empties the board.
  const scoreCurve = buildScoreCurve(players)
  // Built from the whole pool for the same reason the score curve is: a
  // positional median that shifted as the board emptied would re-rate players
  // who had not changed. Only chopped reads it, so only chopped pays for it.
  const consistencyMedians = chopped ? positionConsistencyMedians(players) : undefined
  const playerById = new Map(players.map((p) => [p.id, p]))

  const yourPicks = picks.filter((p) => p.draftSlot === yourSlot)
  const yourPlayers = yourPicks
    .map((p) => playerById.get(p.playerId))
    .filter((p): p is Player => Boolean(p))
  const filled = fillRoster(slots, yourPlayers)

  // Positional scarcity inside the next two rounds.
  //
  // Measured on rank, not the market: rank is the one scale every player is on,
  // and mixing "ADP where we have it, rank where we do not" into a single
  // threshold compares two different things and counts the pool inconsistently.
  // This is a relative "how many good ones are left" question, which an
  // ordering answers honestly -- unlike the value and reach tests below, which
  // are claims about pick numbers and so require a real market.
  const remainingByPos = new Map<string, number>()
  const eliteCutoff = horizonPickNo + 24
  for (const player of pool) {
    if (rankOf(player) <= eliteCutoff) {
      remainingByPos.set(
        player.position,
        (remainingByPos.get(player.position) ?? 0) + 1,
      )
    }
  }

  // How many available players share this player's position+tier -- 1 means
  // he's the last one left before the board drops to the next tier down.
  const tierGroupSize = new Map<string, number>()
  for (const player of pool) {
    if (player.tier == null) continue
    const key = `${player.position}:${player.tier}`
    tierGroupSize.set(key, (tierGroupSize.get(key) ?? 0) + 1)
  }

  // Position run: which positions dominate the most recent picks, across the
  // whole draft (not just your seat) -- the signal every drafter watches for
  // and reacts to before the position dries up further.
  const RUN_WINDOW = 8
  const recentPicks = [...picks].sort((a, b) => b.pickNo - a.pickNo).slice(0, RUN_WINDOW)
  const runningPositions = new Set<string>()
  if (recentPicks.length >= 4) {
    const byPos = new Map<string, number>()
    for (const pick of recentPicks) {
      const position = playerById.get(pick.playerId)?.position ?? pick.meta?.position
      if (!position) continue
      byPos.set(position, (byPos.get(position) ?? 0) + 1)
    }
    for (const [position, count] of byPos) {
      if (count / recentPicks.length >= 0.5) runningPositions.add(position)
    }
  }

  /**
   * How hard positional need should push, from 0 (plenty of picks to fill
   * everything) to 1 (every remaining pick has to be a starter).
   *
   * Need used to be a flat bonus, which is wrong at both ends of a draft. In
   * round 1 with fifteen picks ahead, an empty QB slot is not a reason to pass
   * on a better player -- there is abundant time to fill it. In the last two
   * rounds an empty starter slot is nearly the only thing that matters. One
   * number, the ratio of holes to picks left, says which situation you are in.
   */
  const rosterSpots = Object.values(slots).reduce((sum, count) => sum + count, 0)
  const picksLeft = Math.max(1, rosterSpots - yourPlayers.length)
  const openStarters = filled.filter((slot) => slot.key !== 'BN' && !slot.player).length
  const needScale = chopped
    ? choppedNeedScale(openStarters, picksLeft)
    : Math.min(1, openStarters / picksLeft)
  /**
   * Every remaining pick has to be a starter or a slot goes empty on Sunday.
   *
   * This is not a preference any more, so it is not expressed as one: scaling
   * a bonus still let a big enough value edge win, which on the last pick of a
   * draft means taking a fourth running back over the only quarterback. Below
   * this line need is a tiebreak; at it, it is the whole question.
   */
  const mustFillStarters = openStarters >= picksLeft
  /** 0 while there are picks to spare, 1 on the last one. */
  const streamableUrgency = Math.max(0, Math.min(1,
    (STREAMABLE_LAST_ROUNDS + 1 - picksLeft) / STREAMABLE_LAST_ROUNDS))
  const streamableBonus = STREAMABLE_STARTER
    + (FORCED_STARTER - STREAMABLE_STARTER) * streamableUrgency

  const byeRoster = filled.map((slot) => (
    slot.player
      ? { bye: slot.player.bye, position: slot.player.position, starter: slot.key !== 'BN' }
      : null
  ))

  // Handcuffs: rostered RBs (any position, really) whose direct backup --
  // same team, same position, a worse depth-chart slot -- is still on the
  // board. Sleeper publishes 0 for "unknown depth", so order must be > 0
  // to count as a real starter.
  const rosteredStarters = yourPlayers.filter((p) => p.depthChartOrder != null && p.depthChartOrder > 0 && p.team)

  // QB stack pairings: your own rostered pass-catchers, and your QB when you
  // have one. Best-ball tools lean hard on QB stacks; in redraft it is a mild
  // positive tilt, not a rule.
  const yourQb = yourPlayers.find((p) => p.position === 'QB') ?? null
  const yourPassCatchers = yourPlayers.filter((p) => p.position === 'WR' || p.position === 'TE')

  // Starters drafted by anyone but you. Your own starters already drive the
  // handcuff check above, so this set is what "his starter is already gone"
  // means for a backup still on the board. Keepers ride in via picks, so a
  // kept starter counts as drafted.
  const draftedStarters = picks
    .map((p) => playerById.get(p.playerId))
    .filter((p): p is Player => Boolean(p))
    .filter((p) => p.depthChartOrder != null && p.depthChartOrder > 0 && p.team
      && !yourPlayers.some((y) => y.id === p.id))

  const scored: Recommendation[] = pool.map((player) => {
    const rank = rankOf(player)
    // Null when no source publishes a draft position for him. Everything that
    // compares against a pick number below is skipped in that case rather than
    // substituting a rank and calling it a market.
    const baseline = marketBaseline(player)
    const need = needForPosition(slots, filled, player.position)
    const reasons: string[] = []
    const breakdown: ScoreTerm[] = []
    let score = baseScore(player, scoreCurve)
    breakdown.push({ label: player.vorp != null ? 'Projected value (VORP)' : 'Value estimated from rank', delta: score })
    const add = (label: string, delta: number) => {
      if (!delta) return
      score += delta
      breakdown.push({ label, delta })
    }

    // Availability and age come first, and are the only terms that discount
    // the projection rather than adding a preference to it. A season
    // projection is computed over 17 games; these two say how much of that
    // season the player is likely to be there for, and how much of his peak
    // he still has. Everything below prices a player against the field, so it
    // has to price the value he can actually deliver -- and because both
    // scale with his own base value, they stay comparable across rounds.
    for (const term of availabilityTerms({
      position: player.position,
      age: player.age,
      availability: player.availability,
      baseValue: score,
      chopped,
    })) {
      add(term.label, term.delta)
      if (term.reason) reasons.push(term.reason)
    }

    // Waiting: price who will still be there at your seat. On the clock:
    // take someone who will be gone before you pick again.
    let survival: number | null = null
    if (survivalAt != null && baseline) {
      const spread = draftSpread(player, baseline.value)
      if (spread != null) {
        survival = survivalProbability(baseline.value, spread, survivalAt, currentPickNo)
        // Risk-adjusted, not raw: what you can capture at a later pick is the
        // value this player is actually likely to deliver, so discounting the
        // 17-game projection first keeps the wait penalty proportional to it.
        const wait = waiting
          ? waitSurvivalAdjustment(survival, score)
          : survivalAdjustment(survival)
        add(wait.reason ?? (waiting ? 'May not last until your pick' : 'Unlikely to last'), wait.delta)
        if (wait.reason) reasons.push(wait.reason)
      }
    }

    // Scaled, and lower than it was: the old flat bonuses meant need plus the
    // two positional-pressure signals below could total ~130 while the whole
    // value signal was 22, so the board drafted to fill boxes rather than to
    // take the better player.
    if (need.kind === 'starter') {
      add(need.label, 55 * needScale)
      reasons.push(need.label)
    } else if (need.kind === 'flex') {
      add(need.label, 28 * needScale)
      reasons.push(need.label)
    } else if (need.kind === 'superflex') {
      add(need.label, 34 * needScale)
      reasons.push(need.label)
    }
    if (mustFillStarters && need.kind !== 'bench') {
      // Streamable only while the exemption still has a reason: on the last
      // pick the bonus has ramped to `FORCED_STARTER`, so it is billed as
      // what it has become rather than what it started as.
      const streamable = STREAMABLE_STARTERS.has(player.position) && streamableUrgency < 1
      add(
        streamable ? 'Last starter slot (streamable)' : 'Last chance to fill a starter',
        streamable ? streamableBonus : FORCED_STARTER,
      )
      // Pushed, not unshifted. This fires for every eligible player at once,
      // so leading with it made the headline identical across the whole board
      // at exactly the moment a drafter wants to know what separates them.
      reasons.push(streamable ? 'Last starter slot (streamable)' : 'Last chance to fill a starter')
    }

    if (baseline) {
      const valueGap = horizonPickNo - baseline.value
      if (valueGap >= 8) {
        add(`Value vs ${baseline.source}`, 22)
        reasons.push(`Value vs ${baseline.source}`)
      }
      const reachGap = baseline.value - horizonPickNo
      if (reachGap > 18) {
        add(`Reach vs ${baseline.source} ${baseline.value.toFixed(1)}`, -(reachGap - 18) * 1.4)
      }
      const trend = liveAdpTrendAdjustment(player)
      if (trend) {
        add(trend.reason, trend.delta)
        reasons.push(trend.reason)
      }
    } else if (rank < UNRANKED) {
      // No market to price him against. Say so rather than leaving a bare
      // "Best available", which reads as confidence we do not have.
      reasons.push('No ADP data')
    }

    // Scarcity and runs are positional pressure too, so they answer to the
    // same clock: worth acting on when you still have holes to fill, close to
    // noise when you do not.
    const remainingElite = remainingByPos.get(player.position) ?? 0
    if (need.kind !== 'bench' && remainingElite > 0 && remainingElite <= 3) {
      add(`${player.position} running thin`, 22 * needScale)
      reasons.push(`${player.position} running thin`)
    }

    if (player.tier != null && (tierGroupSize.get(`${player.position}:${player.tier}`) ?? 0) === 1) {
      add(`Last Tier ${player.tier} ${player.position}`, 32)
      reasons.push(`Last Tier ${player.tier} ${player.position}`)
    }

    if (need.kind !== 'bench' && runningPositions.has(player.position)) {
      add(`${player.position} run`, 12 * needScale)
      reasons.push(`${player.position} run`)
    }

    const byeFit = scoreByeFit({
      bye: player.bye,
      position: player.position,
      addingStarter: need.kind !== 'bench',
      roster: byeRoster,
    })
    add(byeFit.reason ?? 'Bye week fit', byeFit.delta)
    if (byeFit.reason) reasons.push(byeFit.reason)

    const handcuffFor = rosteredStarters.find(
      (starter) => starter.team === player.team && starter.position === player.position
        && player.depthChartOrder != null && player.depthChartOrder > 0
        && starter.depthChartOrder != null
        && player.depthChartOrder > starter.depthChartOrder,
    )
    if (handcuffFor) {
      add(`Handcuff for ${handcuffFor.fullName}`, 15)
      reasons.push(`Handcuff for ${handcuffFor.fullName}`)
    }

    // Backup whose starter is already gone: drafted by another team, so this
    // player is one injury away from the lead role. Mutually exclusive with
    // the handcuff check above by construction -- that one only fires on your
    // own starters, this set excludes them.
    if (player.team && player.depthChartOrder != null && player.depthChartOrder > 0) {
      const starterGone = draftedStarters.find(
        (starter) => starter.position === player.position
          && normalizeTeam(starter.team) === normalizeTeam(player.team)
          && starter.depthChartOrder != null
          && starter.depthChartOrder < player.depthChartOrder!,
      )
      if (starterGone) {
        add(`Starter ${starterGone.fullName} already drafted`, 10)
        reasons.push(`Starter ${starterGone.fullName} already drafted`)
      }
    }

    // QB stacks: a candidate QB whose top pass-catcher you already own, or a
    // pass-catcher who pairs with your rostered QB. Same-team upside, mild
    // positive. normalizeTeam so alias spellings (JAC/JAX) still pair.
    // Same-team upside is an H2H / best-ball tool. Chopped dies on a shared
    // early bye, so that bonus stays off and choppedTerms may penalize it.
    if (!chopped) {
      if (player.position === 'QB' && player.team) {
        const stackMate = yourPassCatchers.find(
          (p) => p.team && normalizeTeam(p.team) === normalizeTeam(player.team),
        )
        if (stackMate) {
          add(`Stack with ${stackMate.fullName}`, 12)
          reasons.push(`Stack with ${stackMate.fullName}`)
        }
      }
      if ((player.position === 'WR' || player.position === 'TE')
        && yourQb?.team && player.team
        && normalizeTeam(yourQb.team) === normalizeTeam(player.team)) {
        add(`QB stack with ${yourQb.fullName}`, 12)
        reasons.push(`QB stack with ${yourQb.fullName}`)
      }
    }

    // Standalone value: a backup worth drafting for his own projection
    // regardless of the handcuff angle. VORP >= 0 means the projection says
    // he outscores a replacement-level starter, which is the same judgment
    // call usage data would make, forward-looking and already in the pool.
    // Chopped benches get replaced by FAAB after the first chop, so this
    // is not a reason to take a backup over a safer starter.
    if (!chopped && player.depthChartOrder != null && player.depthChartOrder >= 2
      && player.vorp != null && player.vorp >= 0) {
      add(`Standalone value (${player.position}${player.depthChartOrder})`, 12)
      reasons.push(`Standalone value (${player.position}${player.depthChartOrder})`)
    }

    if (isSevereInjury(player.injuryStatus)) {
      add(player.injuryStatus, -40)
      reasons.push(player.injuryStatus)
    }

    if (chopped) {
      for (const choppedTerm of choppedTerms({
        player, horizonPickNo, teams, yourPlayers, baseValue: score, consistencyMedians,
      })) {
        add(choppedTerm.label, choppedTerm.delta)
        if (choppedTerm.reason) reasons.push(choppedTerm.reason)
      }
    }

    if (queued.has(player.id)) {
      add('On your queue', 20)
      reasons.unshift('On your queue')
    }

    if (reasons.length === 0) {
      reasons.push(waiting ? `Best available at pick ${horizonPickNo}` : 'Best available')
    }

    return {
      player,
      score,
      reason: reasons[0] ?? (waiting ? `Best available at pick ${horizonPickNo}` : 'Best available'),
      reasons,
      breakdown,
      survivalProbability: survival,
    }
  })

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return rankOf(a.player) - rankOf(b.player)
  })

  return scored.slice(0, limit)
}

/**
 * Turn a score-ranked list into a real choice set: the top pick, then a
 * different position, someone who will not last, a bye-week fit, then leftover
 * unused positions. Stops the "also consider" list from being four more of
 * the same back.
 */
export function suggestionSet(
  recs: Recommendation[],
  limit = 5,
  options?: { waitForPick?: boolean },
): Recommendation[] {
  if (recs.length <= 1) return recs.slice(0, limit)
  const featured = recs[0]!
  const chosen: Recommendation[] = [featured]
  const used = new Set([featured.player.id])

  const leftover = () => recs.filter((rec) => !used.has(rec.player.id))
  const take = (rec: Recommendation | undefined) => {
    if (!rec || used.has(rec.player.id) || chosen.length >= limit) return
    used.add(rec.player.id)
    chosen.push(rec)
  }

  take(leftover().find((rec) => rec.player.position !== featured.player.position))
  const withOdds = leftover().filter((rec) => rec.survivalProbability != null)
  take(
    options?.waitForPick
      ? withOdds
        .filter((rec) => (rec.survivalProbability ?? 0) >= 0.5)
        .sort((a, b) => (b.survivalProbability ?? 0) - (a.survivalProbability ?? 0))[0]
      : withOdds
        .filter((rec) => (rec.survivalProbability ?? 1) < 0.5)
        .sort((a, b) => (a.survivalProbability ?? 1) - (b.survivalProbability ?? 1))[0],
  )
  take(leftover().find((rec) => rec.reasons.some((reason) => reason.startsWith('Open bye '))))

  const usedPositions = new Set(chosen.map((rec) => rec.player.position))
  for (const rec of leftover()) {
    if (chosen.length >= limit) break
    if (usedPositions.has(rec.player.position)) continue
    take(rec)
    usedPositions.add(rec.player.position)
  }
  for (const rec of leftover()) take(rec)
  return chosen
}
