import { useState } from 'react'
import { playOnClockSound, playPickSound, unlockDraftSounds } from '../draft/sounds'
import { TABLE_COLUMNS, type AppTheme, type TableColumnKey } from '../preferences'
import type { ScoringType } from '../providers/types'
import type { RankSet, RankSettings } from '../rankings/types'
import { Select } from './Select'

const MOCK_TEAMS = [4, 8, 10, 12]
const MOCK_ROUNDS = [2, 6, 10, 15]
const SPEEDS = ['slow', 'normal', 'fast'] as const

export type MockDraftSettings = {
  teams: number
  rounds: number
  yourSlot: number
  scoring: ScoringType
  reach: number
  speed: (typeof SPEEDS)[number]
  autoPick: boolean
}

type Pane = 'appearance' | 'sounds' | 'board' | 'keepers' | 'mock'

function scoringLabel(scoring: ScoringType) {
  if (scoring === 'half_ppr') return 'Half PPR'
  if (scoring === 'std') return 'Standard'
  return 'PPR'
}

function Toggle({ pressed, label, onClick }: { pressed: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className={`cc-st-toggle${pressed ? ' on' : ''}`} aria-pressed={pressed} aria-label={label} onClick={onClick}>
      <i className="cc-st-switch" aria-hidden="true" />
    </button>
  )
}

