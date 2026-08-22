import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { DraftPick, Player } from '../providers/types'
import { TABLE_COLUMNS } from '../preferences'
import { flushIntersectionObservers } from '../test/setup'
import { PlayerTable } from './PlayerTable'

vi.mock('../api/playerIntelligence', async () => {
  const actual = await vi.importActual<typeof import('../api/playerIntelligence')>('../api/playerIntelligence')
  const teams = { CHI: [{ week: 1, opponent: 'GB', home: false, bye: false, completed: false }, { week: 2, opponent: 'MIN', home: true, bye: false, completed: false }, { week: 3, opponent: null, home: false, bye: true, completed: false }] }
  return {
    ...actual,
    playerIntelligenceQueryKey: (player: { id: string; espnId?: string; sleeperId?: string }) => player.espnId ?? player.sleeperId ?? player.id,
    getPlayerIntelligence: vi.fn(async () => ({
      stats: [], news: [], statsMessage: 'No stats', newsMessage: 'No news',
      marketHistory: { source: 'Collected ranking median', generatedAt: 3, message: null, points: [{ at: 1, rank: 12, adp: 13, liveAdp: null, low: 8, high: 16, sourceCount: 3 }, { at: 2, rank: 10, adp: 11, liveAdp: null, low: 7, high: 14, sourceCount: 4 }] },
      historical: {
        source: 'Data: nflverse', updatedAt: '2026-08-22T00:00:00Z', methodology: {}, message: null, schedule: null,
        seasons: [{ season: 2025, gamesPlayed: 15, stats: { fantasyPointsPpr: 240 }, weekly: [], usage: { opportunities: 190, touchShare: 0.24, redZoneTouchShare: 0.31, snapShare: 0.68 }, durability: { gamesMissed: 2, missedWeeks: [3, 4], byStatus: { ACT: 2 } } }],
        scheduleModel: {
          season: 2026, source: 'Data: nflverse', updatedAt: '2026-08-22T00:00:00Z', teams,
          window: { priorSeason: 2025, currentSeason: 2026, currentGames: 0, priorWeight: 1, currentWeight: 0, minSample: 4 },
          matchups: { ppr: { WR: { GB: { team: 'GB', rank: 7, pointsAllowed: 23, games: 17 }, MIN: { team: 'MIN', rank: 18, pointsAllowed: 19, games: 17 } } }, half: { WR: {} }, standard: { WR: {} } },
          strengthOfSchedule: { ppr: { WR: { CHI: { team: 'CHI', rank: 10, averageMatchupRank: 7, remainingGames: 2 } } }, half: { WR: {} }, standard: { WR: {} } },
        },
      },
    })),
  }
})
vi.mock('../api/playerProjections', async () => {
  const actual = await vi.importActual<typeof import('../api/playerProjections')>('../api/playerProjections')
  return {
    ...actual,
    getNflProjections: vi.fn(async () => new Map([
      ['2', {
        sleeperId: '2',
        season: '2026',
        games: 17,
        stats: { gp: 17, rec: 88, rec_yd: 1110, rec_td: 7, pts_ppr: 244.5, pts_half_ppr: 200.5, pts_std: 156.5 },
        pointsPpr: 244.5,
        pointsHalf: 200.5,
        pointsStd: 156.5,
        adp: null,
        adpPpr: 11.2,
        adpHalf: 13.4,
        adpStd: 16.8,
        source: 'RotoWire via Sleeper',
        updatedAt: Date.parse('2026-08-20T12:00:00.000Z'),
      }],
    ])),
  }
})
vi.mock('../api/playerTwitter', async () => {
  const actual = await vi.importActual<typeof import('../api/playerTwitter')>('../api/playerTwitter')
  return {
    ...actual,
    loadTwitterCatalog: vi.fn(async () => ({
      schemaVersion: 1, source: 'test', bySleeper: { '2': 'TestHandle' }, byEspn: {}, byGsis: {},
    })),
  }
})

