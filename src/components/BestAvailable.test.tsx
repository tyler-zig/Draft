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

  it('expands an also-consider pick and closes the featured stats', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <BestAvailable
        currentPickNo={20}
        onSelect={onSelect}
        recs={[
          rec({ player: player({ id: '1', fullName: 'Featured Back', liveAdp: 10, projectedPoints: 240 }) }),
          rec({
            player: player({ id: '2', fullName: 'Alt Receiver', position: 'WR', liveAdp: 35, projectedPoints: 180 }),
            reason: 'Fill WR',
            reasons: ['Fill WR'],
            score: 44,
            breakdown: [
              { label: 'Projected value (VORP)', delta: 30 },
              { label: 'Fill WR', delta: 14 },
            ],
          }),
          rec({
            player: player({ id: '3', fullName: 'Alt Tight End', position: 'TE', liveAdp: 50 }),
            reason: 'Last TE',
            reasons: ['Last TE'],
          }),
        ]}
      />,
    )

    expect(screen.getByText('+10.0')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand Featured Back suggestion' })).not.toBeInTheDocument()
    expect(screen.queryByText('-15.0')).not.toBeInTheDocument()
    expect(screen.queryByText('Why this score (44)')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand Alt Receiver suggestion' }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByText('+10.0')).not.toBeInTheDocument()
    expect(screen.getByText('-15.0')).toBeInTheDocument()
    expect(screen.getByText('Why this score (44)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand Featured Back suggestion' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand Alt Tight End suggestion' }))
    expect(screen.queryByText('-15.0')).not.toBeInTheDocument()
    expect(screen.getByText('-30.0')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand Featured Back suggestion' }))
    expect(screen.getByText('+10.0')).toBeInTheDocument()
    expect(screen.queryByText('-30.0')).not.toBeInTheDocument()
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

    await user.click(screen.getByText('Alt Receiver').closest('button')!)
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

  it('titles the card for the next seat when that pick is still ahead', () => {
    render(
      <BestAvailable
        currentPickNo={5}
        targetPickNo={17}
        onSelect={vi.fn()}
        recs={[rec({ player: player({ id: '1', fullName: 'Later Back' }), reason: 'Likely there at your pick', reasons: ['Likely there at your pick'] })]}
      />,
    )
    expect(screen.getByText('Best at pick 17')).toBeInTheDocument()
    expect(screen.getByText('Likely there at your pick')).toBeInTheDocument()
  })

  it('colors value vs live ADP green for a steal and red for a reach', () => {
    const { rerender } = render(
      <BestAvailable
        currentPickNo={40}
        onSelect={vi.fn()}
        recs={[rec({ player: player({ id: '1', fullName: 'Value Back', liveAdp: 22 }) })]}
      />,
    )
    expect(screen.getByText('+18.0')).toHaveClass('cc-green')

    rerender(
      <BestAvailable
        currentPickNo={12}
        onSelect={vi.fn()}
        recs={[rec({ player: player({ id: '1', fullName: 'Reach Back', liveAdp: 28 }) })]}
      />,
    )
    expect(screen.getByText('-16.0')).toHaveClass('cc-red')
    expect(screen.getByText('-16.0')).not.toHaveClass('cc-green')
  })

  it('renders an empty state when nobody is left', () => {
    render(<BestAvailable recs={[]} currentPickNo={1} onSelect={vi.fn()} />)
    expect(screen.getByText('No players available.')).toBeInTheDocument()
    expect(screen.queryByText('Also consider')).not.toBeInTheDocument()
  })
})
