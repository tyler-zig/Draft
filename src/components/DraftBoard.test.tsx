import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DraftBoard } from './DraftBoard'
import { pickNumberFor } from '../draft/snake'
import type { DraftPick, DraftSession, Player } from '../providers/types'

const TEAMS = 4
const ROUNDS = 5

const session = {
  provider: 'espn', draftId: 'd', leagueId: 'l', name: 'Keeper League', type: 'snake',
  status: 'drafting', season: '2026', scoringType: 'ppr', teams: TEAMS, rounds: ROUNDS,
  pickTimer: null,
  slots: { QB: 1, RB: 1, WR: 1, TE: 0, FLEX: 0, SUPER_FLEX: 0, K: 0, DEF: 0, BN: 2 },
  rosterPositions: ['QB', 'RB', 'WR', 'BN', 'BN'],
  order: Array.from({ length: TEAMS }, (_, i) => ({
    slot: i + 1, rosterId: `r${i + 1}`, userId: `u${i + 1}`,
    displayName: `T${i + 1}`, teamName: `Team ${i + 1}`, isYou: i === 0,
  })),
  yourUserId: 'u1', yourSlot: 1, startTime: null, playoffWeeks: null,
} as unknown as DraftSession

const player = (id: string, last: string): Player => ({
  id, sleeperId: id, firstName: 'A', lastName: last, fullName: `A ${last}`,
  position: 'RB', team: 'CHI', searchRank: Number(id), injuryStatus: null,
  number: null, yearsExp: 1, bye: null,
} as unknown as Player)

function pick(playerId: string, pickNo: number, round: number, draftSlot: number, isKeeper = false): DraftPick {
  return { playerId, pickedByUserId: null, rosterId: `r${draftSlot}`, round, draftSlot, pickNo, isKeeper, meta: null }
}

/** The grid cell whose pick number is the one (round, slot) resolves to. */
function cellFor(container: HTMLElement, round: number, slot: number) {
  const pickNo = pickNumberFor(round, slot, TEAMS, 'snake', null)
  const cells = [...container.querySelectorAll('.cc-full-board-cell')]
  const cell = cells.find((node) => node.querySelector('.cc-no')?.textContent?.replace('K', '') === String(pickNo))
  if (!cell) throw new Error(`No cell for pick ${pickNo} (round ${round}, slot ${slot})`)
  return cell as HTMLElement
}

describe('DraftBoard cell placement', () => {
  it('places a pick by its overall pick number, not its reported round', () => {
    // Rounds 1-2 are keepers. The provider then reports real picks whose
    // `round` field disagrees with the round their `pickNo` falls in -- ESPN
    // takes pickNo from overallPickNumber but round from roundId, and after
    // keeper rounds those stop lining up.
    const picks: DraftPick[] = [
      pick('1', 1, 1, 1, true), pick('2', 2, 1, 2, true), pick('3', 3, 1, 3, true), pick('4', 4, 1, 4, true),
      pick('5', 5, 2, 4, true), pick('6', 6, 2, 3, true), pick('7', 7, 2, 2, true), pick('8', 8, 2, 1, true),
      // Real pick 9 is round 3 slot 1, but the provider labels it round 1.
      pick('9', 9, 1, 1),
      // Real pick 10 is round 3 slot 2, labelled round 2.
      pick('10', 10, 2, 2),
    ]
    const players = picks.map((p) => player(p.playerId, `P${p.playerId}`))
    const { container } = render(<DraftBoard session={session} picks={picks} players={players} currentPickNo={11} />)

    // Pick 9 belongs in round 3 slot 1, whatever the provider called its round.
    expect(within(cellFor(container, 3, 1)).getByText('P9')).toBeTruthy()
    expect(within(cellFor(container, 3, 2)).getByText('P10')).toBeTruthy()
    // The keeper cells it would have displaced are still their own picks.
    expect(within(cellFor(container, 1, 1)).getByText('P1')).toBeTruthy()
    expect(within(cellFor(container, 2, 2)).getByText('P7')).toBeTruthy()
  })

  it('does not drop a pick when two share a round and slot', () => {
    const picks: DraftPick[] = [
      pick('1', 1, 1, 1, true),
      pick('2', 5, 1, 1), // same round+slot as the keeper, different pick number
    ]
    const players = picks.map((p) => player(p.playerId, `P${p.playerId}`))
    const { container } = render(<DraftBoard session={session} picks={picks} players={players} currentPickNo={6} />)

    expect(within(cellFor(container, 1, 1)).getByText('P1')).toBeTruthy()
    expect(within(cellFor(container, 2, 4)).getByText('P2')).toBeTruthy()
  })

  it('leaves off-board keepers out of the grid', () => {
    const picks: DraftPick[] = [pick('1', 0, 1, 1, true), pick('2', 1, 1, 1)]
    const players = picks.map((p) => player(p.playerId, `P${p.playerId}`))
    const { container } = render(<DraftBoard session={session} picks={picks} players={players} currentPickNo={2} />)

    expect(within(cellFor(container, 1, 1)).getByText('P2')).toBeTruthy()
    expect(screen.queryByText('P1')).toBeNull()
  })
})
