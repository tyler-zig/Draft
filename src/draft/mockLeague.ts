import type { MockLeagueTemplate } from '../providers/demoProvider'
import type { DraftSession, KeeperEntry } from '../providers/types'

/**
 * Carrying a real league into the mock engine.
 *
 * A mock normally invents twelve CPUs with roster ids "1".."12". Keeper
 * entries are stored against the provider's own roster ids, so those entries
 * cannot be placed in an invented room -- `keeperPicks` drops any entry whose
 * roster it does not recognise. Running a mock of *your* league therefore
 * means carrying the room's `order` across verbatim, not regenerating it.
 *
 * The seed is persisted so "Start new mock" inside the mock room can rebuild
 * the same league; the engine itself is a module singleton and would survive
 * the navigation, but not a reload.
 */

const SEED_KEY = 'draft-assistant:mock-league-seed'

export interface MockLeagueSeed {
  template: MockLeagueTemplate
  keepers: KeeperEntry[]
  costRoundPicks: boolean
  /** Where the seed came from, so the mock room can name it. */
  sourceKey: string
}

/** The parts of a live session a mock needs to stand in for it. */
export function mockTemplateFrom(session: DraftSession): MockLeagueTemplate {
  return {
    name: session.name,
    teams: session.teams,
    rounds: session.rounds,
    scoringType: session.scoringType,
    slots: session.slots,
    rosterPositions: session.rosterPositions,
    order: session.order,
    yourUserId: session.yourUserId,
    yourSlot: session.yourSlot,
    keeperCount: session.keeperCount ?? null,
    scoringSettings: session.scoringSettings ?? null,
  }
}

function isSeed(value: unknown): value is MockLeagueSeed {
  if (!value || typeof value !== 'object') return false
  const seed = value as Partial<MockLeagueSeed>
  return Boolean(
    seed.template &&
    Array.isArray(seed.template.order) &&
    seed.template.order.length > 0 &&
    Array.isArray(seed.keepers),
  )
}

export function saveMockLeagueSeed(seed: MockLeagueSeed) {
  try {
    localStorage.setItem(SEED_KEY, JSON.stringify(seed))
  } catch {
    /* the engine is already seeded in memory; only a reload loses it */
  }
}

export function loadMockLeagueSeed(): MockLeagueSeed | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEED_KEY) ?? 'null') as unknown
    return isSeed(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function clearMockLeagueSeed() {
  try { localStorage.removeItem(SEED_KEY) } catch { /* nothing to clear */ }
}
