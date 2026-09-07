import type { DraftPick, DraftSession, Player } from '../providers/types'
import { byeWeekDistribution, formatByePositions } from './byeWeeks'
import { leagueProjections, type Grade, type TeamGrade } from './grades'
import { draftFrontier } from './pickSlots'
import { marketBaseline } from './playerContext'
import { livePickNumber, nextPickNumberForSlot } from './snake'
import { replacementLevels } from './vorp'

const RUN_WINDOW = 8
const BEST_AVAILABLE = 24
const NEXT_AT_POSITION = 6
const ELITE_RANK = 36
const UPCOMING_PICKS = 3
const VALUE_BOARD = 6
const BENCH_DEPTH = 3
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
const STACK_PARTNERS = new Set(['WR', 'TE'])
const DAY_MS = 24 * 60 * 60 * 1000

export const AI_GRADE_LEGEND = {
  vsMarket: 'pick number minus market ADP; positive means a steal (taken later than ADP)',
  valueTally: 'sum of vsMarket for valued picks; positive means the team found value',
  grade: 'room-relative letter from 70% projected lineup points and 30% ADP value; null until enough picks',
  playoffSos: '1 = easiest playoff slate at that position among modeled players',
  rank: 'consensus board rank',
  posRank: 'consensus rank within the position (RB3 = 3)',
  projPosRank: 'rank within the position by projected points',
  rankSpread: 'standard deviation of expert ranks; higher means the room disagrees',
  rankRange: '[best, worst] rank across the tracked expert boards',
  projRange: '[low, high] season projection across the sources that publish one',
  adpTrend: 'market movement over the tracked window; delta positive means the market is climbing on this player (going earlier)',
  adpMomentum: 'live ADP now vs the last-1-day and last-7-day rolling averages; positive means rising',
  vorp: 'projected points over the replacement-level player at that position in this league',
  replacement: 'projected points of the replacement-level player at each position for this league size and lineup',
  starter: 'the pick currently occupies a starting lineup seat',
  depth: 'depth-chart order on the NFL team; 1 = first string',
  ptsVsRoom: 'projected lineup points minus the room average',
  nextPicks: 'pick numbers this team still owns, soonest first',
  dropoff: 'projected points between the best and fifth-best player left at the position',
} as const

export interface AiMarketTrend {
  /** Which collected series the window was measured on. */
  metric: 'liveAdp' | 'adp' | 'rank'
  first: number
  last: number
  /** first - last: positive means the player is being taken earlier now. */
  delta: number
  days: number
  points: number
}

/** Structural shape of a collected ranking-history point; see `api/playerIntelligence`. */
export interface MarketHistoryPointLike {
  at: number
  rank: number | null
  adp: number | null
  liveAdp?: number | null
}

export type MarketHistoryLookup = (player: Player) => MarketHistoryPointLike[] | null | undefined

export interface AiPickBriefing {
  pick: number
  round: number
  player: string
  pos: string
  nfl: string | null
  keeper?: true
  starter?: true
  adp: number | null
  liveAdp: number | null
  market: number | null
  marketSource: 'live ADP' | 'ADP' | null
  vsMarket: number | null
  proj: number | null
  projRange?: [number, number]
  projSources?: number
  vorp: number | null
  injury: string | null
  bye: number | null
  playoffSos: number | null
  age: number | null
  years: number | null
  depth?: number
  tier: number | null
  rank: number | null
  posRank?: number
  projPosRank?: number
  rankSpread: number | null
  rankRange?: [number, number]
  experts?: number
  adpTrend?: AiMarketTrend
  adpMomentum?: { d1?: number; d7?: number }
}

export interface AiTeamBriefing {
  slot: number
  name: string
  you?: true
  grade: Grade | null
  z: number | null
  rank: number
  lineupPts: number
  ptsVsRoom: number
  starters: string
  starterPtsByPos: Record<string, number>
  benchPts: number
  valueTally: number
  unvaluedPicks: number
  bestValue: { player: string; pick: number; vsMarket: number } | null
  worstValue: { player: string; pick: number; vsMarket: number } | null
  holes: string[]
  counts: Record<string, number>
  byes: Array<{ week: number; who: string; stacked?: true }>
  handcuffs: string[]
  stacks: string[]
  injured: string[]
  avgAge: number | null
  starterPlayoffSos: number | null
  nextPicks: number[]
  lineup: Array<{ slot: string; player: string | null; pts: number | null }>
  picks: AiPickBriefing[]
}

