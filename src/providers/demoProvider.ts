import { ownerSlotForPick } from '../draft/snake'
import { fillRoster, needForPosition } from '../draft/rosterNeeds'
import { marketBaseline } from '../draft/playerContext'
import { sampleNormal, spreadFor } from '../draft/survival'
import { sleeperProvider } from './sleeperProvider'
import {
  CURRENT_SEASON,
  defaultSlotCounts,
  type DraftPick,
  type DraftProvider,
  type DraftSession,
  type DraftSlot,
  type Player,
  type ScoringType,
  type SlotCounts,
} from './types'

const DEMO_DRAFT_ID = 'local'
const DEMO_USER_ID = 'you'

/**
 * A real league's shape, so a mock can be run against your actual room rather
 * than twelve invented CPUs.
 *
 * Carrying `order` verbatim is the point: keeper entries are stored against
 * provider roster ids, and `keeperPicks` drops any entry whose roster it
 * cannot place. Regenerating names would silently discard every keeper.
 */
export interface MockLeagueTemplate {
  name: string
  teams: number
  rounds: number
  scoringType: ScoringType
  slots: SlotCounts
  rosterPositions: string[]
  order: DraftSlot[]
  yourUserId: string
  yourSlot: number | null
  keeperCount?: number | null
  scoringSettings?: Record<string, number> | null
}

/** Shape a new mock draft is configured from; every field is optional. */
export interface MockOptions {
  teams?: number
  rounds?: number
  yourSlot?: number
  scoringType?: ScoringType
  /** 0 = disciplined (stick to the board), 1 = reachy (anyone, anywhere). */
  reach?: number
  /** Auto-draft for your slot too, so a mock can run hands-free to the end. */
  autoPickYourPicks?: boolean
  /** Injected randomness so tests can pin the simulation. */
  rng?: () => number
  /**
   * Run against a real league's teams instead of generated CPUs. When set,
   * `teams`, `rounds`, `yourSlot` and `scoringType` come from the template.
   */
  template?: MockLeagueTemplate | null
  /**
   * Keeper picks, already resolved to the slots they occupy by `keeperPicks`.
   *
   * These are seeded into the engine's own board rather than layered on at
   * render time. The engine numbers picks by walking unoccupied slots, so a
   * seeded keeper both removes its player from the pool and reserves the pick
   * its team paid for -- which is what stops the simulation from drafting over
   * the keeper and dropping it off the board.
   */
  keeperPicks?: DraftPick[]
}

export const DEMO_MOCK_DEFAULTS = {
  teams: 12,
  rounds: 15,
  yourSlot: 5,
  scoringType: 'ppr' as ScoringType,
  reach: 0.5,
  autoPickYourPicks: true,
}

const clamp = (value: number | undefined, min: number, max: number, fallback: number) => (
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value!))) : fallback
)

/** Clamp user input into a draftable config; out-of-range values fall back, not crash. */
function validatedOptions(options: MockOptions): {
  teams: number
  rounds: number
  yourSlot: number
  scoringType: ScoringType
  reach: number
  autoPickYourPicks: boolean
} {
  // A template describes a real room, so its shape wins over the mock sliders.
  const template = options.template ?? null
  const teams = template
    ? clamp(template.teams, 2, 20, DEMO_MOCK_DEFAULTS.teams)
    : clamp(options.teams, 2, 20, DEMO_MOCK_DEFAULTS.teams)
  const rounds = template
    ? clamp(template.rounds, 1, 30, DEMO_MOCK_DEFAULTS.rounds)
    : clamp(options.rounds, 1, 30, DEMO_MOCK_DEFAULTS.rounds)
  const yourSlot = template
    ? clamp(template.yourSlot ?? 1, 1, teams, 1)
    : clamp(options.yourSlot, 1, teams, Math.min(DEMO_MOCK_DEFAULTS.yourSlot, teams))
  const reach = Number.isFinite(options.reach)
    ? Math.min(1, Math.max(0, options.reach!))
    : DEMO_MOCK_DEFAULTS.reach
  const requestedScoring = template ? template.scoringType : options.scoringType
  const scoringType = requestedScoring === 'half_ppr' || requestedScoring === 'std'
    ? requestedScoring
    : 'ppr'
  return {
    teams,
    rounds,
    yourSlot,
    scoringType,
    reach,
    autoPickYourPicks: options.autoPickYourPicks ?? DEMO_MOCK_DEFAULTS.autoPickYourPicks,
  }
}

const CPU_NAMES = [
  'Gridiron Gal',
  'Blitz Bot',
  'Sunday Call',
  'Chip Kelly',
  'Red Zone',
  'Play Action',
  'Two-Minute',
  'Audible',
  'Pigskin',
  'Hash Marks',
  'Chain Gang',
]

