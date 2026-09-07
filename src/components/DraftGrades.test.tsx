import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { requestAiDraftGrade } from '../api/draftGrade'
import { defaultSlotCounts } from '../providers/types'
import type { DraftPick, DraftSession, DraftSlot, Player } from '../providers/types'
import { DraftGrades } from './DraftGrades'

vi.mock('../api/draftGrade', () => ({
  requestAiDraftGrade: vi.fn(),
}))

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

const players = [
  player({ id: 'p1', position: 'RB', adp: 1, searchRank: 1, projectedPoints: 15 }),
  player({ id: 'p2', position: 'RB', adp: 6, searchRank: 6, projectedPoints: 14 }),
  player({ id: 'p3', position: 'RB', adp: 7, searchRank: 7, projectedPoints: 13 }),
  player({ id: 'p4', position: 'RB', adp: 8, searchRank: 8, projectedPoints: 12 }),
]
const picks = [1, 2, 3, 4].map((slotNo) => pick(`p${slotNo}`, slotNo, 5))

const teamRows = () => screen.getAllByRole('button', { name: /details$/ })

describe('DraftGrades', () => {
  it('renders every drafted team and highlights yours', () => {
    render(<DraftGrades session={session()} picks={picks} players={players} highlightedSlot={1} />)
    expect(teamRows()).toHaveLength(4)
    const mine = screen.getByRole('button', { name: 'Team 1 details' })
    expect(mine).toHaveClass('cc-grades-you')
    expect(mine).toHaveTextContent('YOU')
    expect(mine).toHaveTextContent('+4')
    expect(screen.getByRole('heading', { name: /Team 1/ })).toBeInTheDocument()
    expect(screen.queryAllByText(/^[A-F]$/)).toHaveLength(0)
  })

  it('sorts by lineup points and flips on a second header click', async () => {
    const user = userEvent.setup()
    render(<DraftGrades session={session()} picks={picks} players={players} />)
    expect(teamRows()[0]).toHaveTextContent('Team 1')
    await user.click(screen.getByRole('button', { name: 'Sort by Lineup pts' }))
    expect(teamRows()[0]).toHaveTextContent('Team 4')
  })

  it('opens a team in the roster pane', async () => {
    const user = userEvent.setup()
    render(<DraftGrades session={session()} picks={picks} players={players} />)
    await user.click(screen.getByRole('button', { name: 'Team 2 details' }))
    expect(screen.getByRole('button', { name: 'Team 2 details' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: /Team 2/ })).toBeInTheDocument()
    expect(screen.getAllByText('p2').length).toBeGreaterThan(0)
  })

  it('switches between roster analysis and full room rankings', async () => {
    const user = userEvent.setup()
    render(<DraftGrades session={session()} picks={picks} players={players} highlightedSlot={1} />)

    await user.click(screen.getByRole('button', { name: 'Roster analysis' }))
    expect(screen.getByRole('heading', { name: /Team 1 · Pick by pick/ })).toBeInTheDocument()
    expect(screen.getByText('Market value at draft time')).toBeInTheDocument()
    expect(screen.getByText('Roster construction')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Room rankings' }))
    expect(screen.getByRole('heading', { name: 'Full room rankings' })).toBeInTheDocument()
    expect(screen.getByText('Projected lineup')).toBeInTheDocument()
    expect(screen.getByText('Coverage')).toBeInTheDocument()
  })

  it('shows the note and an empty state with no picks', () => {
    render(<DraftGrades session={session()} picks={[]} players={players} note="Mock draft complete" />)
    expect(screen.getByText('Mock draft complete')).toBeInTheDocument()
    expect(screen.getByText('No picks made yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI summary' })).not.toBeInTheDocument()
  })

  it('writes a DeepSeek room and team summary', async () => {
    vi.mocked(requestAiDraftGrade).mockResolvedValue({
      headline: 'Value won the room',
      summary: 'Three teams waited on running back.',
      themes: ['RB run'],
      superlatives: [],
      teams: [
        { slot: 1, headline: 'Your zero-RB board', summary: 'You waited and still landed p1.', steals: ['p1 at 5'], reaches: [], risks: ['Thin RB'], outlook: null, next: null },
        { slot: 2, headline: 'Reached early', summary: 'Paid up for p2.', steals: [], reaches: ['p2'], risks: [], outlook: null, next: null },
      ],
    })
    const user = userEvent.setup()
    render(<DraftGrades session={session()} picks={picks} players={players} highlightedSlot={1} />)
    await user.click(screen.getByRole('button', { name: 'AI summary' }))
    expect(await screen.findByRole('region', { name: 'AI draft summary' })).toHaveTextContent('Value won the room')
    expect(screen.getByText('RB run')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'AI team summary' })).toHaveTextContent('Your zero-RB board')
    expect(screen.getByText('p1 at 5')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Team 2 details' }))
    expect(screen.getByRole('region', { name: 'AI team summary' })).toHaveTextContent('Reached early')
    expect(screen.getByRole('button', { name: 'Rewrite' })).toBeInTheDocument()
  })

  it('shows a DeepSeek error without wiping the sheet', async () => {
    vi.mocked(requestAiDraftGrade).mockRejectedValue(new Error('DeepSeek is not configured on this project.'))
    const user = userEvent.setup()
    render(<DraftGrades session={session()} picks={picks} players={players} />)
    await user.click(screen.getByRole('button', { name: 'AI summary' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('DeepSeek is not configured on this project.')
    expect(teamRows()).toHaveLength(4)
  })
})