export interface AiRemainingPlayer {
  name: string
  pos: string
  nfl: string | null
  adp: number | null
  proj: number | null
  vorp: number | null
  injury: string | null
  tier?: number
  adpTrend?: number
}

export interface AiPositionMarket {
  pos: string
  drafted: number
  firstPick: number | null
  lastPick: number | null
  avgVsMarket: number | null
  /** Starting seats the room fields at the position, flex included. */
  seats: number
}

export interface AiValueEntry {
  player: string
  pos: string
  team: string
  pick: number
  vsMarket: number
}

export interface AiDraftBriefing {
  legend: typeof AI_GRADE_LEGEND
  league: {
    name: string
    season: string
    scoring: string
    type: string
    teams: number
    rounds: number
    status: string
    slots: DraftSession['slots']
    tePremium: DraftSession['receptionPremium']
    playoffWeeks: { start: number; end: number } | null
    yourSlot: number | null
    yourTeam: string | null
    keeperCount?: number
    scoringSettings?: Record<string, number>
  }
  progress: {
    picksMade: number
    picksTotal: number
    currentPick: number
    currentRound: number
    complete: boolean
  }
  runs: Array<{ pos: string; count: number; window: number }>
  board: Array<{ round: number; taken: string }>
  market: {
    byPosition: AiPositionMarket[]
    replacement: Record<string, number>
    steals: AiValueEntry[]
    reaches: AiValueEntry[]
  }
  remaining: {
    best: AiRemainingPlayer[]
    byPosition: Array<{
      pos: string
      left: number
      elite: number
      next: string[]
      topTier: number | null
      inTopTier: number | null
      dropoff: number | null
    }>
  }
  teams: AiTeamBriefing[]
}

export interface AiTeamWriteup {
  slot: number
  headline: string
  summary: string
  steals: string[]
  reaches: string[]
  risks: string[]
  outlook: string | null
  next: string | null
}

export interface AiSuperlative {
  label: string
  team: string
  note: string
}

export interface AiDraftGrade {
  headline: string
  summary: string
  themes: string[]
  superlatives: AiSuperlative[]
  teams: AiTeamWriteup[]
}

function compact(value: number | null | undefined, digits = 1): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Number(value.toFixed(digits))
}

function rankOf(player: Player): number {
  return player.searchRank > 0 ? player.searchRank : 9999
}

/**
 * Reduce a collected ranking-history series to one movement reading.
 *
 * Prefers the series that actually has observations: live ADP, then collected
 * ADP, then consensus rank. `delta` is first minus last, so a positive number
 * means the market moved the player earlier over the window.
 */
export function summarizeMarketHistory(
  points: MarketHistoryPointLike[] | null | undefined,
): AiMarketTrend | null {
  if (!points?.length) return null
  const metrics: Array<AiMarketTrend['metric']> = ['liveAdp', 'adp', 'rank']
  for (const metric of metrics) {
    const series = points
      .filter((point) => {
        const value = point[metric]
        return typeof value === 'number' && Number.isFinite(value)
      })
      .sort((left, right) => left.at - right.at)
    if (series.length < 2) continue
    const first = series[0]
    const last = series[series.length - 1]
    const firstValue = first[metric] as number
    const lastValue = last[metric] as number
    return {
      metric,
      first: Number(firstValue.toFixed(1)),
      last: Number(lastValue.toFixed(1)),
      delta: Number((firstValue - lastValue).toFixed(1)),
      days: Math.max(0, Math.round((last.at - first.at) / DAY_MS)),
      points: series.length,
    }
  }
  return null
}

function momentumOf(player: Player): { d1?: number; d7?: number } | null {
  const d1 = compact(player.liveAdpVsLastOne)
  const d7 = compact(player.liveAdpVsLastSeven)
  if (d1 == null && d7 == null) return null
  return { ...(d1 != null ? { d1 } : {}), ...(d7 != null ? { d7 } : {}) }
}

