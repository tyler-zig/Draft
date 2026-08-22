import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RankSet } from '../rankings/types'
import { RankingsSheet } from './RankingsSheet'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
}))

vi.mock('./ExpertRankingsPanel', () => ({
  ExpertRankingsPanel: () => <div>FantasyPros editor</div>,
}))
vi.mock('./RankingsPanel', () => ({
  RankingsPanel: () => <div>Import library</div>,
}))
vi.mock('../rankings/store', () => ({
  loadRankSettings: () => ({ enabledIds: ['builtin:sleeper', 'collected:fantasypros-ppr'], method: 'median' }),
  saveRankSettings: mocks.save,
}))
vi.mock('../rankings/importSet', () => ({ deleteImportedSet: vi.fn() }))

const sleeper: RankSet = {
  id: 'builtin:sleeper',
  label: 'Sleeper rank',
  scoring: 'ppr',
  kind: 'builtin',
  fetchedAt: Date.now(),
  rows: [{ name: 'Bijan Robinson', team: 'ATL', position: 'RB', overall: 2 }],
  unmatched: [],
}
const fantasyPros: RankSet = {
  id: 'collected:fantasypros-ppr',
  label: 'FantasyPros PPR',
  scoring: 'ppr',
  kind: 'import',
  fetchedAt: Date.now(),
  rows: [{ name: 'Ja’Marr Chase', team: 'CIN', position: 'WR', overall: 1 }],
  unmatched: [],
}

function renderSheet(onChange = vi.fn()) {
  return render(
    <RankingsSheet
      leagueName="The League"
      leagueScoring="ppr"
      directory={[]}
      builtinSets={[sleeper]}
      importedSets={[fantasyPros]}
      rankSettings={{ enabledIds: ['builtin:sleeper', 'collected:fantasypros-ppr'], method: 'median' }}
      onClose={vi.fn()}
      onChange={onChange}
    />,
  )
}

describe('RankingsSheet', () => {
  beforeEach(() => {
    mocks.save.mockClear()
  })

  it('groups FantasyPros and shows the live recipe', () => {
    renderSheet()
    expect(screen.getByRole('dialog', { name: 'Rankings' })).toBeInTheDocument()
    expect(screen.getByText('Detected from your league')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'FantasyPros' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /FantasyPros/ })).toBeInTheDocument()
    expect(screen.getByText(/Consensus ECR/)).toBeInTheDocument()
    expect(screen.getByText('Sleeper rank')).toBeInTheDocument()
    expect(screen.queryByText('FantasyPros PPR')).not.toBeInTheDocument()
    expect(screen.getByText('FantasyPros editor')).toBeInTheDocument()
  })

  it('opens a source detail and the import library', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.click(screen.getByRole('button', { name: /Sleeper rank/ }))
    expect(screen.getByText('Search rank from the connected player directory, matched to the draft pool.')).toBeInTheDocument()
    expect(screen.getByText('Bijan Robinson')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '+ Import or collect' }))
    expect(screen.getByText('Import library')).toBeInTheDocument()
  })

  it('toggles a recipe source immediately', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderSheet(onChange)
    await user.click(screen.getByLabelText('Enable Sleeper rank'))
    expect(mocks.save).toHaveBeenCalledWith({ enabledIds: ['collected:fantasypros-ppr'], method: 'median' })
    expect(onChange).toHaveBeenCalled()
  })
})
