import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Player } from '../providers/types'
import { PlayerIntelligence } from './PlayerIntelligence'
import { getPlayerNews } from '../api/playerIntelligence'
import { loadImportedSets, loadRankSettings } from '../rankings/store'

vi.mock('../api/playerIntelligence', async () => {
  const actual = await vi.importActual<typeof import('../api/playerIntelligence')>('../api/playerIntelligence')
  const points = [{ at: 1, rank: 9, adp: 10, liveAdp: null, low: 5, high: 13, sourceCount: 3 }, { at: 2, rank: 8, adp: 9, liveAdp: null, low: 4, high: 12, sourceCount: 4 }]
  const catalog = {
    source: 'Collected ranking median',
    generatedAt: 3,
    message: null,
    byEspnId: new Map([['101', points]]),
    byNamePosTeam: new Map([['real player|RB|CHI', points]]),
    byNamePos: new Map([['real player|RB', points]]),
  }
  return {
    ...actual,
    getRankingHistoryCatalog: vi.fn(async () => catalog),
    getPlayerMarketHistory: vi.fn(async () => ({ source: catalog.source, generatedAt: 3, message: null, points })),
    getPlayerNews: vi.fn(async () => ({
      newsMessage: null,
      news: [
        { id: 'rotowire', headline: 'Held out of Saturday’s preseason game.', description: 'The team is exercising caution after last year’s knee injury.', published: '2026-08-20T14:48:44.000Z', url: 'https://www.espn.com/nfl/player/news/_/id/101', source: 'RotoWire' },
        { id: 'espn-1', headline: 'Training camp updates', description: 'Catch up on camp.', published: '2026-08-20T18:25:25.000Z', url: 'https://www.espn.com/nfl/story/_/id/1', source: 'ESPN' },
      ],
    })),
    getPlayerIntelligence: vi.fn(async () => ({
      stats: [], statsMessage: null, newsMessage: null,
      news: [
        { id: 'rotowire', headline: 'Held out of Saturday’s preseason game.', description: 'The team is exercising caution after last year’s knee injury.', published: '2026-08-20T14:48:44.000Z', url: 'https://www.espn.com/nfl/player/news/_/id/101', source: 'RotoWire' },
        { id: 'espn-1', headline: 'Training camp updates', description: 'Catch up on camp.', published: '2026-08-20T18:25:25.000Z', url: 'https://www.espn.com/nfl/story/_/id/1', source: 'ESPN' },
      ],
      marketHistory: { source: 'Collected ranking median', generatedAt: 3, message: null, points: [] },
      historical: { source: 'Data: nflverse', updatedAt: '2026-08-22T00:00:00Z', methodology: {}, message: null, schedule: null, seasons: [], scheduleModel: null },
    })),
  }
})
vi.mock('../rankings/liveAdp', async () => {
  const actual = await vi.importActual<typeof import('../rankings/liveAdp')>('../rankings/liveAdp')
  return {
    ...actual,
    liveAdpQuery: {
      queryKey: ['rankings', 'adp-latest'] as const,
      // A board just collected: the freshness guard drops anything older.
      queryFn: async () => ({ fetchedAt: Date.now(), rows: [{ name: 'Real Player', team: 'CHI', position: 'RB', adp: 7.2, espnId: '101' }] }),
      staleTime: 3_600_000,
      retry: false as const,
    },
  }
})
vi.mock('../api/playerProjections', async () => {
  const actual = await vi.importActual<typeof import('../api/playerProjections')>('../api/playerProjections')
  return {
    ...actual,
    getNflProjections: vi.fn(async () => new Map([
      ['one', {
        sleeperId: 'one',
        season: '2026',
        games: 17,
        stats: { gp: 17, pts_ppr: 250, pts_half_ppr: 230, pts_std: 210, rush_att: 280, rec: 40, adp_ppr: 8.4, adp_half_ppr: 9.6, adp_std: 11.2 },
        pointsPpr: 250,
        pointsHalf: 230,
        pointsStd: 210,
        adp: null,
        adpPpr: 8.4,
        adpHalf: 9.6,
        adpStd: 11.2,
        source: 'RotoWire via Sleeper',
        updatedAt: Date.parse('2026-08-20T12:00:00.000Z'),
      }],
      ['rb2', {
        sleeperId: 'rb2',
        season: '2026',
        games: 17,
        stats: { gp: 17, pts_ppr: 100, pts_half_ppr: 90, pts_std: 80, rush_att: 140, rec: 20 },
        pointsPpr: 100,
        pointsHalf: 90,
        pointsStd: 80,
        adp: null,
        adpPpr: 40.2,
        adpHalf: 42.1,
        adpStd: 45.0,
        source: 'RotoWire via Sleeper',
        updatedAt: Date.parse('2026-08-20T12:00:00.000Z'),
      }],
      ['rb3', {
        sleeperId: 'rb3',
        season: '2026',
        games: 17,
        stats: { gp: 17, pts_ppr: 80, pts_half_ppr: 70, pts_std: 60, rush_att: 110, rec: 15 },
        pointsPpr: 80,
        pointsHalf: 70,
        pointsStd: 60,
        adp: null,
        adpPpr: 50.5,
        adpHalf: 52.0,
        adpStd: 55.0,
        source: 'RotoWire via Sleeper',
        updatedAt: Date.parse('2026-08-20T12:00:00.000Z'),
      }],
    ])),
  }
})
vi.mock('../api/playerHistorical', async () => {
  const actual = await vi.importActual<typeof import('../api/playerHistorical')>('../api/playerHistorical')
  const teams = {
    CHI: [{ week: 1, opponent: 'MIN', home: true, bye: false, completed: false }, { week: 2, opponent: 'GB', home: false, bye: false, completed: false }, { week: 3, opponent: 'DET', home: true, bye: false, completed: false }, { week: 4, opponent: null, home: false, bye: true, completed: false }],
    GB: [{ week: 1, opponent: 'CHI', home: false, bye: false, completed: false }],
  }
  return {
    ...actual,
    getPublishedSchedule: vi.fn(async () => teams),
    getPlayerHistoricalIntelligence: vi.fn(async () => ({
      source: 'Data: nflverse', updatedAt: '2026-08-22T00:00:00Z', methodology: {}, message: null, schedule: null,
      seasons: [{ season: 2025, gamesPlayed: 16, stats: { fantasyPoints: 200, fantasyPointsPpr: 250 }, weekly: [{ week: 1, opponent: 'GB', fantasyPoints: 10, fantasyPointsPpr: 15 }], usage: { opportunities: 200, touchShare: 0.25, redZoneTouchShare: 0.3, snapShare: 0.7 }, durability: { gamesMissed: 1, missedWeeks: [2], byStatus: { ACT: 1 } } }],
      scheduleModel: {
        season: 2026, source: 'Data: nflverse', updatedAt: '2026-08-22T00:00:00Z',
        teams,
        window: { priorSeason: 2025, currentSeason: 2026, currentGames: 0, priorWeight: 1, currentWeight: 0, minSample: 4 },
        matchups: { ppr: { RB: { MIN: { team: 'MIN', rank: 8, pointsAllowed: 24, games: 17 }, GB: { team: 'GB', rank: 22, pointsAllowed: 16, games: 17 }, DET: { team: 'DET', rank: 14, pointsAllowed: 20, games: 17 } }, WR: { CHI: { team: 'CHI', rank: 12, pointsAllowed: 22, games: 17 } } }, half: { RB: { MIN: { team: 'MIN', rank: 8, pointsAllowed: 22, games: 17 } }, WR: {} }, standard: { RB: {}, WR: {} } },
        strengthOfSchedule: { ppr: { RB: { CHI: { team: 'CHI', rank: 11, averageMatchupRank: 14.7, remainingGames: 3 } }, WR: { GB: { team: 'GB', rank: 18, averageMatchupRank: 12, remainingGames: 1 } } }, half: { RB: { CHI: { team: 'CHI', rank: 11, averageMatchupRank: 14.7, remainingGames: 3 } }, WR: {} }, standard: { RB: {}, WR: {} } },
      },
    })),
  }
})