const players: Player[] = Array.from({ length: 34 }, (_, index) => ({
  id: String(index + 1), firstName: `First${index + 1}`, lastName: `Player${index + 1}`,
  fullName: `First${index + 1} Player${index + 1}`, position: index % 2 ? 'WR' : 'RB',
  team: index % 3 ? 'CHI' : 'GB', searchRank: index + 1, injuryStatus: index === 3 ? 'QUESTIONABLE' : null,
  number: null, yearsExp: index % 6, bye: 10,
  age: index === 1 ? 25 : null, height: index === 1 ? `6'1"` : null, weight: index === 1 ? 210 : null,
  consensusCount: 2, rankLow: index + 1, rankHigh: index + 5, rankUpdatedAt: 2,
  rankingSources: [{ id: 'source', label: 'Expert source', rank: index + 1, fetchedAt: 2 }],
}))
const picks: DraftPick[] = [{ playerId: '1', pickedByUserId: null, rosterId: null, round: 1, draftSlot: 1, pickNo: 1, isKeeper: false, meta: null }]

function renderTable(overrides: Partial<React.ComponentProps<typeof PlayerTable>> = {}) {
  const props: React.ComponentProps<typeof PlayerTable> = {
    players, picks, canDraft: false, canMutateDraft: false, providerLabel: 'Sleeper', currentPickNo: 2,
    queuedIds: [], selectedId: null, visibleColumnKeys: TABLE_COLUMNS.map((column) => column.key),
    onVisibleColumnKeysChange: vi.fn(), onSelect: vi.fn(), onDraft: vi.fn(), onToggleQueue: vi.fn(), ...overrides,
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { props, ...render(<QueryClientProvider client={client}><MemoryRouter><PlayerTable {...props} /></MemoryRouter></QueryClientProvider>) }
}

describe('PlayerTable interactions', () => {
  it('loads players incrementally and filters the list', async () => {
    const user = userEvent.setup()
    renderTable()
    expect(screen.getByText('Showing 14 of 33 players · Scroll to load more')).toBeInTheDocument()
    flushIntersectionObservers(true)
    expect(screen.getByText('Showing 28 of 33 players · Scroll to load more')).toBeInTheDocument()
    await user.click(screen.getByLabelText('Position filter'))
    await user.click(screen.getByRole('option', { name: 'WR' }))
    expect(screen.getByText(/Showing 14 of 17 players/)).toBeInTheDocument()
  })

  it('can be filtered from outside through the position filter', () => {
    const onPositionFilterChange = vi.fn()
    renderTable({ positionFilter: 'WR', onPositionFilterChange })
    expect(screen.getByText(/Showing 14 of 17 players/)).toBeInTheDocument()
    expect(screen.getByLabelText('Position filter')).toHaveValue('WR')
  })

  it('can reveal drafted players with Available Only', async () => {
    const user = userEvent.setup()
    renderTable()
    expect(screen.queryByText('First1 Player1')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('Available Only'))
    expect(screen.getByText('First1 Player1')).toBeInTheDocument()
    expect(screen.getByText('Drafted')).toBeInTheDocument()
  })

  it('opens player details and gates drafting for read-only providers', () => {
    const onSelect = vi.fn()
    const first = renderTable({ selectedId: '2', onSelect })
    const dialog = screen.getByRole('dialog', { name: 'First2 Player2 details' })
    expect(within(dialog).getByText('Sleeper is read-only · draft on the league site')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Draft player/ })).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onSelect).toHaveBeenCalledWith(null)
    first.unmount()
  })

  it('shows sourced profile, ranking provenance, and collected history in the player modal', async () => {
    renderTable({ selectedId: '2', players: players.map((player) => player.id === '2' ? { ...player, liveAdp: 4.7 } : player) })
    const dialog = screen.getByRole('dialog', { name: 'First2 Player2 details' })
    expect(within(dialog).getByText('25 yr old')).toBeInTheDocument()
    expect(within(dialog).getByText(`6'1"`)).toBeInTheDocument()
    expect(within(dialog).getByText('210 lb')).toBeInTheDocument()
    expect(within(dialog).getByText('Consensus')).toBeInTheDocument()
    expect(within(dialog).getByText('ADP')).toBeInTheDocument()
    expect(within(dialog).getByText('Live ADP').parentElement).toHaveTextContent('4.7')
    expect(within(dialog).getByRole('heading', { name: 'ADP over time' })).toBeInTheDocument()
    expect(within(dialog).getByText(/Expert source/, { selector: 'small' })).toHaveTextContent('2')
    expect(await within(dialog).findByRole('img', { name: /ADP history/ })).toBeInTheDocument()
    expect(within(dialog).getByText(/24% of team touches/)).toBeInTheDocument()
    expect(within(dialog).getByText('68%')).toBeInTheDocument()
    expect(within(dialog).getByText(/Data: nflverse/)).toBeInTheDocument()
    const production = within(dialog).getByRole('table')
    expect(await within(production).findByText('proj')).toBeInTheDocument()
    expect(within(production).getByText('88')).toBeInTheDocument()
    expect(within(production).getByText('1110')).toBeInTheDocument()
    expect(within(production).getByText('244.5')).toBeInTheDocument()
    expect(within(dialog).getByText(/2026 line is a RotoWire via Sleeper season projection/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('2026 CHI schedule')).toBeInTheDocument()
    expect(within(dialog).getByText('@ GB')).toBeInTheDocument()
    expect(within(dialog).getByText('vs MIN')).toBeInTheDocument()
    expect(within(dialog).getByText('@ GB').closest('li')).toHaveClass('easy')
    expect(within(dialog).getByText('vs MIN').closest('li')).toHaveClass('tough')
    expect(within(dialog).getAllByText('BYE').length).toBeGreaterThan(0)
    expect(within(dialog).getByText(/Bye 3/)).toBeInTheDocument()
    expect(within(dialog).getByText('10th easiest')).toHaveClass('neutral')
  })

  it('links to a sourced X account in the player modal', async () => {
    renderTable({ selectedId: '2', players: players.map((player) => player.id === '2' ? { ...player, sleeperId: '2' } : player) })
    const dialog = screen.getByRole('dialog', { name: 'First2 Player2 details' })
    const link = await within(dialog).findByRole('link', { name: 'First2 Player2 on X' })
    expect(link).toHaveAttribute('href', 'https://x.com/TestHandle')
    expect(link).toHaveTextContent('@TestHandle')
  })

  it('shows an explained disabled draft control while demo is waiting', () => {
    renderTable({ selectedId: '2', canMutateDraft: true, providerLabel: 'Demo' })
    const button = screen.getByRole('button', { name: 'Not your pick yet' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Wait until you are on the clock in the demo draft.')
  })

  it('states the draft context for an available player', () => {
    renderTable({
      selectedId: '2',
      players: players.map((item) => (item.id === '2' ? { ...item, tier: 1 } : item)),
      selectedContext: {
        takenBy: null, positionRank: 2, positionDrafted: 1, tierRemaining: 1,
        need: { kind: 'starter', label: 'Fill RB1' },
        valueVsPick: 7, baselineSource: 'ADP', yourNextPickNo: 21, lastsUntilYourPick: false, survivalProbability: 0.1,
      },
    })
    const dialog = screen.getByRole('dialog', { name: 'First2 Player2 details' })
    expect(within(dialog).getByText('Falling 7')).toBeInTheDocument()
    expect(within(dialog).getByText('Last one')).toBeInTheDocument()
    expect(within(dialog).getByText('Fill RB1')).toBeInTheDocument()
    expect(within(dialog).getByText('Gone by then')).toBeInTheDocument()
  })

  it('reports who took a player instead of advising on him', () => {
    renderTable({
      selectedId: '1',
      selectedContext: {
        takenBy: { pickNo: 7, round: 1, teamName: 'Gridiron Gal', isKeeper: false },
        positionRank: 1, positionDrafted: 3, tierRemaining: 2,
        need: { kind: 'starter', label: 'Fill RB1' },
        valueVsPick: 7, baselineSource: 'ADP', yourNextPickNo: 21, lastsUntilYourPick: true, survivalProbability: 0.9,
      },
    })
    const dialog = screen.getByRole('dialog', { name: 'First1 Player1 details' })
    expect(within(dialog).getByText('Gridiron Gal')).toBeInTheDocument()
    expect(within(dialog).getByText('7 · round 1')).toBeInTheDocument()
    // Advice about a player nobody can draft is noise.
    expect(within(dialog).queryByText('Gone by then')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Should last')).not.toBeInTheDocument()
  })

  it('distinguishes the queue control from the draft control once a player is gone', () => {
    renderTable({ selectedId: '1', canMutateDraft: true, providerLabel: 'Demo', canDraft: true })
    const dialog = screen.getByRole('dialog', { name: 'First1 Player1 details' })
    expect(within(dialog).getByRole('button', { name: 'Off the board' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Already drafted' })).toBeDisabled()
  })

  it('reports persisted column changes from Customize', async () => {
    const user = userEvent.setup(), onColumns = vi.fn()
    renderTable({ onVisibleColumnKeysChange: onColumns })
    await user.click(screen.getByRole('button', { name: 'Customize' }))
    await user.click(screen.getByLabelText('Team'))
    expect(onColumns).toHaveBeenCalledWith(expect.not.arrayContaining(['team']))
  })

  it('shows published projection points and leaves the rest blank', () => {
    renderTable({
      picks: [],
      players: [
        { ...players[1], fullName: 'Projected Back', projectedPoints: 212.4 },
        { ...players[2], fullName: 'No Projection' },
      ],
    })
    expect(screen.getByText('212.4')).toBeInTheDocument()
    const row = screen.getByText('No Projection').closest('tr')
    expect(row?.textContent).toContain('—')
  })

  it('shows the live ADP board position and blanks players off the board', () => {
    renderTable({
      picks: [],
      players: [
        { ...players[1], fullName: 'On The Board', liveAdp: 4.7 },
        { ...players[2], fullName: 'Off The Board' },
      ],
    })
    expect(screen.getByText('4.7')).toBeInTheDocument()
    const row = screen.getByText('Off The Board').closest('tr')
    expect(row?.textContent).toContain('—')
  })

  it('marks questionable in amber and IR in red', () => {
    renderTable({
      picks: [],
      players: [
        { ...players[1], fullName: 'Questionable Back', injuryStatus: 'Questionable' },
        { ...players[2], fullName: 'IR Receiver', injuryStatus: 'IR' },
        { ...players[3], fullName: 'Healthy End', injuryStatus: null },
      ],
    })
    const caution = screen.getByText('Questionable Back').querySelector('.cc-status')
    const unavailable = screen.getByText('IR Receiver').querySelector('.cc-status')
    expect(caution).toHaveClass('cc-warn')
    expect(caution).toHaveAttribute('title', 'Questionable')
    expect(unavailable).toHaveClass('cc-out')
    expect(unavailable).toHaveAttribute('title', 'IR')
    expect(screen.getByText('Healthy End').querySelector('.cc-status')).toBeNull()
  })

  it('shows the playoff SoS rank with its tone and blanks the rest', () => {
    renderTable({
      picks: [],
      players: [
        { ...players[1], fullName: 'Soft Slate', playoffSos: { averageMatchupRank: 2, rank: 3, games: 3 } },
        { ...players[2], fullName: 'No Slate' },
      ],
    })
    const cell = screen.getByText('3rd')
    expect(cell).toHaveClass('cc-sos-easy')
    const emptyCell = screen.getByText('No Slate').closest('tr')?.querySelector('td .cc-sos-neutral')
    expect(emptyCell?.textContent).toBe('—')
  })
})