export function SettingsSheet({
  leagueName,
  providerLabel,
  scoringType,
  theme,
  draftSounds,
  visibleColumns,
  rankSettings,
  builtinSets,
  importedSets,
  keeperCount,
  teamCount,
  allowedKeepers,
  keepersCostRoundPicks,
  mock,
  onClose,
  onThemeChange,
  onDraftSoundsChange,
  onColumnsChange,
  onKeepersCostChange,
  onOpenRankings,
  onOpenKeepers,
  onMockChange,
  onStartMock,
  onMockLeague,
  onClearMockLeague,
  mockLeagueName = null,
}: {
  leagueName: string
  providerLabel: string
  scoringType: ScoringType
  theme: AppTheme
  draftSounds: boolean
  visibleColumns: TableColumnKey[]
  rankSettings: RankSettings
  builtinSets: RankSet[]
  importedSets: RankSet[]
  keeperCount: number
  teamCount: number
  allowedKeepers?: number | null
  keepersCostRoundPicks: boolean
  mock: MockDraftSettings | null
  onClose: () => void
  onThemeChange: (theme: AppTheme) => void
  onDraftSoundsChange: (enabled: boolean) => void
  onColumnsChange: (columns: TableColumnKey[]) => void
  onKeepersCostChange: (value: boolean) => void
  onOpenRankings: () => void
  onOpenKeepers: () => void
  onMockChange: (next: MockDraftSettings) => void
  onStartMock: () => void
  /** Run a mock of the league currently open, keepers and all. */
  onMockLeague?: () => void
  /** Forget the seeded league so the next mock is a generated room again. */
  onClearMockLeague?: () => void
  /** Name of the league a seeded mock is standing in for, when there is one. */
  mockLeagueName?: string | null
}) {
  const [pane, setPane] = useState<Pane>(mock ? 'mock' : 'appearance')
  const sources = [...builtinSets, ...importedSets]
  const enabledSets = sources.filter((set) => rankSettings.enabledIds.includes(set.id))
  const methodLabel = rankSettings.method === 'mean' ? 'Mean' : 'Median'
  const hiddenColumns = TABLE_COLUMNS.length - visibleColumns.length
  const columnNote = hiddenColumns === 0 ? 'All visible' : `${hiddenColumns} hidden`

  function toggleColumn(key: TableColumnKey, required?: boolean) {
    if (required) return
    onColumnsChange(visibleColumns.includes(key) ? visibleColumns.filter((column) => column !== key) : [...visibleColumns, key])
  }

  return (
    <div className="cc-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="cc-st-sheet" role="dialog" aria-modal="true" aria-label="Settings">
        <header>
          <div>
            <div className="cc-eyebrow">{leagueName} · {providerLabel}</div>
            <h2>Settings</h2>
            <p>{mock ? 'Set the room, then start a new mock. Grades open when it finishes.' : 'Appearance, sounds, and the player table for this draft room'}</p>
          </div>
          <div className="cc-st-head-actions">
            <span className={`cc-rk-chip${mock ? '' : ' cc-rk-chip-live'}`}>{mock ? 'Local mock' : `Synced with ${providerLabel}`}</span>
            <button type="button" className="cc-st-done" onClick={onClose}>Done</button>
            <button type="button" className="cc-st-close" onClick={onClose} aria-label="Close Settings">×</button>
          </div>
        </header>

        <div className="cc-st-recipe">
          <div>
            <small>Theme</small>
            <b>{theme === 'light' ? 'Light' : 'Dark'}</b>
            <em>Command center</em>
          </div>
          <div className={draftSounds ? 'cc-rk-stat-good' : undefined}>
            <small>Draft sounds</small>
            <b>{draftSounds ? 'On' : 'Muted'}</b>
            <em>Pick tick + on the clock</em>
          </div>
          <div>
            <small>Table columns</small>
            <b>{visibleColumns.length}</b>
            <em>{columnNote}</em>
          </div>
          <div>
            <small>Keepers</small>
            <b>{keeperCount}</b>
            <em>{keepersCostRoundPicks ? 'Cost a round pick' : 'Roster only, no slot'}</em>
          </div>
        </div>

        <div className="cc-st-body">
          <aside className="cc-st-nav">
            <button type="button" className={pane === 'appearance' ? 'on' : undefined} aria-current={pane === 'appearance' ? 'page' : undefined} onClick={() => setPane('appearance')}>
              <span><b>Appearance</b><small>Theme and rankings</small></span>
            </button>
            <button type="button" className={pane === 'sounds' ? 'on' : undefined} aria-current={pane === 'sounds' ? 'page' : undefined} onClick={() => setPane('sounds')}>
              <span><b>Sounds</b><small>Pick and clock cues</small></span>
            </button>
            <button type="button" className={pane === 'board' ? 'on' : undefined} aria-current={pane === 'board' ? 'page' : undefined} onClick={() => setPane('board')}>
              <span><b>Player table</b><small>Visible columns</small></span>
              <span className="cc-st-count">{visibleColumns.length}</span>
            </button>
            <button type="button" className={pane === 'keepers' ? 'on' : undefined} aria-current={pane === 'keepers' ? 'page' : undefined} onClick={() => setPane('keepers')}>
              <span><b>Keepers</b><small>Roster cost</small></span>
              <span className="cc-st-count">{keeperCount}</span>
            </button>
            {mock ? (
              <button type="button" className={pane === 'mock' ? 'on' : undefined} aria-current={pane === 'mock' ? 'page' : undefined} onClick={() => setPane('mock')}>
                <span><b>Mock draft</b><small>Room, scoring, speed</small></span>
              </button>
            ) : null}
            <p className="cc-st-nav-foot">Rankings sources live in the Rankings sheet. This panel only controls the room around the board.</p>
          </aside>

          <div className="cc-st-panes">
            {pane === 'appearance' ? (
              <section>
                <h3>Appearance</h3>
                <p className="cc-st-lead">Theme applies to the draft room and player intelligence. Rankings stay on their own sheet so this list does not fight that recipe.</p>
                <div className="cc-st-themes">
                  <button type="button" className={theme === 'dark' ? 'on' : undefined} aria-pressed={theme === 'dark'} aria-label="Dark" onClick={() => onThemeChange('dark')}>
                    <div className="cc-st-swatch"><i className="cc-st-swatch-dark" /></div>
                    <b>Dark</b>
                    <small>Default for live drafts</small>
                  </button>
                  <button type="button" className={theme === 'light' ? 'on' : undefined} aria-pressed={theme === 'light'} aria-label="Light" onClick={() => onThemeChange('light')}>
                    <div className="cc-st-swatch"><i className="cc-st-swatch-light" /></div>
                    <b>Light</b>
                    <small>Higher contrast in daylight</small>
                  </button>
                </div>
                <div className="cc-st-card">
                  <div className="cc-st-rank-card">
                    <div>
                      <h4>Consensus rankings</h4>
                      <p>{methodLabel} of {enabledSets.length} enabled source{enabledSets.length === 1 ? '' : 's'} · {scoringLabel(scoringType)} from this league. Toggle sources and math in Rankings, not here.</p>
                      <div className="cc-st-dots" aria-hidden="true">
                        {sources.slice(0, 5).map((set) => <i key={set.id} className={rankSettings.enabledIds.includes(set.id) ? 'on' : undefined} />)}
                      </div>
                    </div>
                    <button type="button" className="cc-rk-ghost" onClick={onOpenRankings}>Open rankings</button>
                  </div>
                </div>
              </section>
            ) : null}

            {pane === 'sounds' ? (
              <section>
                <h3>Draft sounds</h3>
                <p className="cc-st-lead">A tick on every pick, and a cue when you are on the clock. Browsers wait for a click on this page before audio can play.</p>
                <div className="cc-st-card">
                  <div className="cc-st-row">
                    <div>
                      <h4>Play draft sounds</h4>
                      <p>Mute from the top bar or from this switch. The setting is saved to this browser.</p>
                    </div>
                    <Toggle pressed={draftSounds} label="Draft sounds" onClick={() => onDraftSoundsChange(!draftSounds)} />
                  </div>
                  <div className="cc-st-previews">
                    <button type="button" onClick={() => { unlockDraftSounds(); playPickSound() }}><b>Preview pick</b><small>Soft tick when any team selects</small></button>
                    <button type="button" onClick={() => { unlockDraftSounds(); playOnClockSound() }}><b>Preview on the clock</b><small>Alert when it is your turn</small></button>
                  </div>
                </div>
              </section>
            ) : null}

            {pane === 'board' ? (
              <section>
                <h3>Player table</h3>
                <p className="cc-st-lead">Choose the columns on the available-player board. Player is always shown. Hints match the live table tooltips.</p>
                <div className="cc-st-columns">
                  {TABLE_COLUMNS.map((column) => {
                    const checked = visibleColumns.includes(column.key)
                    return (
                      <label key={column.key} className={checked ? undefined : 'off'}>
                        <input type="checkbox" checked={checked} disabled={column.required} onChange={() => toggleColumn(column.key, column.required)} />
                        <span>
                          <b>{column.label}</b>
                          <small>{column.hint ?? (column.required ? 'Name, team, and photo. Always shown.' : `${column.label} on the available-player board.`)}</small>
                        </span>
                        {column.required ? <span className="cc-st-lock">Required</span> : null}
                      </label>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {pane === 'keepers' ? (
              <section>
                <h3>Keepers</h3>
                <p className="cc-st-lead">Kept players stay off the available board. Whether they also consume a draft slot is a league rule, not a provider setting.</p>
                <div className="cc-st-keeper-stat">
                  <div><small>Kept</small><b>{keeperCount}</b></div>
                  <div><small>Teams</small><b>{teamCount}</b></div>
                  <div><small>Allowed</small><b>{allowedKeepers ?? '—'}</b></div>
                </div>
                <div className="cc-st-card">
                  <div className="cc-st-row top">
                    <div>
                      <h4>Keepers cost a round pick</h4>
                      <p>On: the kept round is skipped on the board. Off: kept players start on the roster and every team still picks each round.</p>
                    </div>
                    <Toggle pressed={keepersCostRoundPicks} label="Keepers cost a round pick" onClick={() => onKeepersCostChange(!keepersCostRoundPicks)} />
                  </div>
                </div>
                <div className="cc-st-actions">
                  <button type="button" className="cc-rk-primary" onClick={onOpenKeepers}>Set keepers</button>
                </div>
                {onMockLeague ? <div className="cc-st-card">
                  <div className="cc-st-row top">
                    <div>
                      <h4>Mock this league</h4>
                      <p>Runs the draft engine against your real teams, roster slots and keepers. Nothing is sent to {providerLabel} — the mock is local and your league is untouched.</p>
                    </div>
                  </div>
                  <div className="cc-st-actions">
                    <button type="button" className="cc-rk-primary cc-st-wide" onClick={onMockLeague}>Run a mock of this league</button>
                  </div>
                </div> : null}
              </section>
            ) : null}

            {pane === 'mock' && mock ? (
              <section>
                <h3>Mock draft</h3>
                <p className="cc-st-lead">Simulates the other teams with the survival spread model. A reachy room grabs anyone; a disciplined one sticks to the board. Kickers and defenses wait for the last round.</p>
                <div className="cc-st-card">
                  {/* A seeded league defines the room, so these describe nothing. */}
                  <div className="cc-st-mock-grid">
                    <label className="cc-st-field">
                      <span>Teams</span>
                      <Select aria-label="Teams" disabled={Boolean(mockLeagueName)} value={mock.teams} onChange={(event) => {
                        const teams = Number(event.target.value)
                        onMockChange({ ...mock, teams, yourSlot: Math.min(mock.yourSlot, teams) })
                      }}>
                        {MOCK_TEAMS.map((teams) => <option key={teams} value={teams}>{teams} teams</option>)}
                      </Select>
                    </label>
                    <label className="cc-st-field">
                      <span>Rounds</span>
                      <Select aria-label="Rounds" disabled={Boolean(mockLeagueName)} value={mock.rounds} onChange={(event) => onMockChange({ ...mock, rounds: Number(event.target.value) })}>
                        {MOCK_ROUNDS.map((rounds) => <option key={rounds} value={rounds}>{rounds} rounds</option>)}
                      </Select>
                    </label>
                    <label className="cc-st-field">
                      <span>Your slot</span>
                      <Select aria-label="Your slot" disabled={Boolean(mockLeagueName)} value={mock.yourSlot} onChange={(event) => onMockChange({ ...mock, yourSlot: Number(event.target.value) })}>
                        {Array.from({ length: mock.teams }, (_, index) => index + 1).map((slot) => <option key={slot} value={slot}>Slot {slot}</option>)}
                      </Select>
                    </label>
                    <label className="cc-st-field">
                      <span>Scoring</span>
                      <Select aria-label="Scoring" disabled={Boolean(mockLeagueName)} value={mock.scoring} onChange={(event) => onMockChange({ ...mock, scoring: event.target.value as ScoringType })}>
                        <option value="ppr">PPR</option>
                        <option value="half_ppr">Half PPR</option>
                        <option value="std">Standard</option>
                      </Select>
                    </label>
                    <label className="cc-st-field cc-st-range">
                      <span>Reach <b>{mock.reach}%</b></span>
                      <input type="range" min={0} max={100} step={5} value={mock.reach} aria-label="Reach" onChange={(event) => onMockChange({ ...mock, reach: Number(event.target.value) })} />
                      <div className="cc-st-scale"><span>Disciplined</span><span>Reachy</span></div>
                    </label>
                  </div>
                </div>
                <div className="cc-st-card">
                  <h4>Speed</h4>
                  <p>How fast the other seats pick. Your clock still waits on you unless auto-draft is on.</p>
                  <div className="cc-st-seg" role="group" aria-label="Speed">
                    {SPEEDS.map((speed) => (
                      <button type="button" key={speed} className={mock.speed === speed ? 'on' : undefined} aria-pressed={mock.speed === speed} onClick={() => onMockChange({ ...mock, speed })}>
                        {speed[0].toUpperCase() + speed.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="cc-st-card">
                  <div className="cc-st-row">
                    <div>
                      <h4>Auto-draft my picks</h4>
                      <p>Takes the top queued player, or best available if the queue is empty.</p>
                    </div>
                    <Toggle pressed={mock.autoPick} label="Auto-draft my picks" onClick={() => onMockChange({ ...mock, autoPick: !mock.autoPick })} />
                  </div>
                </div>
                {mockLeagueName ? <div className="cc-st-card">
                  <div className="cc-st-row top">
                    <div>
                      <h4>Mocking {mockLeagueName}</h4>
                      <p>Teams, roster slots and keepers come from that league, so the room settings above do not apply.</p>
                    </div>
                    {onClearMockLeague ? <button type="button" className="cc-rk-ghost" onClick={onClearMockLeague}>Use a generated room</button> : null}
                  </div>
                </div> : null}
                <p className="cc-st-lead cc-st-mock-note">The grades sheet opens when the mock finishes. Keepers are drafted around: they hold the pick their team paid for.</p>
                <div className="cc-st-actions">
                  <button type="button" className="cc-rk-primary cc-st-wide" onClick={onStartMock}>Start new mock</button>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