/** Spread across the projection sources, when more than one publishes a line. */
function projectionRange(player: Player): { projRange: [number, number]; projSources: number } | null {
  const values = (player.projectionBreakdown ?? [])
    .map((line) => line.points)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (values.length < 2) return null
  const low = Math.min(...values)
  const high = Math.max(...values)
  if (high - low < 1) return null
  return { projRange: [Number(low.toFixed(1)), Number(high.toFixed(1))], projSources: values.length }
}

/** Consensus and projection order within each position, computed once per briefing. */
interface PositionRanks {
  consensus: Map<string, number>
  projected: Map<string, number>
}

function positionRanks(players: Player[]): PositionRanks {
  const consensus = new Map<string, number>()
  const projected = new Map<string, number>()
  const byPosition = new Map<string, Player[]>()
  for (const player of players) {
    const pool = byPosition.get(player.position)
    if (pool) pool.push(player)
    else byPosition.set(player.position, [player])
  }
  for (const pool of byPosition.values()) {
    const ranked = [...pool].sort((left, right) => rankOf(left) - rankOf(right))
    ranked.forEach((player, index) => {
      if (rankOf(player) < 9000) consensus.set(player.id, index + 1)
    })
    const byPoints = pool
      .filter((player) => player.projectedPoints != null)
      .sort((left, right) => (right.projectedPoints ?? 0) - (left.projectedPoints ?? 0))
    byPoints.forEach((player, index) => projected.set(player.id, index + 1))
  }
  return { consensus, projected }
}

interface PickContext {
  ranks: PositionRanks
  marketHistory?: MarketHistoryLookup
  starterIds: Set<string>
}

function pickBriefing(pick: DraftPick, player: Player | undefined, context: PickContext): AiPickBriefing {
  const baseline = player ? marketBaseline(player) : null
  const vsMarket =
    pick.pickNo > 0 && baseline ? compact(pick.pickNo - baseline.value) : null
  const projection = player ? projectionRange(player) : null
  const momentum = player ? momentumOf(player) : null
  const trend = player && context.marketHistory
    ? summarizeMarketHistory(context.marketHistory(player))
    : null
  const posRank = player ? context.ranks.consensus.get(player.id) : undefined
  const projPosRank = player ? context.ranks.projected.get(player.id) : undefined
  const rankRange = player && player.rankLow != null && player.rankHigh != null && player.rankHigh > player.rankLow
    ? [Math.round(player.rankLow), Math.round(player.rankHigh)] as [number, number]
    : null
  return {
    pick: pick.pickNo,
    round: pick.round,
    player: player?.fullName ?? ([pick.meta?.firstName, pick.meta?.lastName].filter(Boolean).join(' ') || pick.playerId),
    pos: player?.position ?? pick.meta?.position ?? '—',
    nfl: player?.team ?? pick.meta?.team ?? null,
    ...(pick.isKeeper ? { keeper: true as const } : {}),
    ...(player && context.starterIds.has(player.id) ? { starter: true as const } : {}),
    adp: compact(player?.adp),
    liveAdp: compact(player?.liveAdp),
    market: compact(baseline?.value ?? null),
    marketSource: baseline?.source ?? null,
    vsMarket,
    proj: compact(player?.projectedPoints),
    ...(projection ?? {}),
    vorp: compact(player?.vorp),
    injury: player?.injuryStatus ?? pick.meta?.injuryStatus ?? null,
    bye: player?.bye ?? null,
    playoffSos: player?.playoffSos?.rank ?? null,
    age: player?.age ?? null,
    years: player?.yearsExp ?? null,
    ...(player?.depthChartOrder != null ? { depth: player.depthChartOrder } : {}),
    tier: player?.tier ?? null,
    rank: player && rankOf(player) < 9000 ? player.searchRank : null,
    ...(posRank != null ? { posRank } : {}),
    ...(projPosRank != null ? { projPosRank } : {}),
    rankSpread: compact(player?.rankStdDev),
    ...(rankRange ? { rankRange } : {}),
    ...(player?.consensusCount ? { experts: player.consensusCount } : {}),
    ...(trend ? { adpTrend: trend } : {}),
    ...(momentum ? { adpMomentum: momentum } : {}),
  }
}

