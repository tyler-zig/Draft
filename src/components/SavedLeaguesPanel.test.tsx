import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SavedLeaguesPanel } from './SavedLeaguesPanel'
import type { SavedLeague } from '../leagues/savedLeagues'

function league(overrides: Partial<SavedLeague> = {}): SavedLeague {
  return {
    provider: 'sleeper', leagueId: 'L1', season: '2026', name: 'Dynasty', draftId: 'D1',
    externalUserId: 'u1', teamName: 'My Team', scoringType: 'ppr', teamCount: 12,
    lastOpenedAt: Date.now(), ...overrides,
  }
}

function renderPanel(leagues: SavedLeague[], overrides: Partial<React.ComponentProps<typeof SavedLeaguesPanel>> = {}) {
  const props = { leagues, selectedKey: null, onSelect: vi.fn(), ...overrides }
  render(<SavedLeaguesPanel {...props} />)
  return props
}

describe('SavedLeaguesPanel', () => {
  it('renders nothing before any league is saved', () => {
    const { container } = render(<SavedLeaguesPanel leagues={[]} selectedKey={null} onSelect={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('selects a league instead of jumping straight into the room', async () => {
    const user = userEvent.setup()
    const props = renderPanel([league()])
    await user.click(screen.getByRole('button', { name: /Dynasty/ }))
    expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L1' }))
  })

  it('cannot mark a league ready when it has no draft yet', () => {
    renderPanel([league({ draftId: null })])
    expect(screen.getByText('No draft yet')).toBeInTheDocument()
  })

  it('marks the selected league in the list', () => {
    renderPanel([league()], { selectedKey: 'sleeper:L1:2026' })
    expect(screen.getByRole('button', { name: /Dynasty/ })).toHaveAttribute('aria-current', 'true')
  })

  it('describes each league without needing the provider re-queried', () => {
    renderPanel([league({ provider: 'espn', teamName: 'Gridiron Gal', lastOpenedAt: 0 })])
    expect(screen.getByText(/ESPN · Gridiron Gal · Not opened yet/)).toBeInTheDocument()
  })
})