const players: Player[] = [
  { id: 'one', sleeperId: 'one', espnId: '101', firstName: 'Real', lastName: 'Player', fullName: 'Real Player', position: 'RB', team: 'CHI', searchRank: 8, injuryStatus: null, number: '22', yearsExp: 3, bye: 7, age: 26, height: `5'11"`, weight: 214 },
  { id: 'two', sleeperId: 'two', firstName: 'Missing', lastName: 'Fields', fullName: 'Missing Fields', position: 'WR', team: 'GB', searchRank: 14, injuryStatus: 'QUESTIONABLE', number: null, yearsExp: null, bye: null, age: null, height: null, weight: null },
  { id: 'ir1', sleeperId: 'ir1', firstName: 'Reserve', lastName: 'Case', fullName: 'Reserve Case', position: 'WR', team: 'SF', searchRank: 16, injuryStatus: 'IR', number: null, yearsExp: 2, bye: 9, age: null, height: null, weight: null },
  { id: 'rb2', sleeperId: 'rb2', firstName: 'Backup', lastName: 'Back', fullName: 'Backup Back', position: 'RB', team: 'MIN', searchRank: 40, injuryStatus: null, number: null, yearsExp: 2, bye: 6, age: null, height: null, weight: null },
  { id: 'rb3', sleeperId: 'rb3', firstName: 'Deep', lastName: 'Back', fullName: 'Deep Back', position: 'RB', team: 'DET', searchRank: 50, injuryStatus: null, number: null, yearsExp: 1, bye: 5, age: null, height: null, weight: null },
  { id: 'hou', sleeperId: 'HOU', espnId: '34', firstName: 'Houston', lastName: 'Texans', fullName: 'Houston Texans', position: 'DEF', team: 'HOU', searchRank: 180, injuryStatus: null, number: null, yearsExp: null, bye: 8, age: null, height: null, weight: null },
]