function remainingPlayer(player: Player, marketHistory?: MarketHistoryLookup): AiRemainingPlayer {
  const baseline = marketBaseline(player)
  const trend = marketHistory ? summarizeMarketHistory(marketHistory(player)) : null
  return {
    name: player.fullName,
    pos: player.position,
    nfl: player.team,
    adp: compact(baseline?.value ?? player.adp),
    proj: compact(player.projectedPoints),
    vorp: compact(player.vorp),
    injury: player.injuryStatus,
    ...(player.tier != null ? { tier: player.tier } : {}),
    ...(trend ? { adpTrend: trend.delta } : {}),
  }
}

function positionRuns(picks: DraftPick[], playersById: Map<string, Player>): AiDraftBriefing['runs'] {
  const recent = [...picks].filter((pick) => pick.pickNo > 0).sort((a, b) => b.pickNo - a.pickNo).slice(0, RUN_WINDOW)
  if (recent.length < 4) return []
  const byPos = new Map<string, number>()
  for (const pick of recent) {
    const position = playersById.get(pick.playerId)?.position ?? pick.meta?.position
    if (!position) continue
    byPos.set(position, (byPos.get(position) ?? 0) + 1)
  }
  return [...byPos.entries()]
    .filter(([, count]) => count / recent.length >= 0.5)
    .map(([pos, count]) => ({ pos, count, window: recent.length }))
}

/** Round-by-round shape of the board: what each round spent its picks on. */
function roundBoard(picks: DraftPick[], playersById: Map<string, Player>): AiDraftBriefing['board'] {
  const byRound = new Map<number, Map<string, number>>()
  for (const pick of picks) {
    const position = playersById.get(pick.playerId)?.position ?? pick.meta?.position
    if (!position || pick.round < 1) continue
    const counts = byRound.get(pick.round) ?? new Map<string, number>()
    counts.set(position, (counts.get(position) ?? 0) + 1)
    byRound.set(pick.round, counts)
  }
  return [...byRound.entries()]
    .sort(([left], [right]) => left - right)
    .map(([round, counts]) => ({
      round,
      taken: [...counts.entries()]
        .sort(([, left], [, right]) => right - left)
        .map(([pos, count]) => `${pos}${count}`)
        .join(' '),
    }))
}

function handcuffs(roster: Player[]): string[] {
  const pairs: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i < roster.length; i += 1) {
    const left = roster[i]
    if (!left?.team) continue
    for (let j = i + 1; j < roster.length; j += 1) {
      const right = roster[j]
      if (!right || right.team !== left.team || right.position !== left.position) continue
      const key = [left.fullName, right.fullName].sort().join(' / ')
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push(key)
    }
  }
  return pairs
}

/** A quarterback paired with a pass catcher on the same NFL team. */
function stacks(roster: Player[]): string[] {
  const found: string[] = []
  for (const quarterback of roster) {
    if (quarterback.position !== 'QB' || !quarterback.team) continue
    for (const partner of roster) {
      if (partner.team !== quarterback.team || !STACK_PARTNERS.has(partner.position)) continue
      found.push(`${quarterback.fullName} / ${partner.fullName}`)
    }
  }
  return found
}

interface TeamContext extends PickContext {
  yourSlot: number | null
  rankBySlot: Map<number, number>
  roomAveragePoints: number
  nextPicksBySlot: Map<number, number[]>
}

