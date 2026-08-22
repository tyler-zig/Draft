import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectPage } from './ConnectPage'
import type { SavedLeague } from '../leagues/savedLeagues'

vi.mock('../espn/useEspnBridge', () => ({
  useEspnBridge: () => ({ installed: false, hydrated: true, snapshot: null, refresh: vi.fn() }),
}))

vi.mock('../sites/useSiteBridge', () => ({
  useSiteBridge: () => ({ installed: false, hydrated: true, snapshot: null, refresh: vi.fn() }),
}))

vi.mock('../supabase/AuthProvider', () => ({
  useAuth: () => ({
    configured: true, ready: true, syncing: false, session: { user: { id: 'u1' } },
    user: { id: 'u1', email: 'drafter@example.com' }, error: null,
    signInWithEmail: async () => {}, signInWithPassword: async () => {},
    signUpWithPassword: async () => ({ needsConfirmation: false }),
    sendPasswordReset: async () => {}, signOut: async () => {},
  }),
}))

vi.mock('../leagues/useSavedLeagues', async () => {
  const { useState } = await import('react')
  const saved = await import('../leagues/savedLeagues')
  return {
    useSavedLeagues() {
      const [leagues, setLeagues] = useState(() => {
        try {
          return saved.parseSavedLeagues(JSON.parse(localStorage.getItem('draft-assistant:saved-leagues') ?? 'null'))
        } catch {
          return []
        }
      })
      return {
        leagues,
        remember(league: SavedLeague) {
          setLeagues((current) => {
            const next = saved.upsertSavedLeague(current, league)
            localStorage.setItem('draft-assistant:saved-leagues', JSON.stringify(next))
            return next
          })
        },
        forget(league: SavedLeague | string) {
          setLeagues((current) => {
            const key = typeof league === 'string' ? league : saved.savedLeagueKey(league)
            const next = saved.removeSavedLeague(current, key)
            localStorage.setItem('draft-assistant:saved-leagues', JSON.stringify(next))
            return next
          })
        },
      }
    },
  }
})

vi.mock('../providers/sleeperProvider', () => ({
  sleeperProvider: {
    getLeagues: vi.fn(async () => ({
      user: { userId: 'u1', username: 'tziegler', displayName: 'Tyler' },
      leagues: [{
        id: 'L2', name: 'Redraft Royale', season: '2026', teamCount: 14, status: 'pre_draft',
        scoringType: 'half_ppr', draftId: 'D2', draftStatus: 'pre_draft', avatar: null,
      }],
    })),
    getPlayers: vi.fn(async () => []),
  },
}))

function saved(overrides: Partial<SavedLeague> = {}): SavedLeague {
  return {
    provider: 'sleeper', leagueId: 'L1', season: '2026', name: 'The Money League', draftId: 'D1',
    externalUserId: 'u1', teamName: 'My Team', scoringType: 'ppr', teamCount: 12,
    lastOpenedAt: 1, ...overrides,
  }
}

function renderPage() {
  return render(<MemoryRouter><ConnectPage /></MemoryRouter>)
}

describe('ConnectPage', () => {
  beforeEach(() => localStorage.clear())

  it('opens the selected saved league from the launch pad', () => {
    localStorage.setItem('draft-assistant:saved-leagues', JSON.stringify([saved()]))
    renderPage()
    expect(screen.getByRole('heading', { name: 'The Money League' })).toBeInTheDocument()
    const pane = screen.getByRole('heading', { name: 'The Money League' }).closest('.lg-pane')
    expect(pane).toBeTruthy()
    expect(within(pane as HTMLElement).getByRole('link', { name: 'Open draft room' })).toHaveAttribute('href', '/draft/sleeper/D1?userId=u1')
    expect(within(pane as HTMLElement).getByRole('link', { name: 'Players' })).toHaveAttribute('href', '/players?scoring=ppr&provider=sleeper&leagueId=L1&draftId=D1')
  })

  it('forgets the selected league and returns to the empty lobby', async () => {
    const user = userEvent.setup()
    localStorage.setItem('draft-assistant:saved-leagues', JSON.stringify([saved()]))
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Forget The Money League' }))
    expect(screen.queryByText('The Money League')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Connect a draft to sit next to.' })).toBeInTheDocument()
  })

  it('offers Yahoo and NFL.com on the add pane', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /Add a league/ }))
    expect(screen.getByRole('button', { name: 'Yahoo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'NFL.com' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yahoo' }))
    expect(screen.getByText(/Load unpacked/)).toBeInTheDocument()
  })

  it('keeps Sleeper lookup on the add pane', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /Add a league/ }))
    await user.type(screen.getByLabelText('Username'), 'tziegler')
    await user.click(screen.getByRole('button', { name: 'Find leagues' }))
    expect(await screen.findByText('Redraft Royale')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enter' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('pins a found Sleeper league without entering the room', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /Add a league/ }))
    await user.type(screen.getByLabelText('Username'), 'tziegler')
    await user.click(screen.getByRole('button', { name: 'Find leagues' }))
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    expect(screen.getByRole('heading', { name: 'Redraft Royale' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open draft room' })).toHaveAttribute('href', '/draft/sleeper/D2?userId=u1')
  })
})