vi.mock('../providers/sleeperProvider', () => ({ sleeperProvider: { getPlayers: vi.fn(async () => players) } }))
vi.mock('../rankings/store', () => ({
  loadImportedSets: vi.fn(async () => [
    { id: 'source:a', label: 'Source A', scoring: 'ppr', kind: 'import', fetchedAt: 10, unmatched: [], rows: [{ playerId: 'one', name: 'Real Player', team: 'CHI', position: 'RB', overall: 5 }] },
    { id: 'source:b', label: 'Source B', scoring: 'ppr', kind: 'import', fetchedAt: 20, unmatched: [], rows: [{ playerId: 'one', name: 'Real Player', team: 'CHI', position: 'RB', overall: 11 }] },
    { id: 'expert:ppr:disabled-analyst', label: 'Disabled Analyst', scoring: 'ppr', kind: 'import', fetchedAt: 20, unmatched: [], rows: [{ playerId: 'one', name: 'Real Player', team: 'CHI', position: 'RB', overall: 9 }] },
  ]),
  loadRankSettings: vi.fn(() => ({ enabledIds: ['source:a', 'source:b'], method: 'median' })),
}))
vi.mock('../rankings/collected', async () => {
  const actual = await vi.importActual<typeof import('../rankings/collected')>('../rankings/collected')
  return { ...actual, fetchCollectedSnapshot: vi.fn(async () => null) }
})

function renderPage(entry = '/players?playerId=one') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}><PlayerIntelligence /></MemoryRouter></QueryClientProvider>)
}

