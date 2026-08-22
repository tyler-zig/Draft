import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { defaultSlotCounts } from '../providers/types'
import type { DraftPick, DraftSession, DraftSlot, Player } from '../providers/types'
import { DraftGrades } from './DraftGrades'

function slot(slot: number, name: string): DraftSlot {
  return { slot, rosterId: `r${slot}`, userId: null, displayName: name, teamName: name, isYou: slot === 1 }
}

function session(overrides: Partial<DraftSession> = {}): DraftSession {
  return {
    provider: 'demo', draftId: 'd1', leagueId: 'l1', name: 'Mock', type: 'snake',
    status: 'drafting', season: '2026', scoringType: 'ppr', teams: 4, rounds: 15,
    pickTimer: null, slots: defaultSlotCounts(), rosterPositions: [],
    order: [1, 2, 3, 4].map((n) => slot(n, `Team ${n}`)),
    yourUserId: 'you', yourSlot: 1, startTime: null, ...overrides,
  }
}

function player(overrides: Partial<Player> & { id: string }): Player {
  return {
    firstName: overrides.id, lastName: '', fullName: overrides.id, position: 'RB', team: null,
    searchRank: 50, injuryStatus: null, number: null, yearsExp: null, bye: null,
    ...overrides,
  }
}

function pick(playerId: string, draftSlot: number, pickNo: number): DraftPick {
  return { playerId, pickedByUserId: null, rosterId: null, round: 1, draftSlot, pickNo, isKeeper: false, meta: null }
}

// Four teams, descending projected points so the default sort is visible.
const players = [
  player({ id: 'p1', position: 'RB', adp: 1, searchRank: 1, projectedPoints: 15 }),
  player({ id: 'p2', position: 'RB', adp: 6, searchRank: 6, projectedPoints: 14 }),
  player({ id: 'p3', position: 'RB', adp: 7, searchRank: 7, projectedPoints: 13 }),
  player({ id: 'p4', position: 'RB', adp: 8, searchRank: 8, projectedPoints: 12 }),
]
const picks = [1, 2, 3, 4].map((slot) => pick(`p${slot}`, slot, 5))

const dataRows = () => screen.getAllByRole('row').slice(1)

describe('DraftGrades', () => {
  it('renders every drafted team and highlights yours', () => {
    render(<DraftGrades session={session()} picks={picks} players={players} highlightedSlot={1} />)
    expect(dataRows()).toHaveLength(4)
    const mine = screen.getByText('Team 1').closest('tr')
    expect(mine).toHaveClass('cc-grades-you')
    expect(mine).toHaveTextContent('YOU')
    // Team 1 landed ADP-1 at pick 5: four picks of value.
    expect(mine).toHaveTextContent('+4')
    // A grade exists once four teams have a pick.
    expect(screen.getAllByText(/^[A-F]$/)).toHaveLength(4)
  })

  it('sorts by lineup points and flips on a second header click', async () => {
    const user = userEvent.setup()
    render(<DraftGrades session={session()} picks={picks} players={players} />)
    // Default: points, high to low.
    expect(dataRows()[0]).toHaveTextContent('Team 1')
    await user.click(screen.getByRole('button', { name: 'Sort by Lineup pts' }))
    expect(dataRows()[0]).toHaveTextContent('Team 4')
  })

  it('shows the note and an empty state with no picks', () => {
    render(<DraftGrades session={session()} picks={[]} players={players} note="Mock draft complete" />)
    expect(screen.getByText('Mock draft complete')).toBeInTheDocument()
    expect(screen.getByText('No picks made yet.')).toBeInTheDocument()
  })
})
