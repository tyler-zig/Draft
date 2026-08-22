import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { RankSet } from '../rankings/types'
import { TABLE_COLUMNS } from '../preferences'
import { SettingsSheet, type MockDraftSettings } from './SettingsSheet'

vi.mock('../draft/sounds', () => ({
  unlockDraftSounds: vi.fn(),
  playPickSound: vi.fn(),
  playOnClockSound: vi.fn(),
}))

const sleeper: RankSet = {
  id: 'builtin:sleeper',
  label: 'Sleeper rank',
  scoring: 'ppr',
  kind: 'builtin',
  fetchedAt: Date.now(),
  rows: [{ name: 'Bijan Robinson', team: 'ATL', position: 'RB', overall: 2 }],
  unmatched: [],
}

const mockDraft: MockDraftSettings = {
  teams: 12,
  rounds: 15,
  yourSlot: 5,
  scoring: 'ppr',
  reach: 50,
  speed: 'normal',
  autoPick: true,
}

const columns = TABLE_COLUMNS.map((column) => column.key)

function renderSheet(overrides: Partial<Parameters<typeof SettingsSheet>[0]> = {}) {
  const props = {
    leagueName: 'The League',
    providerLabel: 'Demo',
    scoringType: 'ppr' as const,
    theme: 'dark' as const,
    draftSounds: true,
    visibleColumns: columns,
    rankSettings: { enabledIds: ['builtin:sleeper'], method: 'median' as const },
    builtinSets: [sleeper],
    importedSets: [] as RankSet[],
    keeperCount: 0,
    teamCount: 12,
    allowedKeepers: 2,
    keepersCostRoundPicks: true,
    mock: mockDraft,
    onClose: vi.fn(),
    onThemeChange: vi.fn(),
    onDraftSoundsChange: vi.fn(),
    onColumnsChange: vi.fn(),
    onKeepersCostChange: vi.fn(),
    onOpenRankings: vi.fn(),
    onOpenKeepers: vi.fn(),
    onMockChange: vi.fn(),
    onStartMock: vi.fn(),
    ...overrides,
  }
  return { ...render(<SettingsSheet {...props} />), props }
}

describe('SettingsSheet', () => {
  it('opens the mock pane for a demo room', () => {
    renderSheet()
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mock draft' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Teams' })).toHaveValue('12')
    expect(screen.getByRole('button', { name: 'Start new mock' })).toBeInTheDocument()
  })

  it('hides mock draft when the room is a connected league', () => {
    renderSheet({ mock: null, providerLabel: 'ESPN' })
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Mock draft' })).not.toBeInTheDocument()
    expect(screen.getByText('Synced with ESPN')).toBeInTheDocument()
  })

  it('switches panes and opens rankings from appearance', async () => {
    const user = userEvent.setup()
    const { props } = renderSheet()
    await user.click(screen.getByRole('button', { name: /Appearance/ }))
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
    expect(screen.getByText(/Median of 1 enabled source/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Light' }))
    expect(props.onThemeChange).toHaveBeenCalledWith('light')
    await user.click(screen.getByRole('button', { name: 'Open rankings' }))
    expect(props.onOpenRankings).toHaveBeenCalled()
  })

  it('toggles a table column from the board pane', async () => {
    const user = userEvent.setup()
    const { props } = renderSheet()
    await user.click(screen.getByRole('button', { name: /Player table/ }))
    await user.click(screen.getByRole('checkbox', { name: /VORP/ }))
    expect(props.onColumnsChange).toHaveBeenCalledWith(columns.filter((key) => key !== 'vorp'))
    expect(screen.getByRole('checkbox', { name: /Player/ })).toBeDisabled()
  })

  it('starts a mock from the demo pane', async () => {
    const user = userEvent.setup()
    const { props } = renderSheet()
    await user.click(screen.getByRole('button', { name: 'Start new mock' }))
    expect(props.onStartMock).toHaveBeenCalled()
  })
})