function teamBriefing(grade: TeamGrade, playersById: Map<string, Player>, context: TeamContext): AiTeamBriefing {
  const roster = grade.picks
    .map((pick) => playersById.get(pick.playerId))
    .filter((player): player is Player => Boolean(player))
  const holes = grade.lineup.seats.filter((seat) => !seat.player).map((seat) => seat.label)
  const counts: Record<string, number> = {}
  for (const player of roster) {
    counts[player.position] = (counts[player.position] ?? 0) + 1
  }
  const starterIds = new Set(
    grade.lineup.seats.map((seat) => seat.player?.id).filter((id): id is string => Boolean(id)),
  )
  const starterPtsByPos: Record<string, number> = {}
  for (const seat of grade.lineup.seats) {
    const player = seat.player
    if (player?.projectedPoints == null) continue
    starterPtsByPos[player.position] = Number(
      ((starterPtsByPos[player.position] ?? 0) + player.projectedPoints).toFixed(1),
    )
  }
  const benchPts = roster
    .filter((player) => !starterIds.has(player.id))
    .sort((left, right) => (right.projectedPoints ?? 0) - (left.projectedPoints ?? 0))
    .slice(0, BENCH_DEPTH)
    .reduce((sum, player) => sum + (player.projectedPoints ?? 0), 0)
  const byes = byeWeekDistribution(roster).map((row) => ({
    week: row.week,
    who: formatByePositions(row.byPosition),
    ...(row.stacked ? { stacked: true as const } : {}),
  }))
  const ages = roster.map((player) => player.age).filter((age): age is number => age != null)
  const sosRanks = grade.lineup.seats
    .map((seat) => seat.player?.playoffSos?.rank)
    .filter((rank): rank is number => rank != null)
  const picks = [...grade.picks]
    .sort((a, b) => a.pickNo - b.pickNo)
    .map((pick) => pickBriefing(pick, playersById.get(pick.playerId), { ...context, starterIds }))
  const byValue = picks
    .filter((row) => row.vsMarket != null && row.pick > 0)
    .sort((left, right) => (right.vsMarket ?? 0) - (left.vsMarket ?? 0))
  const entry = (row: AiPickBriefing | undefined) =>
    row ? { player: row.player, pick: row.pick, vsMarket: row.vsMarket ?? 0 } : null
  return {
    slot: grade.slot,
    name: grade.teamName,
    ...(context.yourSlot != null && grade.slot === context.yourSlot ? { you: true as const } : {}),
    grade: grade.grade,
    z: compact(grade.z, 2),
    rank: context.rankBySlot.get(grade.slot) ?? 0,
    lineupPts: compact(grade.lineup.points) ?? 0,
    ptsVsRoom: compact(grade.lineup.points - context.roomAveragePoints) ?? 0,
    starters: `${grade.lineup.covered}/${grade.lineup.seats.length}`,
    starterPtsByPos,
    benchPts: compact(benchPts) ?? 0,
    valueTally: compact(grade.valueTally) ?? 0,
    unvaluedPicks: grade.unvaluedPicks,
    bestValue: entry(byValue[0]),
    worstValue: entry(byValue.length > 1 ? byValue[byValue.length - 1] : undefined),
    holes,
    counts,
    byes,
    handcuffs: handcuffs(roster),
    stacks: stacks(roster),
    injured: roster
      .filter((player) => player.injuryStatus)
      .map((player) => `${player.fullName} (${player.injuryStatus})`),
    avgAge: ages.length ? compact(ages.reduce((sum, age) => sum + age, 0) / ages.length) : null,
    starterPlayoffSos: sosRanks.length
      ? compact(sosRanks.reduce((sum, rank) => sum + rank, 0) / sosRanks.length)
      : null,
    nextPicks: context.nextPicksBySlot.get(grade.slot) ?? [],
    lineup: grade.lineup.seats.map((seat) => ({
      slot: seat.label,
      player: seat.player?.fullName ?? null,
      pts: compact(seat.player?.projectedPoints),
    })),
    picks,
  }
}

/** Starting seats the whole room fields at a position, flex included. */
function roomSeats(slots: DraftSession['slots'], teams: number, pos: string): number {
  const dedicated = (slots[pos as keyof DraftSession['slots']] ?? 0) * teams
  if (pos === 'QB') return dedicated + slots.SUPER_FLEX * teams
  if (pos === 'RB' || pos === 'WR' || pos === 'TE') return dedicated + slots.FLEX * teams
  return dedicated
}

function positionMarket(
  picks: AiPickBriefing[],
  slots: DraftSession['slots'],
  teams: number,
): AiPositionMarket[] {
  return POSITIONS.map((pos) => {
    const taken = picks.filter((pick) => pick.pos === pos && pick.pick > 0)
    const valued = taken.map((pick) => pick.vsMarket).filter((value): value is number => value != null)
    return {
      pos,
      drafted: taken.length,
      firstPick: taken.length ? Math.min(...taken.map((pick) => pick.pick)) : null,
      lastPick: taken.length ? Math.max(...taken.map((pick) => pick.pick)) : null,
      avgVsMarket: valued.length
        ? compact(valued.reduce((sum, value) => sum + value, 0) / valued.length)
        : null,
      seats: roomSeats(slots, teams, pos),
    }
  }).filter((row) => row.drafted > 0 || row.seats > 0)
}

