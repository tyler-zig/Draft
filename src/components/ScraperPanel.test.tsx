import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScraperPanel } from './ScraperPanel'
import { NoCollectorError } from '../rankings/scraperApi'

const NOW = Date.parse('2026-08-22T20:50:00.000Z')

vi.mock('../rankings/scraperApi', async () => {
  const actual = await vi.importActual<typeof import('../rankings/scraperApi')>('../rankings/scraperApi')
  return {
    ...actual,
    getScrapeStatus: vi.fn(),
    startScrape: vi.fn(),
  }
})

vi.mock('../rankings/collected', async () => {
  const actual = await vi.importActual<typeof import('../rankings/collected')>('../rankings/collected')
  return {
    ...actual,
    fetchCollectedSnapshot: vi.fn(),
    installCollectedSets: vi.fn(),
  }
})

vi.mock('../rankings/liveAdp', async () => {
  const actual = await vi.importActual<typeof import('../rankings/liveAdp')>('../rankings/liveAdp')
  return {
    ...actual,
    fetchLiveAdpSnapshot: vi.fn(),
  }
})

vi.mock('../supabase/artifacts', async () => {
  const actual = await vi.importActual<typeof import('../supabase/artifacts')>('../supabase/artifacts')
  return { ...actual, clearArtifactVersionCache: vi.fn() }
})

import { getScrapeStatus } from '../rankings/scraperApi'
import { fetchCollectedSnapshot } from '../rankings/collected'
import { fetchLiveAdpSnapshot } from '../rankings/liveAdp'

describe('ScraperPanel hosted collector', () => {
  beforeEach(() => {
    vi.mocked(getScrapeStatus).mockRejectedValue(new NoCollectorError())
    vi.mocked(fetchCollectedSnapshot).mockResolvedValue({
      schemaVersion: 2,
      fetchedAt: NOW - 9 * 60 * 60 * 1000,
      stats: { sets: 3, rows: 1900, players: 400 },
      sets: [
        { id: 'fantasypros-half', label: 'FP Half', scoring: 'half', sourceUrl: '', fetchedAt: 1, rows: [{ name: 'A', team: 'CHI', position: 'RB', espnId: '1' }] },
        { id: 'fantasypros-ppr', label: 'FP PPR', scoring: 'ppr', sourceUrl: '', fetchedAt: 1, rows: [] },
        { id: 'rotowire-consensus-ppr-ov', label: 'RW', scoring: 'ppr', sourceUrl: '', fetchedAt: 1, rows: [] },
      ],
    })
    vi.mocked(fetchLiveAdpSnapshot).mockResolvedValue({
      fetchedAt: NOW - 12 * 60 * 1000,
      rows: [{ name: 'A', team: 'CHI', position: 'RB', adp: 7.2 }],
      sets: [
        { id: 'fantasypros-rtadp', scoring: 'half', rows: [{ name: 'A', team: 'CHI', position: 'RB', adp: 7.2 }] },
        { id: 'fantasypros-rtadp-ppr', scoring: 'ppr', rows: [{ name: 'A', team: 'CHI', position: 'RB', adp: 8 }] },
      ],
    })
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows Real-Time ADP and the 15-minute snapshot age on a hosted build', async () => {
    render(<ScraperPanel directory={[]} onChange={() => undefined} />)

    expect(await screen.findByText('FantasyPros Real-Time ADP')).toBeInTheDocument()
    expect(screen.getByText(/2 format boards · hosted every 15 minutes/)).toBeInTheDocument()
    expect(screen.getByText(/Boards 9h ago/)).toBeInTheDocument()
    expect(screen.getByText(/Live ADP 12m ago/)).toBeInTheDocument()
    expect(screen.queryByText(/npm run dev/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load into rankings' })).toBeEnabled()
  })

  it('still lists Real-Time ADP when the dedicated artifact is missing', async () => {
    vi.mocked(fetchLiveAdpSnapshot).mockResolvedValue(null)
    render(<ScraperPanel directory={[]} onChange={() => undefined} />)

    expect(await screen.findByText('FantasyPros Real-Time ADP')).toBeInTheDocument()
    expect(screen.getByText('Hosted every 15 minutes · not published yet')).toBeInTheDocument()
  })
})