describe('Player Intelligence sourcing', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.mocked(loadRankSettings).mockReturnValue({ enabledIds: ['source:a', 'source:b'], method: 'median' })
  })
  it('renders sourced identity and enabled ranking facts', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Real Player' })).toBeInTheDocument()
    expect(screen.getByText(`5'11"`)).toBeInTheDocument()
    expect(screen.getByText('214 lbs')).toBeInTheDocument()
    expect(screen.getByText('5 – 11')).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Real Player/ })).toHaveTextContent('5–11')
    expect(screen.getByRole('row', { name: /Real Player/ })).toHaveTextContent('↑ 1.0')
    expect(screen.getByRole('columnheader', { name: 'Live ADP' })).toBeInTheDocument()
    expect(await screen.findByRole('row', { name: /Real Player/ })).toHaveTextContent('7.2')
    expect(screen.getByText('Source A: 5')).toBeInTheDocument()
    expect(screen.getByText('Source B: 11')).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /ADP history/ })).toBeInTheDocument()
    expect(await screen.findByText('25.0%')).toBeInTheDocument()
    expect(screen.getByText('Games missed (2025)')).toBeInTheDocument()
    expect(screen.getByText('vs MIN')).toBeInTheDocument()
    expect(screen.getByText('@ GB')).toBeInTheDocument()
    expect(screen.getByText('vs DET')).toBeInTheDocument()
    expect(screen.getByLabelText('2026 CHI schedule')).toBeInTheDocument()
    expect(screen.getByText(/Bye 4/)).toBeInTheDocument()
    expect(screen.getByText('8th')).toBeInTheDocument()
    expect(screen.getByText('11th easiest')).toHaveClass('neutral')
    expect(await screen.findByRole('link', { name: 'Held out of Saturday’s preseason game.' })).toHaveAttribute('href', 'https://www.espn.com/nfl/player/news/_/id/101')
    expect(screen.getByText('The team is exercising caution after last year’s knee injury.')).toBeInTheDocument()
    expect(screen.getAllByText(/RotoWire/).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Training camp updates' })).toBeInTheDocument()
  })

  it('fills range from collected ranking history when the recipe has no expert spread', async () => {
    vi.mocked(loadRankSettings).mockReturnValue({ enabledIds: ['builtin:sleeper'], method: 'median' })
    vi.mocked(loadImportedSets).mockResolvedValueOnce([])
    renderPage()
    const row = await screen.findByRole('row', { name: /Real Player/ })
    expect(row).toHaveTextContent('4–12')
    expect(screen.getByText('Range', { selector: 'small' }).parentElement).toHaveTextContent('4 – 12')
  })

  it('keeps collapsed panels collapsed when switching players', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Real Player' })
    const newsToggle = screen.getByRole('button', { name: /Latest news/ })
    expect(newsToggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(newsToggle)
    expect(newsToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'Held out of Saturday’s preseason game.' })).not.toBeInTheDocument()

    await user.click(screen.getByText('Missing Fields'))
    expect(screen.getByRole('heading', { name: 'Missing Fields' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Latest news/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('The team is exercising caution after last year’s knee injury.')).not.toBeInTheDocument()
  })

  it('opens a player by ESPN id and fetches news with that profile', async () => {
    renderPage('/players?playerId=101')
    expect(await screen.findByRole('heading', { name: 'Real Player' })).toBeInTheDocument()
    expect(getPlayerNews).toHaveBeenCalledWith(expect.objectContaining({ id: 'one', espnId: '101' }), expect.anything())
    expect(await screen.findByRole('link', { name: 'Held out of Saturday’s preseason game.' })).toBeInTheDocument()
  })

  it('shows unavailable states instead of rank-derived projections and measurements', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Real Player' })
    await user.click(screen.getByText('Missing Fields'))
    expect(screen.getByRole('heading', { name: 'Missing Fields' })).toBeInTheDocument()
    expect(screen.getAllByText('UNAVAILABLE')).toHaveLength(5)
    expect(screen.getByText('Touch share')).toBeInTheDocument()
    expect(screen.getByText('@ CHI')).toBeInTheDocument()
    expect(screen.getByText('● QUESTIONABLE')).toHaveClass('warn')
    expect(screen.getByLabelText('QUESTIONABLE')).toHaveClass('cc-warn')
    expect(screen.getByLabelText('IR')).toHaveClass('cc-out')
  })

  it('marks IR as unavailable in the player detail', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Real Player' })
    await user.click(screen.getByText('Reserve Case'))
    expect(screen.getByText('● IR')).toHaveClass('down')
  })

  it('shows published Sleeper season projections instead of rank-derived numbers', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Real Player' })
    expect(screen.getByRole('columnheader', { name: 'VORP' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'ADP' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Real Player/ })).toHaveTextContent('8.4')
    expect(screen.getByText('ADP', { selector: 'small' }).parentElement).toHaveTextContent('8.4')
    expect(screen.getByText('Live ADP', { selector: 'small' }).parentElement).toHaveTextContent('7.2')
    expect(screen.getByText('Projected points').parentElement).toHaveTextContent('250')
    expect(screen.getByText('VORP', { selector: 'small' }).parentElement).toHaveTextContent('+170.0')
    expect(screen.getByText('Projected carries').parentElement).toHaveTextContent('280')
    expect(screen.getByText('Projected receptions').parentElement).toHaveTextContent('40')
    expect(screen.getByText('Projected PPG').parentElement).toHaveTextContent('14.7')
    expect(screen.getAllByText(/RotoWire via Sleeper/).length).toBeGreaterThan(0)
    expect(screen.getByText(/weekly chart is observed PPR history/)).toBeInTheDocument()
    expect(screen.getByText(/VORP is points above a replacement-level RB/)).toBeInTheDocument()
  })

  it('shows only active recipe sources and opens the ranking manager', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'Real Player' })
    expect(screen.queryByText('Disabled Analyst')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Manage' }))
    expect(screen.getByRole('dialog', { name: 'Rankings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'FantasyPros' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close rankings' })).toBeInTheDocument()
  })

  it('opens the complete season and weekly historical explorer', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('2025 weekly output')

    await user.click(screen.getByRole('button', { name: 'Explore seasons and weekly game logs' }))
    expect(screen.getByRole('dialog', { name: 'Real Player historical data' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Passing' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rushing' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Receiving' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Usage and durability' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '2025 weekly game log' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Carries' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close historical data' })).toBeInTheDocument()
  })

  it('lists defenses from the DEF filter even when they sit past the overall rank cap', async () => {
    const user = userEvent.setup()
    renderPage('/players')
    await screen.findByRole('row', { name: /Real Player/ })
    expect(screen.queryByRole('row', { name: /Houston Texans/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'DEF' }))
    const row = await screen.findByRole('row', { name: /Houston Texans/ })
    expect(row).toBeInTheDocument()
    await user.click(row)
    expect(screen.getByRole('heading', { name: 'Houston Texans' })).toBeInTheDocument()
  })

  it('inherits the current league context and links back to its draft', async () => {
    localStorage.setItem('draft-assistant:current-draft', JSON.stringify({
      provider: 'espn', draftId: '2026:123', leagueId: '123', leagueName: 'Home League', season: '2026', scoringType: 'half_ppr', draftType: 'snake', receptionPremium: null, userId: '7', href: '/draft/espn/2026%3A123?userId=7', updatedAt: 10,
    }))
    renderPage('/players?playerId=one')

    expect(await screen.findByRole('link', { name: /Home League/ })).toHaveAttribute('href', '/draft/espn/2026%3A123?userId=7')
    expect(screen.getByRole('combobox', { name: 'Scoring format' })).toHaveValue('half_ppr')
    expect(await screen.findByText(/225.0 PTS/)).toBeInTheDocument()
    expect(screen.getByText(/observed Half PPR/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Add to draft queue/ }))
    expect(JSON.parse(localStorage.getItem('draft-assistant:queue:espn:2026:123') ?? 'null')).toEqual(['101'])
  })
})
