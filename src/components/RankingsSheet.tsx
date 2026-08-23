import { useMemo, useRef, useState } from 'react'
import { deleteImportedSet } from '../rankings/importSet'
import { EXPERT_PREFIX, SCORING_LABELS, scoringFor, type ExpertScoring } from '../rankings/experts'
import { fantasyProsConsensusId, isFantasyProsSource } from '../rankings/expertSelection'
import { loadRankSettings, saveRankSettings } from '../rankings/store'
import type { RankSet, RankSettings } from '../rankings/types'
import type { Player, ScoringType } from '../providers/types'
import { ExpertRankingsPanel } from './ExpertRankingsPanel'
import { RankingsPanel } from './RankingsPanel'
import { Select } from './Select'

const FANTASYPROS_KEY = 'fantasypros'
const ADD_KEY = 'add'
const STALE_MS = 18 * 60 * 60 * 1000

type RecipeRow = {
  key: string
  name: string
  detail: string
  enabled: boolean
  fresh: 'live' | 'stale' | 'off'
  fetchedAt: number | null
  kind: 'fp' | 'set'
  sets: RankSet[]
}

function relative(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${Math.max(0, seconds)}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function dateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

function freshness(enabled: boolean, fetchedAt: number | null): RecipeRow['fresh'] {
  if (!enabled || fetchedAt == null) return 'off'
  return Date.now() - fetchedAt > STALE_MS ? 'stale' : 'live'
}

function matchedCount(sets: RankSet[]): number {
  return sets.reduce((max, set) => Math.max(max, set.rows.length), 0)
}

function sourceCopy(set: RankSet): { title: string; copy: string; note: string } {
  if (set.id === 'builtin:sleeper') {
    return {
      title: set.label,
      copy: 'Search rank from the connected player directory, matched to the draft pool.',
      note: 'Stays in the consensus until you uncheck it in the recipe.',
    }
  }
  if (set.id === 'builtin:espn') {
    return {
      title: set.label,
      copy: 'Draft ranks from the connected ESPN league.',
      note: 'Useful as a market check against expert boards.',
    }
  }
  if (set.kind === 'import') {
    return {
      title: set.label,
      copy: 'Imported list. Remove it if you no longer want it in consensus.',
      note: set.unmatched.length ? `${set.unmatched.length} unmatched name${set.unmatched.length === 1 ? '' : 's'} left out of this board.` : 'Imported lists stay on your account until you remove them.',
    }
  }
  return {
    title: set.label,
    copy: 'Collected board sitting in the library. Toggle it from the recipe without leaving this sheet.',
    note: set.id.startsWith('collected:') ? 'Collected lists are replaced the next time you load a snapshot.' : 'Stays in the consensus until you uncheck it in the recipe.',
  }
}

function buildRecipe(builtinSets: RankSet[], importedSets: RankSet[], settings: RankSettings, scoring: ExpertScoring): RecipeRow[] {
  const all = [...builtinSets, ...importedSets]
  const fpSets = all.filter((set) => isFantasyProsSource(set.id))
  const others = all.filter((set) => !isFantasyProsSource(set.id))
  const enabledFp = settings.enabledIds.filter(isFantasyProsSource)
  const expertIds = enabledFp.filter((id) => id.startsWith(`${EXPERT_PREFIX}${scoring}:`))
  const consensusOn = enabledFp.includes(fantasyProsConsensusId(scoring))
  const activeFpSets = fpSets.filter((set) => enabledFp.includes(set.id))
  const sampleSets = activeFpSets.length ? activeFpSets : fpSets
  const matched = matchedCount(sampleSets)
  const fetchedAt = sampleSets.length ? Math.min(...sampleSets.map((set) => set.fetchedAt)) : null
  const fp: RecipeRow = {
    key: FANTASYPROS_KEY,
    name: 'FantasyPros',
    detail: expertIds.length
      ? `${expertIds.length} expert board${expertIds.length === 1 ? '' : 's'} · ${matched} matched`
      : consensusOn
        ? `Consensus ECR · ${matched} matched`
        : fpSets.length
          ? 'Available · not in the recipe'
          : 'Apply consensus or experts',
    enabled: enabledFp.length > 0,
    fresh: freshness(enabledFp.length > 0, fetchedAt),
    fetchedAt,
    kind: 'fp',
    sets: fpSets,
  }
  return [
    fp,
    ...others.map((set) => ({
      key: set.id,
      name: set.label,
      detail: `${set.kind === 'import' ? 'Imported' : set.id.startsWith('collected:') ? 'Collected' : set.kind === 'builtin' ? 'Built-in' : 'Source'} · ${set.rows.length} matched${set.unmatched.length ? ` · ${set.unmatched.length} unmatched` : ''}`,
      enabled: settings.enabledIds.includes(set.id),
      fresh: freshness(settings.enabledIds.includes(set.id), set.fetchedAt),
      fetchedAt: set.fetchedAt,
      kind: 'set' as const,
      sets: [set],
    })),
  ]
}

export function RankingsSheet({
  leagueName,
  leagueScoring,
  receptionPremium,
  directory,
  builtinSets,
  importedSets,
  rankSettings,
  onClose,
  onChange,
}: {
  leagueName: string
  leagueScoring: ScoringType
  receptionPremium?: { position: string; points: number }[] | null
  directory: Player[]
  builtinSets: RankSet[]
  importedSets: RankSet[]
  rankSettings: RankSettings
  onClose: () => void
  onChange: () => void
}) {
  const detected = scoringFor(leagueScoring)
  const [scoring, setScoring] = useState<ExpertScoring>(detected.scoring)
  const [selected, setSelected] = useState(FANTASYPROS_KEY)
  const lastFpIds = useRef(rankSettings.enabledIds.filter(isFantasyProsSource))
  const rows = useMemo(() => buildRecipe(builtinSets, importedSets, rankSettings, scoring), [builtinSets, importedSets, rankSettings, scoring])
  const enabledRows = rows.filter((row) => row.enabled)
  const enabledSets = [...builtinSets, ...importedSets].filter((set) => rankSettings.enabledIds.includes(set.id))
  const oldest = enabledSets.length ? Math.min(...enabledSets.map((set) => set.fetchedAt)) : null
  const selectedRow = rows.find((row) => row.key === selected)
  const selectedSet = selectedRow?.kind === 'set' ? selectedRow.sets[0] : undefined
  const scoringNote = scoring === detected.scoring
    ? detected.detected ? 'Detected from your league' : 'League format unknown; defaulting to PPR'
    : 'Manual scoring override'
  const methodLabel = rankSettings.method === 'mean' ? 'Mean' : 'Median'

  function persist(next: RankSettings) {
    saveRankSettings(next)
    onChange()
  }

  function toggleRow(row: RecipeRow) {
    if (row.kind === 'fp') {
      if (row.enabled) {
        lastFpIds.current = rankSettings.enabledIds.filter(isFantasyProsSource)
        persist({ ...rankSettings, enabledIds: rankSettings.enabledIds.filter((id) => !isFantasyProsSource(id)) })
      } else {
        const restore = lastFpIds.current.length
          ? lastFpIds.current
          : row.sets.filter((set) => set.id === fantasyProsConsensusId(scoring) || set.id.startsWith(`${EXPERT_PREFIX}${scoring}:`)).map((set) => set.id)
        if (restore.length) persist({ ...rankSettings, enabledIds: [...new Set([...rankSettings.enabledIds, ...restore])] })
        setSelected(FANTASYPROS_KEY)
      }
      return
    }
    persist({
      ...rankSettings,
      enabledIds: row.enabled ? rankSettings.enabledIds.filter((id) => id !== row.key) : [...rankSettings.enabledIds, row.key],
    })
  }

  async function removeSet(id: string) {
    await deleteImportedSet(id)
    persist({ ...rankSettings, enabledIds: rankSettings.enabledIds.filter((enabled) => enabled !== id) })
    setSelected(FANTASYPROS_KEY)
  }

  const previewRows = (selectedSet?.rows ?? []).slice().sort((a, b) => a.overall - b.overall).slice(0, 8)
  const selectedCopy = selectedSet ? sourceCopy(selectedSet) : null

  return (
    <div className="cc-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="cc-rk-sheet" role="dialog" aria-modal="true" aria-label="Rankings">
        <header>
          <div>
            <div className="cc-eyebrow">Draft settings</div>
            <h2>Rankings</h2>
            <p>{methodLabel} of {enabledSets.length} enabled list{enabledSets.length === 1 ? '' : 's'} · {SCORING_LABELS[scoring]} {scoring === detected.scoring && detected.detected ? 'detected from your league' : scoring === detected.scoring ? 'default' : 'override'} · {leagueName}</p>
          </div>
          <div className="cc-rk-head-actions">
            <span className="cc-rk-chip cc-rk-chip-live">Live on the board</span>
            <button type="button" onClick={onClose} aria-label="Close rankings">×</button>
          </div>
        </header>

        <div className="cc-rk-recipe">
          <div>
            <small>Scoring</small>
            <b>{SCORING_LABELS[scoring]}</b>
            <em>{scoringNote}</em>
          </div>
          <div>
            <small>Combine</small>
            <b>{methodLabel}</b>
            <em>of enabled lists</em>
          </div>
          <div className={enabledSets.length ? 'cc-rk-stat-good' : undefined}>
            <small>Driving the table</small>
            <b>{enabledSets.length}</b>
            <em>{enabledRows.length ? `${enabledRows[0].name}${enabledRows.length > 1 ? ` + ${enabledRows.length - 1} more` : ''}` : 'Nothing enabled'}</em>
          </div>
          <div>
            <small>Oldest board</small>
            <b>{oldest == null ? '—' : relative(oldest)}</b>
            <em>{oldest == null ? 'No enabled lists' : dateTime(oldest)}</em>
          </div>
        </div>

        <div className="cc-rk-body">
          <aside className="cc-rk-menu">
            <div className="cc-rk-menu-pad">
              <label className="cc-rk-field">
                <span>Format</span>
                <Select aria-label="Scoring format" value={scoring} onChange={(event) => setScoring(event.target.value as ExpertScoring)}>
                  <option value="ppr">{detected.scoring === 'ppr' && detected.detected ? 'PPR — detected' : 'PPR'}</option>
                  <option value="half">{detected.scoring === 'half' && detected.detected ? 'Half PPR — detected' : 'Half PPR'}</option>
                  <option value="standard">{detected.scoring === 'standard' && detected.detected ? 'Standard — detected' : 'Standard'}</option>
                </Select>
              </label>
              <label className="cc-rk-field">
                <span>Consensus math</span>
                <Select aria-label="Consensus calculation" value={rankSettings.method} onChange={(event) => persist({ ...loadRankSettings(), method: event.target.value === 'mean' ? 'mean' : 'median' })}>
                  <option value="median">Median of enabled lists</option>
                  <option value="mean">Mean of enabled lists</option>
                </Select>
              </label>
              <p className="cc-rk-note">The player table uses this recipe immediately. Expert swaps still need Apply.</p>
            </div>
            <div className="cc-rk-menu-head"><b>Active recipe</b><span>{enabledRows.length} on</span></div>
            <div className="cc-rk-sources">
              {rows.map((row) => (
                <div key={row.key} className={`cc-rk-source ${selected === row.key ? 'on' : ''}`}>
                  <input type="checkbox" checked={row.enabled} aria-label={`Enable ${row.name}`} onChange={() => toggleRow(row)} />
                  <button type="button" onClick={() => setSelected(row.key)}>
                    <b>{row.name}</b>
                    <small>{row.detail}</small>
                  </button>
                  <i className={`cc-rk-dot ${row.fresh}`} aria-hidden="true" />
                </div>
              ))}
            </div>
            <button type="button" className={`cc-rk-add ${selected === ADD_KEY ? 'on' : ''}`} onClick={() => setSelected(ADD_KEY)}>+ Import or collect</button>
          </aside>

          <div className="cc-rk-editor">
            {selected === ADD_KEY ? (
              <section>
                <div className="cc-rk-editor-top">
                  <div>
                    <div className="cc-eyebrow">Library</div>
                    <h3>Import or collect</h3>
                    <p>Bring in a list you own, or load the hosted snapshots Supabase Cron publishes. Real-Time ADP is its own 15-minute job.</p>
                  </div>
                </div>
                <RankingsPanel draftPlayers={directory} onChange={onChange} />
              </section>
            ) : selected === FANTASYPROS_KEY ? (
              <section>
                <div className="cc-rk-editor-top">
                  <div>
                    <div className="cc-eyebrow">Primary source</div>
                    <h3>FantasyPros</h3>
                    <p>Use the published ECR board, or replace it with the individual expert boards you trust.</p>
                  </div>
                </div>
                <ExpertRankingsPanel
                  leagueScoring={leagueScoring}
                  receptionPremium={receptionPremium}
                  directory={directory}
                  scoring={scoring}
                  onScoringChange={setScoring}
                  hideScoringBanner
                  onChange={onChange}
                />
              </section>
            ) : selectedSet && selectedCopy ? (
              <section>
                <div className="cc-rk-editor-top">
                  <div>
                    <div className="cc-eyebrow">{selectedRow?.enabled ? 'Enabled source' : 'Library source'}</div>
                    <h3>{selectedCopy.title}</h3>
                    <p>{selectedCopy.copy}</p>
                  </div>
                  <span className="cc-rk-chip">{selectedSet.rows.length} matched</span>
                </div>
                <div className="cc-rk-card">
                  <div>
                    <b>{selectedSet.fetchedAt ? `Last synced ${dateTime(selectedSet.fetchedAt)}` : 'No sync time'}</b>
                    <p>{selectedCopy.note}</p>
                  </div>
                  <div className="cc-rk-row-actions">
                    <button type="button" className={selectedRow?.enabled ? 'cc-rk-danger' : 'cc-rk-primary'} onClick={() => selectedRow && toggleRow(selectedRow)}>
                      {selectedRow?.enabled ? 'Disable' : 'Enable'}
                    </button>
                    {selectedSet.kind === 'import' ? <button type="button" className="cc-rk-danger" onClick={() => void removeSet(selectedSet.id)}>Remove</button> : null}
                  </div>
                </div>
                {previewRows.length ? (
                  <div className="cc-rk-preview">
                    <header><b>Top of this board</b><span>sample</span></header>
                    <table>
                      <thead><tr><th>Rank</th><th>Player</th><th>Pos</th></tr></thead>
                      <tbody>
                        {previewRows.map((row) => (
                          <tr key={`${row.playerId ?? row.name}-${row.overall}`}>
                            <td>{row.overall}</td>
                            <td>{row.name}</td>
                            <td>{row.position ? <span className={`cc-pos cc-${row.position.toLowerCase()}`}>{row.position}</span> : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="cc-rk-empty">No matched players on this board yet.</p>}
              </section>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