/**
 * Everything the model needs to write a room-level draft recap and a
 * per-team writeup: settings, the letter grades already computed, every pick
 * with market, projection, and market-movement context, construction holes,
 * the room-wide value board, and who is left.
 */
export function buildAiDraftBriefing(options: {
  session: DraftSession
  picks: DraftPick[]
  players: Player[]
  yourSlot?: number | null
  /** Collected ranking history, when the caller already has the catalog. */
  marketHistory?: MarketHistoryLookup
}): AiDraftBriefing {
  const { session, picks, players, marketHistory } = options
  const yourSlot = options.yourSlot ?? session.yourSlot
  const playersById = new Map(players.map((player) => [player.id, player]))
  const teamNameBySlot = new Map(
    session.order.map((slot) => [slot.slot, slot.teamName || slot.displayName]),
  )
  const grades = leagueProjections({
    picks,
    playersById,
    teams: session.teams,
    slots: session.slots,
    teamNameBySlot,
  })
  const taken = new Set(picks.map((pick) => pick.playerId))
  const available = players.filter((player) => !taken.has(player.id)).sort((a, b) => {
    const rankGap = rankOf(a) - rankOf(b)
    if (rankGap !== 0) return rankGap
    return (b.projectedPoints ?? Number.NEGATIVE_INFINITY) - (a.projectedPoints ?? Number.NEGATIVE_INFINITY)
  })
  const picksTotal = session.teams * session.rounds
  const takenPickNos = picks.map((pick) => pick.pickNo).filter((pickNo) => pickNo > 0)
  const takenSet = new Set(takenPickNos)
  const currentPick = livePickNumber(takenPickNos, picksTotal, draftFrontier(picks))
  const yourTeam = yourSlot != null
    ? teamNameBySlot.get(yourSlot) ?? `Slot ${yourSlot}`
    : null

  const ranks = positionRanks(players)
  const roomAveragePoints = grades.length
    ? grades.reduce((sum, grade) => sum + grade.lineup.points, 0) / grades.length
    : 0
  const rankBySlot = new Map(
    [...grades]
      .sort((left, right) => right.lineup.points - left.lineup.points)
      .map((grade, index) => [grade.slot, index + 1] as const),
  )
  const nextPicksBySlot = new Map(
    grades.map((grade) => {
      const owned: number[] = []
      let from = currentPick
      for (let index = 0; index < UPCOMING_PICKS; index += 1) {
        const next = nextPickNumberForSlot(
          from, grade.slot, session.teams, session.rounds, session.type, takenSet, session.pickOwners,
        )
        if (next == null) break
        owned.push(next)
        from = next + 1
      }
      return [grade.slot, owned] as const
    }),
  )

  const teams = grades.map((grade) => teamBriefing(grade, playersById, {
    ranks,
    marketHistory,
    starterIds: new Set<string>(),
    yourSlot,
    rankBySlot,
    roomAveragePoints,
    nextPicksBySlot,
  }))

  const allPicks = teams.flatMap((team) => team.picks.map((pick) => ({ pick, team: team.name })))
  const asEntry = (row: { pick: AiPickBriefing; team: string }): AiValueEntry => ({
    player: row.pick.player,
    pos: row.pick.pos,
    team: row.team,
    pick: row.pick.pick,
    vsMarket: row.pick.vsMarket ?? 0,
  })
  const byValue = allPicks
    .filter((row) => row.pick.vsMarket != null && row.pick.pick > 0)
    .sort((left, right) => (right.pick.vsMarket ?? 0) - (left.pick.vsMarket ?? 0))
  const projectionPool = players
    .filter((player): player is Player & { projectedPoints: number } => player.projectedPoints != null)
    .map((player) => ({ id: player.id, position: player.position, points: player.projectedPoints }))
  const replacement = projectionPool.length
    ? Object.fromEntries(
      Object.entries(replacementLevels(projectionPool, session.slots, session.teams))
        .map(([pos, points]) => [pos, Number(points.toFixed(1))]),
    )
    : {}

  return {
    legend: AI_GRADE_LEGEND,
    league: {
      name: session.name,
      season: session.season,
      scoring: session.scoringType,
      type: session.type,
      teams: session.teams,
      rounds: session.rounds,
      status: session.status,
      slots: session.slots,
      tePremium: session.receptionPremium ?? null,
      playoffWeeks: session.playoffWeeks ?? null,
      yourSlot,
      yourTeam,
      ...(session.keeperCount ? { keeperCount: session.keeperCount } : {}),
      ...(session.scoringSettings ? { scoringSettings: session.scoringSettings } : {}),
    },
    progress: {
      picksMade: takenPickNos.length,
      picksTotal,
      currentPick,
      currentRound: Math.min(session.rounds, Math.max(1, Math.ceil(currentPick / session.teams))),
      complete: session.status === 'complete' || takenPickNos.length >= picksTotal,
    },
    runs: positionRuns(picks, playersById),
    board: roundBoard(picks, playersById),
    market: {
      byPosition: positionMarket(allPicks.map((row) => row.pick), session.slots, session.teams),
      replacement,
      steals: byValue.filter((row) => (row.pick.vsMarket ?? 0) > 0).slice(0, VALUE_BOARD).map(asEntry),
      reaches: byValue.filter((row) => (row.pick.vsMarket ?? 0) < 0).slice(-VALUE_BOARD).reverse().map(asEntry),
    },
    remaining: {
      best: available.slice(0, BEST_AVAILABLE).map((player) => remainingPlayer(player, marketHistory)),
      byPosition: POSITIONS.map((pos) => {
        const pool = available.filter((player) => player.position === pos)
        const topTier = pool.find((player) => player.tier != null)?.tier ?? null
        const projected = pool
          .map((player) => player.projectedPoints)
          .filter((points): points is number => points != null)
          .sort((left, right) => right - left)
        return {
          pos,
          left: pool.length,
          elite: pool.filter((player) => rankOf(player) <= ELITE_RANK).length,
          next: pool.slice(0, NEXT_AT_POSITION).map((player) => player.fullName),
          topTier,
          inTopTier: topTier == null ? null : pool.filter((player) => player.tier === topTier).length,
          dropoff: projected.length >= 5 ? compact(projected[0] - projected[4]) : null,
        }
      }).filter((row) => row.left > 0),
    },
    teams,
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(asString).filter(Boolean)
}

function parseSuperlative(value: unknown): AiSuperlative | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const label = asString(row.label)
  const team = asString(row.team)
  if (!label || !team) return null
  return { label, team, note: asString(row.note) }
}

