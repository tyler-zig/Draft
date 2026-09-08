import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PlayerMarketHistory, PlayerMarketHistoryPoint } from '../api/playerIntelligence'
import { MarketHistory } from './MarketHistory'

const point = (overrides: Partial<PlayerMarketHistoryPoint>): PlayerMarketHistoryPoint => ({
  at: 100, rank: 10, adp: 12, liveAdp: null, low: 8, high: 14, sourceCount: 3, ...overrides,
})

const history = (points: PlayerMarketHistoryPoint[]): PlayerMarketHistory => ({
  points, source: 'Collected ranking median and FantasyPros live ADP', generatedAt: 200, message: null,
})

describe('MarketHistory', () => {
  it('plots live ADP once two live observations exist', () => {
    render(<MarketHistory history={history([
      point({ at: 100, adp: 20, liveAdp: 10 }),
      point({ at: 200, adp: 21, liveAdp: 9 }),
    ])} />)
    expect(screen.getByText('Live ADP history')).toBeInTheDocument()
    expect(screen.getByText('Now 9')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Live ADP history from .*9 to 10/ })).toBeInTheDocument()
    expect(screen.getByText('9.5')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
  })

  it('does not start a Live ADP series from one collected point plus the room board', () => {
    render(<MarketHistory
      history={history([point({ at: 100, adp: 20, liveAdp: 12 })])}
      live={{ at: 300, value: 11 }}
    />)
    expect(screen.queryByText('Live ADP history')).not.toBeInTheDocument()
    expect(screen.getByText(/At least two collected observations/)).toBeInTheDocument()
  })

  it('appends the room live value once two collected live-ADP snapshots exist', () => {
    render(<MarketHistory
      history={history([
        point({ at: 100, liveAdp: 12 }),
        point({ at: 200, liveAdp: 10 }),
      ])}
      live={{ at: 300, value: 9 }}
    />)
    expect(screen.getByText('Live ADP history')).toBeInTheDocument()
    expect(screen.getByText('Now 9')).toBeInTheDocument()
  })

  it('ignores a live value older than the newest observation', () => {
    render(<MarketHistory
      history={history([
        point({ at: 100, liveAdp: 12 }),
        point({ at: 200, liveAdp: 10 }),
      ])}
      live={{ at: 150, value: 99 }}
    />)
    expect(screen.getByText('Now 10')).toBeInTheDocument()
  })

  it('keeps reported ADP while live observations have not accumulated', () => {
    render(<MarketHistory history={history([
      point({ at: 100, adp: 12, liveAdp: null }),
      point({ at: 200, adp: 13, liveAdp: null }),
    ])} />)
    expect(screen.getByText('ADP history')).toBeInTheDocument()
    expect(screen.getByText('Now 13')).toBeInTheDocument()
  })

  it('falls back to consensus rank when no ADP is reported at all', () => {
    render(<MarketHistory history={history([
      point({ at: 100, adp: null, rank: 8 }),
      point({ at: 200, adp: null, rank: 7 }),
    ])} />)
    expect(screen.getByText('Consensus rank history')).toBeInTheDocument()
  })

  it('labels the ADP scale from the observed high, midpoint, and low', () => {
    render(<MarketHistory history={history([
      point({ at: 100, liveAdp: 12.4 }),
      point({ at: 200, liveAdp: 8 }),
    ])} />)
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('10.2')).toBeInTheDocument()
    expect(screen.getByText('12.4')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /8 to 12.4/ })).toBeInTheDocument()
  })

  it('says so when the live board position has not moved', () => {
    render(<MarketHistory history={history([
      point({ at: 100, liveAdp: 6 }),
      point({ at: 200, liveAdp: 6 }),
    ])} />)
    expect(screen.getByText(/Live ADP has not moved — 6 across 2 observations/)).toBeInTheDocument()
  })
})
