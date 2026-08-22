import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Recommendation } from '../draft/recommend'
import type { Player } from '../providers/types'
import { BestAvailable } from './BestAvailable'

function player(overrides: Partial<Player> & { id: string; fullName: string }): Player {
  return {
    firstName: overrides.fullName.split(' ')[0] ?? overrides.id,
    lastName: overrides.fullName.split(' ').slice(1).join(' ') || '',
    position: 'RB',
    team: 'CHI',
    searchRank: 20,
    injuryStatus: null,
    number: null,
    yearsExp: null,
    bye: null,
    ...overrides,
  }
}

function rec(overrides: Partial<Recommendation> & { player: Player }): Recommendation {
  return {
    score: 100,
    reason: 'Best available',
    reasons: ['Best available'],
    breakdown: [],
    survivalProbability: null,
    ...overrides,
  }
}

describe('BestAvailable', () => {
  it('shows the featured pick and other recommended players', () => {
    render(
      <BestAvailable
        currentPickNo={12}
        onSelect={vi.fn()}
        recs={[
          rec({ player: player({ id: '1', fullName: 'Featured Back', position: 'RB', adp: 8 }), reason: 'Fill RB', reasons: ['Fill RB'] }),
          rec({ player: player({ id: '2', fullName: 'Alt Receiver', position: 'WR' }), reason: 'Fill WR', reasons: ['Fill WR'] }),
          rec({ player: player({ id: '3', fullName: 'Alt Tight End', position: 'TE' }), reason: 'Last Tier 3 TE', reasons: ['Last Tier 3 TE'] }),
        ]}
      />,
    )

    expect(screen.getByRole('button', { name: /Featured Back/ })).toBeInTheDocument()
    expect(screen.getByText('Also consider')).toBeInTheDocument()
    expect(screen.getByText('Alt Receiver')).toBeInTheDocument()
    expect(screen.getByText('Fill WR')).toBeInTheDocument()
    expect(screen.getByText('Alt Tight End')).toBeInTheDocument()
    expect(screen.getByText('Last Tier 3 TE')).toBeInTheDocument()
  })

  it('opens a listed alternative from the also-consider list', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <BestAvailable
        currentPickNo={4}
        onSelect={onSelect}
        recs={[
          rec({ player: player({ id: '1', fullName: 'Featured Back' }) }),
          rec({ player: player({ id: '2', fullName: 'Alt Receiver', position: 'WR' }), reason: 'Fill WR', reasons: ['Fill WR'] }),
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Alt Receiver/ }))
    expect(onSelect).toHaveBeenCalledWith('2')
  })

  it('shows a long name and reason in full', () => {
    render(
      <BestAvailable
        currentPickNo={20}
        onSelect={vi.fn()}
        recs={[
          rec({ player: player({ id: '1', fullName: 'Featured Back' }) }),
          rec({
            player: player({ id: '2', fullName: 'Christian McCaffrey', position: 'RB' }),
            reason: '72% gone by next pick',
            reasons: ['72% gone by next pick'],
          }),
        ]}
      />,
    )

    expect(screen.getByText('Christian McCaffrey')).toBeInTheDocument()
    expect(screen.getByText('72% gone by next pick')).toBeInTheDocument()
  })

  it('marks an IR featured pick with the unavailable status', () => {
    render(
      <BestAvailable
        currentPickNo={12}
        onSelect={vi.fn()}
        recs={[rec({ player: player({ id: '1', fullName: 'IR Back', injuryStatus: 'IR' }) })]}
      />,
    )
    const dot = screen.getByRole('button', { name: /IR Back/ }).querySelector('.cc-status')
    expect(dot).toHaveClass('cc-out')
    expect(dot).toHaveAttribute('title', 'IR')
  })

  it('renders an empty state when nobody is left', () => {
    render(<BestAvailable recs={[]} currentPickNo={1} onSelect={vi.fn()} />)
    expect(screen.getByText('No players available.')).toBeInTheDocument()
    expect(screen.queryByText('Also consider')).not.toBeInTheDocument()
  })
})
