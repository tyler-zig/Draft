import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Player } from '../providers/types'
import type { ExpertSnapshot } from '../rankings/experts'
import { ExpertRankingsPanel } from './ExpertRankingsPanel'

const mocks = vi.hoisted(() => ({
  settings: { enabledIds: ['builtin:sleeper', 'collected:fantasypros-half'], method: 'median' as const },
  save: vi.fn(), installExperts: vi.fn(), fetchExperts: vi.fn(),
}))

const snapshot: ExpertSnapshot = {
  schemaVersion: 1, scoring: 'half', fetchedAt: 300, expertCount: 2, playerCount: 2, failures: [], players: {},
  experts: [
    { slug: 'alpha', name: 'Alex Alpha', outlet: 'Gridiron Lab', fetchedAt: 100, count: 320, ranks: [] },
    { slug: 'beta', name: 'Blair Beta', outlet: 'Sunday Data', fetchedAt: 200, count: 315, ranks: [] },
  ],
}

vi.mock('../rankings/experts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rankings/experts')>()
  return { ...actual, fetchExpertSnapshot: mocks.fetchExperts, installExpertSets: mocks.installExperts }
})
vi.mock('../rankings/store', () => ({
  loadRankSettings: () => mocks.settings,
  saveRankSettings: (settings: typeof mocks.settings) => { mocks.settings = settings; mocks.save(settings) },
  loadImportedSets: vi.fn(async () => []),
}))
vi.mock('../rankings/collected', () => ({ fetchCollectedSnapshot: vi.fn(), installCollectedSets: vi.fn() }))
vi.mock('../providers/sleeperProvider', () => ({ sleeperProvider: { getPlayers: vi.fn(async () => []) } }))

const directory: Player[] = [{ id: '1', sleeperId: '1', firstName: 'A', lastName: 'Player', fullName: 'A Player', position: 'RB', team: 'CHI', searchRank: 1, injuryStatus: null, number: null, yearsExp: 1, bye: 10 }]

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ExpertRankingsPanel leagueScoring="half_ppr" directory={directory} onChange={vi.fn()} /></QueryClientProvider>)
}

describe('ExpertRankingsPanel', () => {
  beforeEach(() => {
    mocks.settings = { enabledIds: ['builtin:sleeper', 'collected:fantasypros-half'], method: 'median' }
    mocks.save.mockClear(); mocks.installExperts.mockReset(); mocks.fetchExperts.mockReset()
    mocks.fetchExperts.mockResolvedValue(snapshot)
    mocks.installExperts.mockResolvedValue([{ id: 'expert:half:alpha' }])
  })

  it('detects scoring, filters experts, and installs a mutually exclusive selection', async () => {
    const user = userEvent.setup()
    renderPanel()
    expect(screen.getByText('Detected from your league')).toBeInTheDocument()
    await waitFor(() => expect(mocks.fetchExperts).toHaveBeenCalledWith('half', expect.any(AbortSignal)))
    await user.click(screen.getByRole('button', { name: 'Individual experts' }))
    expect(await screen.findByText('Alex Alpha')).toBeInTheDocument()
    expect(screen.getByText('Gridiron Lab · 320 players')).toBeInTheDocument()
    expect(screen.getByText(/Oldest board synced/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Search experts'), 'Gridiron')
    expect(screen.getByText('Alex Alpha')).toBeInTheDocument()
    expect(screen.queryByText('Blair Beta')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText(/Alex Alpha/))
    await user.click(screen.getByRole('button', { name: 'Use 1 selected expert' }))
    await waitFor(() => expect(mocks.installExperts).toHaveBeenCalledWith(snapshot, ['alpha'], expect.any(Array)))
    expect(mocks.save).toHaveBeenCalledWith({ enabledIds: ['builtin:sleeper', 'expert:half:alpha'], method: 'median' })
  })

  it('hides the scoring banner when the sheet owns format', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ExpertRankingsPanel leagueScoring="half_ppr" directory={directory} onChange={vi.fn()} hideScoringBanner scoring="half" /></QueryClientProvider>)
    expect(screen.queryByLabelText('Expert scoring format')).not.toBeInTheDocument()
    expect(screen.queryByText('Detected from your league')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Individual experts' }))
    expect(await screen.findByText('Alex Alpha')).toBeInTheDocument()
  })

  it('supports a manual scoring override', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByLabelText('Expert scoring format'))
    await user.click(screen.getByRole('option', { name: /^PPR$/ }))
    expect(screen.getByText('Manual scoring override')).toBeInTheDocument()
    await waitFor(() => expect(mocks.fetchExperts).toHaveBeenCalledWith('ppr', expect.any(AbortSignal)))
  })
})