function parseTeamWriteup(value: unknown): AiTeamWriteup | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const slot = Number(row.slot)
  if (!Number.isInteger(slot) || slot < 1) return null
  const headline = asString(row.headline)
  const summary = asString(row.summary)
  if (!headline && !summary) return null
  return {
    slot,
    headline,
    summary,
    steals: asStringList(row.steals),
    reaches: asStringList(row.reaches),
    risks: asStringList(row.risks),
    outlook: asString(row.outlook) || null,
    next: asString(row.next) || null,
  }
}

/** Pull a JSON object out of a model reply that may be fenced or padded. */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('AI reply was not JSON')
    return JSON.parse(candidate.slice(start, end + 1))
  }
}

export function parseAiDraftGrade(raw: unknown): AiDraftGrade {
  const source = typeof raw === 'string' ? extractJsonObject(raw) : raw
  if (!source || typeof source !== 'object') throw new Error('AI reply was empty')
  const row = source as Record<string, unknown>
  const headline = asString(row.headline)
  const summary = asString(row.summary)
  if (!headline && !summary) throw new Error('AI reply was missing a summary')
  const teams = Array.isArray(row.teams)
    ? row.teams.map(parseTeamWriteup).filter((team): team is AiTeamWriteup => team != null)
    : []
  const superlatives = Array.isArray(row.superlatives)
    ? row.superlatives.map(parseSuperlative).filter((item): item is AiSuperlative => item != null)
    : []
  return {
    headline,
    summary,
    themes: asStringList(row.themes),
    superlatives,
    teams,
  }
}
