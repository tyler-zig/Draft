import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchCollectedSnapshot, installCollectedSets } from '../rankings/collected'
import { EXPERT_PREFIX, SCORING_LABELS, fetchExpertSnapshot, installExpertSets, oldestSync, scoringFor, type ExpertScoring } from '../rankings/experts'
import { fantasyProsConsensusId, installedExpertSlugs, replaceFantasyProsSource } from '../rankings/expertSelection'
import { loadImportedSets, loadRankSettings, saveRankSettings } from '../rankings/store'
import { sleeperProvider } from '../providers/sleeperProvider'
import type { Player, ScoringType } from '../providers/types'
import { Select } from './Select'

type SourceMode = 'consensus' | 'experts'

function dateTime(timestamp: number | null): string {
  if (timestamp == null) return 'Never'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

async function matchingDirectory(directory: Player[]): Promise<Player[]> {
  if (directory.length >= 200 && directory.some((player) => player.sleeperId)) return directory
  return sleeperProvider.getPlayers()
}

export function ExpertRankingsPanel({
  leagueScoring,
  receptionPremium,
  directory,
  onChange,
  scoring: scoringProp,
  onScoringChange,
  hideScoringBanner = false,
}: {
  leagueScoring: ScoringType
  receptionPremium?: { position: string; points: number }[] | null
  directory: Player[]
  onChange: () => void
  scoring?: ExpertScoring
  onScoringChange?: (scoring: ExpertScoring) => void
  hideScoringBanner?: boolean
}) {
  const detected = scoringFor(leagueScoring)
  const initialSettings = useMemo(() => loadRankSettings(), [])
  const initialMode: SourceMode = initialSettings.enabledIds.some((id) => id.startsWith(EXPERT_PREFIX)) ? 'experts' : 'consensus'
  const [localScoring, setLocalScoring] = useState<ExpertScoring>(scoringProp ?? detected.scoring)
  const scoring = scoringProp ?? localScoring
  const [mode, setMode] = useState<SourceMode>(initialMode)
  const [selected, setSelected] = useState<string[]>(() => installedExpertSlugs(initialSettings.enabledIds, scoringProp ?? detected.scoring))
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const autoApplied = useRef(false)
  const snapshotQuery = useQuery({ queryKey: ['expert-rankings', scoring], queryFn: ({ signal }) => fetchExpertSnapshot(scoring, signal), staleTime: 300_000 })
  const snapshot = snapshotQuery.data
  const experts = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return (snapshot?.experts ?? []).filter((expert) => !needle || `${expert.name} ${expert.outlet ?? ''}`.toLocaleLowerCase().includes(needle))
  }, [query, snapshot])

  const activateConsensus = useCallback(async (automatic = false) => {
    setBusy(true); setError(null); if (!automatic) setNotice(null)
    try {
      const targetId = fantasyProsConsensusId(scoring)
      let imported = await loadImportedSets()
      if (!imported.some((set) => set.id === targetId)) {
        const collected = await fetchCollectedSnapshot()
        if (!collected) throw new Error('FantasyPros consensus has not been collected. Run the rankings collector first.')
        await installCollectedSets(collected, await matchingDirectory(directory), 'format')
        imported = await loadImportedSets()
      }
      if (!imported.some((set) => set.id === targetId)) throw new Error(`${SCORING_LABELS[scoring]} FantasyPros consensus is unavailable in the current snapshot.`)
      const settings = loadRankSettings()
      saveRankSettings({ ...settings, enabledIds: replaceFantasyProsSource(settings.enabledIds, [targetId]) })
      // The automatic pass must not steal the view. It starts on mount and
      // finishes whenever the snapshot arrives -- over the network that can be
      // long after you have clicked into the expert list, and forcing the mode
      // then throws you out of it mid-interaction. Consensus is already the
      // mode this panel opens in, so the automatic pass has nothing to set.
      if (!automatic) setMode('consensus')
      setNotice(`${SCORING_LABELS[scoring]} FantasyPros consensus enabled.`); onChange()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }, [directory, onChange, scoring])

  useEffect(() => {
    if (autoApplied.current) return
    const settings = loadRankSettings()
    const hasManagedSource = settings.enabledIds.some((id) => id.startsWith(EXPERT_PREFIX) || id.startsWith('collected:fantasypros-'))
    if (hasManagedSource) return
    autoApplied.current = true
    // Initial mount synchronizes the league's detected format with persisted ranking sets.
    // oxlint-disable-next-line react/set-state-in-effect
    void activateConsensus(true)
  }, [activateConsensus])

  async function activateExperts() {
    if (!snapshot || selected.length === 0) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const installed = await installExpertSets(snapshot, selected, await matchingDirectory(directory))
      if (!installed.length) throw new Error('None of the selected expert rows matched the player directory.')
      const settings = loadRankSettings()
      saveRankSettings({ ...settings, enabledIds: replaceFantasyProsSource(settings.enabledIds, installed.map((set) => set.id)) })
      setMode('experts'); setNotice(`${installed.length} expert ${installed.length === 1 ? 'board' : 'boards'} enabled.`); onChange()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  function changeScoring(next: ExpertScoring) {
    setLocalScoring(next); onScoringChange?.(next); setSelected(installedExpertSlugs(loadRankSettings().enabledIds, next)); setNotice(null); setError(null)
  }

  useEffect(() => {
    if (scoringProp == null || scoringProp === localScoring) return
    // Parent format select is the source of truth when the sheet lifts scoring.
    // oxlint-disable-next-line react/set-state-in-effect
    setLocalScoring(scoringProp)
    setSelected(installedExpertSlugs(loadRankSettings().enabledIds, scoringProp))
    setNotice(null)
    setError(null)
  }, [localScoring, scoringProp])

  return <section className="cc-expert-panel">
    {hideScoringBanner ? null : <div className={`cc-scoring-banner ${detected.detected ? '' : 'cc-scoring-guess'}`}><div><b>{SCORING_LABELS[scoring]}</b><span>{scoring === detected.scoring ? detected.detected ? 'Detected from your league' : 'League format unknown; defaulting to PPR' : 'Manual scoring override'}</span></div><label>Format<Select aria-label="Expert scoring format" value={scoring} onChange={(event) => changeScoring(event.target.value as ExpertScoring)}><option value="ppr">PPR</option><option value="half">Half PPR</option><option value="standard">Standard</option></Select></label></div>}
    <div className="cc-source-mode" aria-label="FantasyPros source mode"><button type="button" className={mode === 'consensus' ? 'active' : ''} onClick={() => setMode('consensus')}>Consensus</button><button type="button" className={mode === 'experts' ? 'active' : ''} onClick={() => setMode('experts')}>Individual experts</button></div>
    {mode === 'consensus' ? <div className="cc-consensus-mode"><div><b>FantasyPros consensus</b><p>Use the combined ECR board collected for {SCORING_LABELS[scoring]} leagues. Individual expert boards are disabled when this is applied.</p></div><button type="button" disabled={busy} title={busy ? 'A rankings update is already running.' : undefined} onClick={() => void activateConsensus()}>{busy ? 'Applying…' : 'Use consensus'}</button></div> : <div className="cc-expert-mode">
      <div className="cc-expert-summary"><span><b>{snapshot?.experts.length ?? '—'}</b> experts publish {SCORING_LABELS[scoring]}</span><span>Oldest board synced <b>{snapshot ? dateTime(oldestSync(snapshot)) : 'Loading…'}</b></span></div>
      <div className="cc-expert-tools"><label className="cc-search"><input aria-label="Search experts" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search experts or outlets…" /></label><span>{selected.length} selected</span><button type="button" disabled={!snapshot} title={!snapshot ? 'Expert snapshot is still loading.' : undefined} onClick={() => setSelected(snapshot?.experts.map((expert) => expert.slug) ?? [])}>Select all</button><button type="button" disabled={!selected.length} title={!selected.length ? 'No experts are selected.' : undefined} onClick={() => setSelected([])}>Clear</button></div>
      {snapshotQuery.isLoading ? <div className="cc-expert-empty">Loading expert boards…</div> : snapshotQuery.isError || !snapshot ? <div className="cc-expert-empty">Expert rankings are unavailable. Run <code>npm run scrape:experts</code>.</div> : <div className="cc-expert-list">{experts.map((expert) => <label key={expert.slug}><input type="checkbox" checked={selected.includes(expert.slug)} onChange={() => setSelected((current) => current.includes(expert.slug) ? current.filter((slug) => slug !== expert.slug) : [...current, expert.slug])} /><span><b>{expert.name}</b><small>{expert.outlet ?? 'Independent'} · {expert.count} players</small></span><time dateTime={new Date(expert.fetchedAt).toISOString()}>{dateTime(expert.fetchedAt)}</time></label>)}</div>}
      <button type="button" className="cc-wide" disabled={busy || !snapshot || selected.length === 0} title={!snapshot ? 'Expert snapshot is unavailable.' : selected.length === 0 ? 'Select at least one expert.' : busy ? 'A rankings update is already running.' : undefined} onClick={() => void activateExperts()}>{busy ? 'Installing…' : `Use ${selected.length} selected expert${selected.length === 1 ? '' : 's'}`}</button>
    </div>}
    {receptionPremium?.length ? <p className="cc-scoring-premium">
      Your league pays {receptionPremium.map((item) => `${item.position} ${item.points} per reception`).join(', ')}.
      No published board is built for that, so these rankings understate {receptionPremium.map((item) => item.position).join(' and ')}.
    </p> : null}
    {notice ? <p className="cc-expert-notice">{notice}</p> : null}{error ? <p className="cc-expert-error">{error}</p> : null}
  </section>
}