class DemoDraftEngine {
  picks: DraftPick[] = []
  session: DraftSession
  initialized = false
  private config: ReturnType<typeof validatedOptions> & { rng: () => number }
  private template: MockLeagueTemplate | null = null

  constructor() {
    this.config = { ...DEMO_MOCK_DEFAULTS, rng: Math.random }
    this.session = this.buildSession()
  }

  reset(options: MockOptions = {}) {
    this.config = { ...validatedOptions(options), rng: options.rng ?? Math.random }
    this.template = options.template ?? null
    this.session = this.buildSession()

    // Keepers are the board's opening state, not an overlay on top of it. Only
    // entries belonging to a roster in this room are seeded -- a keeper for a
    // team that is not playing would otherwise reserve a pick nobody owns.
    const rosters = new Set(this.session.order.map((slot) => slot.rosterId))
    const total = this.config.teams * this.config.rounds
    this.picks = (options.keeperPicks ?? [])
      .filter((pick) => rosters.has(pick.rosterId ?? '') && pick.pickNo <= total)
      .map((pick) => ({ ...pick, isKeeper: true }))
    // A keeper parked off the snake (`pickNo <= 0`, the "keepers do not cost a
    // pick" rule) holds no slot, so the room still drafts every round --
    // `currentPickNo` only treats positive pick numbers as taken.
    this.initialized = true
    if (this.isOver()) this.session = { ...this.session, status: 'complete' }
  }

  private buildSession(): DraftSession {
    const { teams, rounds, yourSlot, scoringType } = this.config
    const template = this.template
    if (template) {
      return {
        provider: 'demo',
        draftId: DEMO_DRAFT_ID,
        leagueId: 'demo',
        name: `${template.name} (mock)`,
        type: 'snake',
        status: 'drafting',
        season: CURRENT_SEASON,
        scoringType,
        teams,
        rounds,
        pickTimer: 90,
        slots: template.slots,
        rosterPositions: template.rosterPositions,
        order: template.order,
        yourUserId: template.yourUserId,
        yourSlot: template.yourSlot,
        startTime: Date.now(),
        keeperCount: template.keeperCount ?? null,
        scoringSettings: template.scoringSettings ?? null,
        playoffWeeks: null,
      }
    }
    const order = Array.from({ length: teams }, (_, i) => {
      const slot = i + 1
      const isYou = slot === yourSlot
      return {
        slot,
        rosterId: String(slot),
        userId: isYou ? DEMO_USER_ID : `cpu-${slot}`,
        displayName: isYou ? 'You' : (CPU_NAMES[i] ?? `CPU ${slot}`),
        teamName: isYou ? 'Your team' : (CPU_NAMES[i] ?? `CPU ${slot}`),
        isYou,
      }
    })

    return {
      provider: 'demo',
      draftId: DEMO_DRAFT_ID,
      leagueId: 'demo',
      name: 'Demo snake draft',
      type: 'snake',
      status: 'drafting',
      season: CURRENT_SEASON,
      scoringType,
      teams,
      rounds,
      pickTimer: 90,
      slots: defaultSlotCounts(),
      rosterPositions: [
        'QB',
        'RB',
        'RB',
        'WR',
        'WR',
        'TE',
        'FLEX',
        'K',
        'DEF',
        'BN',
        'BN',
        'BN',
        'BN',
        'BN',
        'BN',
      ],
      order,
      yourUserId: DEMO_USER_ID,
      yourSlot,
      startTime: Date.now(),
      // Mock drafts do not report a playoff window; callers fall back to the
      // standard weeks 15-17 default.
      playoffWeeks: null,
    }
  }

  private totalPicks() {
    return this.config.teams * this.config.rounds
  }

  /**
   * The next slot nobody owns yet.
   *
   * Counting `picks.length + 1` was fine while every pick was made in order,
   * but a keeper occupies the slot its team paid for -- which can be pick 7 of
   * round 1 while rounds 2 and 3 are still empty. Walking to the first
   * unreserved, undrafted slot is what lets the simulation draft around
   * keepers instead of over them. Returns one past the end when the board is
   * full.
   */
  currentPickNo() {
    const total = this.totalPicks()
    const taken = new Set(this.picks.filter((pick) => pick.pickNo > 0).map((pick) => pick.pickNo))
    let pickNo = 1
    while (pickNo <= total && taken.has(pickNo)) pickNo += 1
    return pickNo
  }

  isOver() {
    return this.currentPickNo() > this.totalPicks()
  }

  onTheClockSlot() {
    if (this.isOver()) return null
    return ownerSlotForPick(this.currentPickNo(), this.config.teams, 'snake').slot
  }

  yourTurn() {
    return this.onTheClockSlot() === this.config.yourSlot && !this.isOver()
  }

  pickPlayer(playerId: string, player: Player | undefined) {
    if (this.isOver()) return
    if (this.picks.some((p) => p.playerId === playerId)) return
    const pickNo = this.currentPickNo()
    const { round, slot } = ownerSlotForPick(pickNo, this.config.teams, 'snake')
    const owner = this.session.order.find((o) => o.slot === slot)
    this.picks = [
      ...this.picks,
      {
        playerId,
        pickedByUserId: owner?.userId ?? null,
        rosterId: owner?.rosterId ?? String(slot),
        round,
        draftSlot: slot,
        pickNo,
        isKeeper: false,
        meta: player
          ? {
              firstName: player.firstName,
              lastName: player.lastName,
              position: player.position,
              team: player.team,
              injuryStatus: player.injuryStatus,
            }
          : null,
      },
    ]
    if (this.isOver()) {
      this.session = { ...this.session, status: 'complete' }
    }
  }

  /**
   * One simulated pick. The CPU scores every draftable player as: market
   * baseline (ADP, or rank math when ADP is missing) minus a roster-need
   * bonus for the slot on the clock, plus normal noise scaled by the player's
   * expert-disagreement spread and the room's reach knob. A reachy room lets
   * noise override the board; a disciplined one follows it. Kickers and
   * defenses wait for the last round. Keepers are never on the board.
   */
  tick(players: Player[], keptIds: string[] = []) {
    if (!this.initialized || this.isOver()) return
    const onClock = this.onTheClockSlot()
    if (onClock == null) return
    if (onClock === this.config.yourSlot && !this.config.autoPickYourPicks) return
    const taken = new Set([...this.picks.map((p) => p.playerId), ...keptIds])
    const { round } = ownerSlotForPick(this.currentPickNo(), this.config.teams, 'snake')
    const lastRound = this.config.rounds
    const byId = new Map(players.map((p) => [p.id, p]))
    const rostered = this.picks
      .filter((p) => p.draftSlot === onClock)
      .map((p) => byId.get(p.playerId))
      .filter((p): p is Player => Boolean(p))
    const filled = fillRoster(this.session.slots, rostered)
    const needBonus = (player: Player) => {
      const need = needForPosition(this.session.slots, filled, player.position)
      return need.kind === 'starter' ? 85 : need.kind === 'flex' ? 45 : need.kind === 'superflex' ? 55 : 0
    }
    const spreadScale = 2.5 - 1.5 * this.config.reach
    const candidates = players
      .filter((p) => !taken.has(p.id) && p.searchRank < 9000)
      .filter((p) => round >= lastRound || (p.position !== 'K' && p.position !== 'DEF'))
      .map((player) => {
        // Rank stands in as a draft position here on purpose: the simulation
        // just needs every candidate on one ascending scale, and it is not
        // claiming a market the way the recommender does. `450 - rank` was a
        // score, not a position -- it ordered the board backwards on any
        // player the market does not cover.
        const baseline = marketBaseline(player)?.value ?? player.searchRank
        const noise = sampleNormal(this.config.rng) * (spreadFor(player) ?? 0) * spreadScale
        return { player, score: baseline - needBonus(player) + noise }
      })
      .sort((a, b) => a.score - b.score || a.player.searchRank - b.player.searchRank)
    const next = candidates[0]
    if (next) this.pickPlayer(next.player.id, next.player)
  }
}

const engine = new DemoDraftEngine()

export function initDemoDraft(options: MockOptions = {}) {
  engine.reset(options)
}

export function demoTick(players: Player[], keptIds: string[] = []) {
  engine.tick(players, keptIds)
}

export function demoPick(playerId: string, players: Player[], keptIds: string[] = []) {
  if (keptIds.includes(playerId)) return
  if (!engine.yourTurn()) return
  const player = players.find((p) => p.id === playerId)
  engine.pickPlayer(playerId, player)
}

export const demoProvider: DraftProvider = {
  id: 'demo',
  label: 'Demo',
  capabilities: { draftPick: true, autoPick: false },

  async getLeagues() {
    return {
      user: {
        userId: DEMO_USER_ID,
        username: 'you',
        displayName: 'You',
      },
      leagues: [
        {
          id: 'demo',
          name: 'Demo snake draft',
          season: CURRENT_SEASON,
          teamCount: engine.session.teams,
          status: 'drafting',
          scoringType: engine.session.scoringType,
          draftId: DEMO_DRAFT_ID,
          draftStatus: 'drafting',
          avatar: null,
        },
      ],
    }
  },

  async getDraft() {
    if (!engine.initialized) engine.reset()
    return engine.session
  },

  async getPicks() {
    // Seeded keepers can reserve a slot later than the picks made after them,
    // so the engine's array is not in board order. Everything downstream reads
    // this as a board.
    return [...engine.picks].sort((a, b) => a.pickNo - b.pickNo)
  },

  getPlayers() {
    return sleeperProvider.getPlayers()
  },
}

export { DEMO_DRAFT_ID, DEMO_USER_ID }
