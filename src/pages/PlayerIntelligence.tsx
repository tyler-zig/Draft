import { useCallback, useEffect, useMemo, useState } from 'react'
import { useInfiniteScroll } from '../hooks/useInfiniteScroll'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { sleeperProvider } from '../providers/sleeperProvider'
import { getProvider } from '../providers'
import { loadQueue, queueIdForPlayer, queueIncludesPlayer, saveQueue, subscribeQueue } from '../draft/queue'
import { defaultSlotCounts, type Player, type ScoringType } from '../providers/types'
import { applyConsensusRanks, attachSetRange, builtinSet, getPlayerRankFacts } from '../rankings/consensus'
import { fetchCollectedSnapshot, toRankSets } from '../rankings/collected'
import { applyLiveAdp, liveAdpQuery } from '../rankings/liveAdp'
import { shownTier, tierColorClass } from '../rankings/tiers'
import { loadImportedSets, loadRankSettings } from '../rankings/store'
import { attachHistoryRange, getPlayerNews, playerIntelligenceQueryKey, getRankingHistoryCatalog, lookupMarketHistory, marketHistoryTrend, type PlayerNewsItem } from '../api/playerIntelligence'
import { getPlayerHistoricalIntelligence, getPublishedSchedule, playerScheduleFromHistorical, type HistoricalSeason } from '../api/playerHistorical'
import { attachProjectedAdp, getNflProjections, projectionPointsPool, projectionSeason, viewPlayerProjection } from '../api/playerProjections'
import { byeWeekFromSchedule, type PlayerScheduleView } from '../intelligence/calculations/matchup'
import { applyScheduleByes, attachProjectedPoints } from '../intelligence/players'
import { injuryTone } from '../draft/injuryStatus'
import { withVorp } from '../draft/vorp'
import { InjuryDot } from '../components/InjuryDot'
import { PlayerScheduleGrid } from '../components/PlayerSchedule'
import { MarketHistory } from '../components/MarketHistory'
import { AccountButton } from '../components/AccountButton'
import type { ProjectionSourceLine } from '../api/collectedProjections'
import { PlayerPhoto } from '../components/PlayerPhoto'
import { ProjectionHover } from '../components/ProjectionHover'
import { PlayerTwitterLink } from '../components/PlayerTwitterLink'
import { RankingsSheet } from '../components/RankingsSheet'
import { Select } from '../components/Select'
import { isFantasyProsSource } from '../rankings/expertSelection'
import { loadCurrentDraft, scoringLabel } from '../draft/currentDraft'
import './command-center.css'
import './player-intelligence.css'

const PAGE_SIZE = 18
const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'] as const
const LATE_POSITIONS = new Set(['K', 'DEF'])
const PI_PANELS = ['market', 'news', 'projection', 'historical', 'trend', 'usage', 'schedule'] as const
const COLLAPSED_PANELS_KEY = 'draft-assistant:pi-collapsed-panels'
type PositionFilter = (typeof POSITIONS)[number]
type KnownScoring = Exclude<ScoringType, 'unknown'>
type PiPanel = (typeof PI_PANELS)[number]

function loadCollapsedPanels(): Set<PiPanel> {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLLAPSED_PANELS_KEY) ?? 'null') as unknown
    if (!Array.isArray(parsed)) return new Set()
    const allowed = new Set<string>(PI_PANELS)
    return new Set(parsed.filter((id): id is PiPanel => typeof id === 'string' && allowed.has(id)))
  } catch {
    return new Set()
  }
}

function saveCollapsedPanels(collapsed: Set<PiPanel>) {
  try { localStorage.setItem(COLLAPSED_PANELS_KEY, JSON.stringify([...collapsed])) } catch { /* ignore */ }
}

const STANDARD_TEAMS = 12
const formatRank = (value: number | null | undefined) => value == null ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(1)
const formatVorp = (value: number | null | undefined) => value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
const rankLabel = (player: Player) => player.searchRank >= 9000 ? '—' : formatRank(player.searchRank)
const formatDate = (value: number) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
const scoringFrom = (value: string | null, fallback: ScoringType | undefined): KnownScoring => value === 'half_ppr' || value === 'std' || value === 'ppr' ? value : fallback && fallback !== 'unknown' ? fallback : 'ppr'

export function PlayerIntelligence() {
  const [params, setParams] = useSearchParams()
  const [currentDraft] = useState(() => loadCurrentDraft())
  const scoringType = scoringFrom(params.get('scoring'), currentDraft?.scoringType)
  const queueKey = currentDraft ? `${currentDraft.provider}:${currentDraft.draftId}` : 'player-intelligence'
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<PositionFilter>('ALL')
  const [maxRank, setMaxRank] = useState(150)
  const [availableOnly, setAvailableOnly] = useState(Boolean(currentDraft))
  const [hideInjured, setHideInjured] = useState(false)
  const [rookiesOnly, setRookiesOnly] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [rankingsOpen, setRankingsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [collapsedPanels, setCollapsedPanels] = useState(loadCollapsedPanels)
  const [queuedIds, setQueuedIds] = useState(() => loadQueue(queueKey))
  const [rankSettings, setRankSettings] = useState(loadRankSettings)

  const playersQuery = useQuery({ queryKey: ['players', 'sleeper'], queryFn: () => sleeperProvider.getPlayers(), staleTime: 86_400_000 })
  const scheduleQuery = useQuery({ queryKey: ['published-schedule'], queryFn: ({ signal }) => getPublishedSchedule(signal), staleTime: 86_400_000 })
  const importedQuery = useQuery({ queryKey: ['rank-sets'], queryFn: loadImportedSets, staleTime: 60_000 })
  const picksQuery = useQuery({
    queryKey: ['picks', currentDraft?.provider, currentDraft?.draftId],
    queryFn: () => getProvider(currentDraft!.provider).getPicks(currentDraft!.draftId),
    enabled: Boolean(currentDraft),
    refetchInterval: currentDraft ? 2_000 : false,
    retry: false,
  })
  const takenIds = useMemo(() => new Set((picksQuery.data ?? []).map((pick) => pick.playerId)), [picksQuery.data])
  const season = projectionSeason(currentDraft?.season)
  const projectionsQuery = useQuery({ queryKey: ['nfl-projections', season], queryFn: ({ signal }) => getNflProjections(season, signal), staleTime: 3_600_000, retry: false })
  const liveAdpSnapshotQuery = useQuery(liveAdpQuery)
  const collectedQuery = useQuery({ queryKey: ['rankings-latest'], queryFn: ({ signal }) => fetchCollectedSnapshot(signal), staleTime: 3_600_000, retry: false })
  const historyCatalogQuery = useQuery({ queryKey: ['ranking-history-catalog'], queryFn: ({ signal }) => getRankingHistoryCatalog(signal), staleTime: 300_000, retry: false })
  const directory = useMemo(() => applyScheduleByes((playersQuery.data ?? []).filter((player) => player.searchRank < 9000 || LATE_POSITIONS.has(player.position)), scheduleQuery.data), [playersQuery.data, scheduleQuery.data])
  const sets = useMemo(() => {
    if (!directory.length) return []
    const sleeper = builtinSet('builtin:sleeper', 'Sleeper player rank', directory)
    sleeper.fetchedAt = playersQuery.dataUpdatedAt
    return [sleeper, ...(importedQuery.data ?? [])]
  }, [directory, importedQuery.data, playersQuery.dataUpdatedAt])
  const scoringSets = useMemo(() => sets.filter((set) => set.scoring === scoringType || set.scoring === 'unknown'), [scoringType, sets])
  const activeSets = useMemo(() => scoringSets.filter((set) => rankSettings.enabledIds.includes(set.id)), [rankSettings.enabledIds, scoringSets])
  const activeSourceRows = useMemo(() => {
    const fantasyPros = activeSets.filter((set) => isFantasyProsSource(set.id))
    const other = activeSets.filter((set) => !isFantasyProsSource(set.id)).map((set) => ({ id: set.id, label: set.label, detail: `${set.rows.length} matched players` }))
    if (!fantasyPros.length) return other
    const consensus = fantasyPros.find((set) => set.id.startsWith('collected:fantasypros-'))
    return [{
      id: 'fantasypros',
      label: consensus ? 'FantasyPros consensus' : `FantasyPros experts`,
      detail: consensus ? `${consensus.rows.length} matched players` : `${fantasyPros.length} expert board${fantasyPros.length === 1 ? '' : 's'}`,
    }, ...other]
  }, [activeSets])
  const players = useMemo(() => applyConsensusRanks(directory, scoringSets, rankSettings.enabledIds, rankSettings.method, scoringType), [directory, scoringSets, rankSettings, scoringType])
  const collectedSets = useMemo(() => collectedQuery.data && directory.length ? toRankSets(collectedQuery.data, directory) : [], [collectedQuery.data, directory])
  const rangeSets = useMemo(() => {
    const byId = new Map(scoringSets.map((set) => [set.id, set]))
    for (const set of collectedSets) byId.set(set.id, set)
    return [...byId.values()]
  }, [collectedSets, scoringSets])
  const leagueSettings = scoringType === currentDraft?.scoringType ? currentDraft.scoringSettings : null
  const valuedPlayers = useMemo(() => {
    const withPoints = attachProjectedPoints(players, projectionPointsPool(projectionsQuery.data, scoringType, leagueSettings))
    const withAdp = attachProjectedAdp(withPoints, projectionsQuery.data, scoringType)
    const teams = currentDraft?.teams && currentDraft.teams > 0 ? currentDraft.teams : STANDARD_TEAMS
    const withLive = applyLiveAdp(withVorp(withAdp, currentDraft?.slots ?? defaultSlotCounts(), teams), liveAdpSnapshotQuery.data, teams, scoringType)
    return attachHistoryRange(attachSetRange(withLive, rangeSets), historyCatalogQuery.data)
  }, [currentDraft, historyCatalogQuery.data, leagueSettings, liveAdpSnapshotQuery.data, players, projectionsQuery.data, rangeSets, scoringType])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return valuedPlayers
      .filter((player) => !availableOnly || !takenIds.has(player.id))
      .filter((player) => position === 'ALL' || player.position === position || position === 'FLEX' && ['RB', 'WR', 'TE'].includes(player.position))
      .filter((player) => LATE_POSITIONS.has(position) || Boolean(needle) || player.searchRank <= maxRank)
      .filter((player) => !hideInjured || !player.injuryStatus)
      .filter((player) => !rookiesOnly || player.yearsExp === 0)
      .filter((player) => !needle || `${player.fullName} ${player.position} ${player.team ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => a.searchRank - b.searchRank)
  }, [availableOnly, hideInjured, maxRank, position, query, rookiesOnly, takenIds, valuedPlayers])
  const hasMore = visibleCount < filtered.length
  const loadMore = useCallback(() => setVisibleCount((count) => Math.min(filtered.length, count + PAGE_SIZE)), [filtered.length])
  const { rootRef, sentinelRef } = useInfiniteScroll(hasMore, loadMore, visibleCount)

  const requested = params.get('playerId')
  const selected = valuedPlayers.find((player) => player.id === requested || player.sleeperId === requested || player.espnId === requested || player.gsisId === requested) ?? filtered[0] ?? valuedPlayers[0]
  const [historyReady, setHistoryReady] = useState(false)
  useEffect(() => {
    if (playersQuery.isLoading) return
    const timer = window.setTimeout(() => setHistoryReady(true), 0)
    return () => window.clearTimeout(timer)
  }, [playersQuery.isLoading])
  const historicalQuery = useQuery({ queryKey: ['historical-intelligence', selected?.id, scoringType], queryFn: ({ signal }) => getPlayerHistoricalIntelligence(selected!, signal, scoringType), enabled: Boolean(selected) && historyReady, staleTime: 300_000, retry: false })
  const newsPlayer = selected ? { ...selected, espnId: selected.espnId ?? historicalQuery.data?.espnId ?? undefined } : undefined
  const newsQuery = useQuery({
    queryKey: ['player-news', newsPlayer ? playerIntelligenceQueryKey(newsPlayer) : null],
    queryFn: ({ signal }) => getPlayerNews(newsPlayer!, signal),
    enabled: Boolean(newsPlayer) && (Boolean(newsPlayer?.espnId) || !historicalQuery.isFetching),
    staleTime: 300_000,
    retry: false,
  })

  useEffect(() => subscribeQueue(queueKey, setQueuedIds), [queueKey])

  function togglePanel(panel: PiPanel) {
    setCollapsedPanels((current) => {
      const next = new Set(current)
      if (next.has(panel)) next.delete(panel)
      else next.add(panel)
      saveCollapsedPanels(next)
      return next
    })
  }
  function resetRows() { setVisibleCount(PAGE_SIZE) }
  function selectPlayer(player: Player) { const next = new URLSearchParams(params); next.set('playerId', player.id); setParams(next, { replace: true }) }
  function selectScoring(value: KnownScoring) { const next = new URLSearchParams(params); next.set('scoring', value); setParams(next, { replace: true }) }
  function toggleQueue(player = selected) {
    if (!player) return
    const aliases = new Set([player.id, player.sleeperId, player.espnId, player.gsisId].filter((id): id is string => Boolean(id)))
    const next = queueIncludesPlayer(queuedIds, player) ? queuedIds.filter((id) => !aliases.has(id)) : [...queuedIds, queueIdForPlayer(player, currentDraft?.provider)]
    setQueuedIds(next); saveQueue(queueKey, next)
  }
  function refreshRankings() {
    setRankSettings(loadRankSettings())
    void importedQuery.refetch()
  }

  if (playersQuery.isLoading) return <div className="pi-loading"><span className="spinner" />Loading player intelligence…</div>
  if (!selected) return <div className="pi-loading">Player data is unavailable.</div>

  const rankFacts = getPlayerRankFacts(selected, scoringSets, rankSettings.enabledIds)
  const consensus = selected.consensusCount ? selected.searchRank : null
  const isQueued = queueIncludesPlayer(queuedIds, selected)
  const historicalSeasons = historicalQuery.data?.seasons ?? []
  const latestHistorical = [...historicalSeasons].reverse().find((season) => season.gamesPlayed > 0) ?? historicalSeasons.at(-1)
  const gamesMissed = historicalSeasons.reduce((total, season) => total + season.durability.gamesMissed, 0)
  const historyTitle = historicalQuery.data?.updatedAt ? `${historicalQuery.data.source} · Updated ${new Date(historicalQuery.data.updatedAt).toLocaleString()}` : historicalQuery.data?.source ?? 'Loading nflverse history'
  const receptionOverride = scoringType === currentDraft?.scoringType ? currentDraft.receptionPremium?.find((premium) => premium.position === selected.position)?.points ?? null : null
  const contextLabel = receptionOverride == null ? scoringLabel(scoringType) : `${scoringLabel(scoringType)} · ${selected.position} ${receptionOverride} PPR`
  const projection = viewPlayerProjection(selected, projectionsQuery.data, scoringType, { scoringSettings: leagueSettings, receptionOverride })
  const projectionPending = projectionsQuery.isPending
  const receivingLabel = projection?.targets != null ? 'Projected targets' : 'Projected receptions'
  const receivingValue = projection?.targets ?? projection?.receptions
  const schedule = historicalQuery.data ? playerScheduleFromHistorical(historicalQuery.data, selected, scoringType) : null
  const byeWeek = byeWeekFromSchedule(schedule?.weeks) ?? selected.bye
  const selectedHistory = lookupMarketHistory(historyCatalogQuery.data, newsPlayer ?? selected)
  const trend = selectedHistory.points
  const livePoint = (player: Player) => player.liveAdp != null ? { at: Date.now(), value: player.liveAdp } : null
  const formatTrend = (delta: number | null) => delta == null ? '—' : `${delta > 0 ? '↑ ' : delta < 0 ? '↓ ' : ''}${Math.abs(delta).toFixed(1)}`

  return <div className="player-intelligence">
    <header className="pi-topbar">
      <Link to="/" className="pi-brand"><span className="pi-mark">»</span>Draft Assistant</Link>
      <div className="pi-page-title"><small>Research workspace</small><b>Player Intelligence <span>· {contextLabel}</span></b></div>
      <div className="pi-top-actions"><nav><Link to="/">Leagues</Link><Link className="active" to="/players">Players</Link><button type="button" onClick={() => setRankingsOpen(true)}>Rankings</button></nav><AccountButton compact /></div>
    </header>

    <div className="pi-workspace">
      <aside className="pi-filters">
        <div className="pi-eyebrow">Player pool</div><h1>{currentDraft?.season ?? '2026'} Rankings</h1><p>{activeSets.length} enabled source{activeSets.length === 1 ? '' : 's'} · {scoringLabel(scoringType)}</p>
        <FilterSection title="Position" action={<button type="button" onClick={() => { setPosition('ALL'); resetRows() }}>Clear</button>}><div className="pi-position-grid">{POSITIONS.map((value) => <button type="button" className={position === value ? 'active' : ''} key={value} onClick={() => { setPosition(value); resetRows() }}>{value === 'ALL' ? 'All players' : value}</button>)}</div></FilterSection>
        <FilterSection title="Draft range" action={<b>Top {maxRank}</b>}><input aria-label="Maximum rank" type="range" min="25" max="300" step="25" value={maxRank} onChange={(event) => { setMaxRank(Number(event.target.value)); resetRows() }} /><div className="pi-range-labels"><span>25</span><span>300</span></div>{currentDraft ? <label className="pi-check"><input type="checkbox" checked={availableOnly} onChange={(event) => { setAvailableOnly(event.target.checked); resetRows() }} />Available only</label> : <span className="pi-filter-note">Connect a draft to filter availability.</span>}<label className="pi-check"><input type="checkbox" checked={hideInjured} onChange={(event) => { setHideInjured(event.target.checked); resetRows() }} />Hide injured</label><label className="pi-check"><input type="checkbox" checked={rookiesOnly} onChange={(event) => { setRookiesOnly(event.target.checked); resetRows() }} />Rookies only</label></FilterSection>
        <FilterSection title="Ranking sources" action={<button type="button" onClick={() => setRankingsOpen(true)}>Manage</button>}><div className="pi-source-list">{activeSourceRows.length ? activeSourceRows.map((source) => <button type="button" key={source.id} onClick={() => setRankingsOpen(true)}><span>{source.label}<small>{source.detail}</small></span><i className="on" /></button>) : <button type="button" onClick={() => setRankingsOpen(true)}><span>No sources enabled<small>Open rankings to build a recipe</small></span></button>}</div></FilterSection>
        <div className="pi-queue-card"><b>Draft queue</b><span>{queuedIds.length} player{queuedIds.length === 1 ? '' : 's'} saved {currentDraft ? 'for this draft' : 'locally'}</span>{currentDraft ? <Link to={currentDraft.href}>Open {currentDraft.leagueName ?? `${currentDraft.provider.toUpperCase()} draft`}</Link> : <button type="button" disabled title="Connect a league to open its draft queue.">No draft connected</button>}</div>
      </aside>

      <main className="pi-center">
        <div className="pi-summary"><section><div><div className="pi-eyebrow">Cross-platform board</div><h2>Available players</h2></div><span className="pi-live">● Rankings current</span></section><MetricCard label="Players" value={String(filtered.length)} note={`${directory.length} indexed`} /><MetricCard label="Sources" value={String(activeSets.length)} note={`${scoringLabel(scoringType)} boards`} /><MetricCard label="Last sync" value={playersQuery.dataUpdatedAt ? ago(playersQuery.dataUpdatedAt) : '—'} note="Player directory" /></div>
        <div className="pi-toolbar"><label className="pi-table-search"><input value={query} onChange={(event) => { setQuery(event.target.value); resetRows() }} placeholder="Search player, team, or position…" /><span>⌕</span></label><Select aria-label="Scoring format" value={scoringType} onChange={(event) => selectScoring(scoringFrom(event.target.value, scoringType))}><option value="ppr">PPR</option><option value="half_ppr">Half PPR</option><option value="std">Standard</option></Select><span className="pi-sort-label">Consensus rank</span></div>
        <div className="cc-table-wrap" ref={rootRef}>
          <table className="cc-player-table">
            <thead><tr>
              <th>Rank</th><th>Player</th><th>Pos</th><th>Tier</th><th>ADP</th>
              <th title="FantasyPros Real-Time ADP for this league's scoring. Falls back to Draft Wizard mock-draft ADP for league size when that board is missing. Checked every 15 minutes.">Live ADP</th>
              <th title="Points above a replacement-level player at the same position, using the consensus season projection.">VORP</th>
              <th title="Best-to-worst expert rank from collected boards and ranking history. Independent of which sources are enabled for consensus.">Range</th>
              <th title="Movement from FantasyPros Last 7 / Last 1 rolling ADP, then collected snapshots once those exist. Positive means the player is being drafted earlier.">Trend</th>
              <th>Queue</th>
            </tr></thead>
            <tbody>{filtered.slice(0, visibleCount).map((player) => {
              const queued = queueIncludesPlayer(queuedIds, player), taken = takenIds.has(player.id), tier = shownTier(player), isSelected = player.id === selected.id
              const playerTrend = marketHistoryTrend(lookupMarketHistory(historyCatalogQuery.data, player).points, livePoint(player))
              const trendTone = (playerTrend ?? 0) > 0 ? 'cc-up' : (playerTrend ?? 0) < 0 ? 'cc-down' : ''
              return <tr key={player.id} className={`${isSelected ? 'cc-selected' : ''} ${taken ? 'cc-taken' : ''}`} onClick={() => selectPlayer(player)}>
                <td><div className="cc-rank"><button type="button" className={`cc-star ${queued ? 'cc-on' : ''}`} disabled={taken} aria-label={queued ? 'Remove row from draft queue' : 'Add row to draft queue'} title={queued ? `Remove ${player.fullName} from queue` : `Add ${player.fullName} to queue`} onClick={(event) => { event.stopPropagation(); toggleQueue(player) }}>★</button>{rankLabel(player)}</div></td>
                <td><div className="cc-player"><PlayerPhoto player={player} className="cc-avatar-md" /><span><span className="cc-player-name">{player.fullName}<InjuryDot status={player.injuryStatus} /></span><span className="cc-player-team">{taken ? 'Drafted' : player.team ?? 'Free Agent'}</span></span></div></td>
                <td><span className={`cc-pos cc-${player.position.toLowerCase()}`}>{player.position}</span></td>
                <td><span className={`cc-tier-pill ${tierColorClass(tier)}`}>Tier {tier}</span></td>
                <td><span className="cc-num">{formatRank(player.adp)}</span></td>
                <td><span className="cc-num">{formatRank(player.liveAdp)}</span></td>
                <td><span className={`cc-num ${player.vorp == null ? '' : player.vorp >= 0 ? 'cc-up' : 'cc-down'}`}>{formatVorp(player.vorp)}</span></td>
                <td><span className="cc-num">{player.rankLow == null ? '—' : `${formatRank(player.rankLow)}–${formatRank(player.rankHigh)}`}</span></td>
                <td><span className={`cc-num ${trendTone}`}>{formatTrend(playerTrend)}</span></td>
                <td>{queued ? <span className="cc-up">Queued</span> : '—'}</td>
              </tr>
            })}</tbody>
          </table>
          {hasMore ? <div ref={sentinelRef} className="cc-infinite-sentinel" aria-hidden="true" /> : null}
          {!filtered.length ? <div className="cc-table-empty">No players match these filters.</div> : null}
        </div>
        <footer className="pi-pager"><span>Showing {Math.min(visibleCount, filtered.length)} of {filtered.length} players{hasMore ? ' · Scroll to load more' : ''}</span>{hasMore ? <span>Loading more players…</span> : <span>All matching players loaded</span>}</footer>
      </main>

      <aside className="pi-detail">
        <section className="pi-detail-hero"><div className="pi-detail-kicker"><span className="pi-eyebrow">Selected player</span><span className={injuryTone(selected.injuryStatus) === 'out' ? 'down' : selected.injuryStatus ? 'warn' : 'up'}>● {selected.injuryStatus ?? 'Active'}</span></div><div className="pi-detail-id"><PlayerPhoto player={selected} variant="plain" /><div><h2>{selected.fullName}</h2><p><span className={`pi-pos pi-${selected.position.toLowerCase()}`}>{selected.position}</span>{selected.team ?? 'Free Agent'} · Bye {byeWeek ?? '—'} <PlayerTwitterLink player={selected} className="pi-x" /></p></div></div><div className="pi-bio"><Bio label="Bye" value={byeWeek} /><Bio label="Height" value={selected.height} /><Bio label="Weight" value={selected.weight == null ? null : `${selected.weight} lbs`} /><Bio label="Age" value={selected.age} /></div><button type="button" className={isQueued ? 'pi-add queued' : 'pi-add'} onClick={() => toggleQueue()}>{isQueued ? '✓ In draft queue' : '＋ Add to draft queue'}</button></section>
        <DetailPanel panel="market" id="market" title="Market & consensus" meta={`${contextLabel} · ${rankFacts.sources.length} sources`} collapsed={collapsedPanels.has('market')} onToggle={togglePanel}><div className="pi-market-grid"><Value label="Consensus" value={formatRank(consensus)} /><Value label="ADP" value={formatRank(selected.adp)} /><Value label="Live ADP" value={formatRank(selected.liveAdp)} accent /><Value label="vs 1 day" value={selected.liveAdpVsLastOne == null ? '—' : formatTrend(selected.liveAdpVsLastOne)} /><Value label="vs 7 days" value={selected.liveAdpVsLastSeven == null ? '—' : formatTrend(selected.liveAdpVsLastSeven)} /><Value label="Range" value={selected.rankLow == null ? '—' : `${formatRank(selected.rankLow)} – ${formatRank(selected.rankHigh)}`} /></div><div className="pi-market-sources">{rankFacts.sources.length ? rankFacts.sources.map((source) => <div key={source.id} title={`Updated ${formatDate(source.fetchedAt)}`}><span>{source.label}: {formatRank(source.rank)}</span></div>) : <p>No enabled {scoringLabel(scoringType)} source reports this player.</p>}</div></DetailPanel>
        <DetailPanel panel="news" title="Latest news" meta={newsQuery.data?.news.length ? `${newsQuery.data.news.length} update${newsQuery.data.news.length === 1 ? '' : 's'}` : newsQuery.isPending ? 'Loading' : 'Unavailable'} collapsed={collapsedPanels.has('news')} onToggle={togglePanel}><NewsFeed items={newsQuery.data?.news ?? []} loading={newsQuery.isPending} message={newsQuery.data?.newsMessage ?? null} /></DetailPanel>
        <DetailPanel panel="projection" title="Projection & historical output" meta={projection ? `${contextLabel} · ${projection.source}` : contextLabel} collapsed={collapsedPanels.has('projection')} onToggle={togglePanel}><div className="pi-projection-grid"><ProjectionMetric label="Projected points" value={projection?.points} pending={projectionPending} breakdown={projection?.breakdown} /><ProjectionMetric label="VORP" value={selected.vorp} pending={projectionPending} signed /><ProjectionMetric label={selected.position === 'QB' ? 'Projected attempts' : 'Projected carries'} value={selected.position === 'QB' ? projection?.passAttempts : projection?.rushAttempts} pending={projectionPending} breakdown={projection?.breakdown} pick={(line) => selected.position === 'QB' ? line.stats.pass_att : line.stats.rush_att} /><ProjectionMetric label={receivingLabel} value={receivingValue} pending={projectionPending} breakdown={projection?.breakdown} pick={(line) => projection?.targets != null ? line.stats.rec_tgt : line.stats.rec} /><ProjectionMetric label="Projected PPG" value={projection?.ppg} pending={projectionPending} breakdown={projection?.breakdown} pick={(line) => line.points != null && line.games ? line.points / line.games : null} /></div>{latestHistorical ? <HistoricalOutput season={latestHistorical} title={historyTitle} scoringType={scoringType} receptionOverride={receptionOverride} /> : <Unavailable title="Historical output unavailable" detail={historicalQuery.data?.message ?? 'Loading nflverse weekly statistics…'} />}<p className="pi-honesty"><b>{projection ? `${projection.season} season projection` : 'Season projection unavailable'}</b>{projection ? `${projection.source}${projection.updatedAt ? ` · updated ${formatDate(projection.updatedAt)}` : ''}. Hover a projected stat for each source's line. VORP is points above a replacement-level ${selected.position} in ${currentDraft?.slots ? 'this league' : 'a standard 12-team lineup'}. The weekly chart is observed ${scoringLabel(scoringType)} history, not a weekly forecast.` : `No season projection is published for this player. The weekly chart is observed ${scoringLabel(scoringType)} history, not a forecast.`}</p></DetailPanel>
        <HistoricalLibrary seasons={historicalSeasons} scoringType={scoringType} receptionOverride={receptionOverride} loading={historicalQuery.isLoading} message={historicalQuery.data?.message} collapsed={collapsedPanels.has('historical')} onToggle={togglePanel} onOpen={() => setHistoryOpen(true)} />
        <DetailPanel panel="trend" title="Market trend" meta={`${trend.length} observations`} collapsed={collapsedPanels.has('trend')} onToggle={togglePanel}><MarketHistory history={selectedHistory} loading={historyCatalogQuery.isLoading} live={livePoint(selected)} /></DetailPanel>
        <DetailPanel panel="usage" id="usage" title="Usage & durability" meta="nflverse + Sleeper" collapsed={collapsedPanels.has('usage')} onToggle={togglePanel}>{latestHistorical ? <><div className="pi-usage"><UsageMetric label="Touch share" value={latestHistorical.usage.touchShare} /><UsageMetric label="Red-zone share" value={latestHistorical.usage.redZoneTouchShare} /><UsageMetric label="Snap share" value={latestHistorical.usage.snapShare} /><Value label="Opportunities" value={String(latestHistorical.usage.opportunities)} /></div><div className="pi-durability"><div><span><small>Current status</small>{selected.injuryStatus ?? 'No injury designation'}</span><b className={injuryTone(selected.injuryStatus) === 'out' ? 'down' : selected.injuryStatus ? 'warn' : 'up'}>{injuryTone(selected.injuryStatus) === 'out' ? selected.injuryStatus : selected.injuryStatus ? 'Monitor' : 'Active'}</b></div><div><span><small>Games missed ({historicalSeasons.map((season) => season.season).join('–')})</small>{historicalSeasons.map((season) => `${season.season}: ${season.durability.gamesMissed}`).join(' · ')}</span><b>{gamesMissed}</b></div><p>Byes and DEV/CUT roster weeks are excluded. Injury risk is not inferred.</p></div></> : <Unavailable title="Usage unavailable" detail={historicalQuery.data?.message ?? 'Loading nflverse usage data…'} />}</DetailPanel>
        <ScheduleCard schedule={schedule} loading={historicalQuery.isLoading} source={historyTitle} scoringLabel={scoringLabel(scoringType)} collapsed={collapsedPanels.has('schedule')} onToggle={togglePanel} />
      </aside>
    </div>
    {rankingsOpen ? <RankingsSheet leagueName={currentDraft?.leagueName ?? 'Player Intelligence'} leagueScoring={scoringType} receptionPremium={currentDraft?.receptionPremium} directory={directory} builtinSets={sets.filter((set) => set.kind === 'builtin')} importedSets={importedQuery.data ?? []} rankSettings={rankSettings} onClose={() => setRankingsOpen(false)} onChange={refreshRankings} /> : null}
    {historyOpen && historicalSeasons.length ? <HistoryExplorer player={selected} seasons={historicalSeasons} scoringType={scoringType} receptionOverride={receptionOverride} source={historyTitle} onClose={() => setHistoryOpen(false)} /> : null}
  </div>
}

function FilterSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) { return <section className="pi-filter-section"><header><span>{title}</span>{action}</header>{children}</section> }
function MetricCard({ label, value, note }: { label: string; value: string; note: string }) { return <div className="pi-metric-card"><small>{label}</small><b>{value}</b><span>{note}</span></div> }
function Bio({ label, value }: { label: string; value: string | number | null | undefined }) { return <div><small>{label}</small><b>{value ?? '—'}</b></div> }
function Value({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div><small>{label}</small><b className={accent ? 'up' : ''}>{value}</b></div> }
function DetailPanel({ panel, title, meta, id, collapsed, onToggle, children }: { panel: PiPanel; title: string; meta?: string; id?: string; collapsed: boolean; onToggle: (panel: PiPanel) => void; children: React.ReactNode }) {
  const open = !collapsed
  return <section id={id} className={`pi-panel${open ? '' : ' collapsed'}`}>
    <header>
      <button type="button" className="pi-panel-toggle" aria-expanded={open} onClick={() => onToggle(panel)}>
        <i className="pi-panel-chevron" aria-hidden="true" />
        <b>{title}</b>
        {meta ? <span>{meta}</span> : null}
      </button>
    </header>
    {open ? children : null}
  </section>
}
function UnavailableMetric({ label }: { label: string }) { return <div title="No Sleeper season projection for this player"><small>{label}</small><b>—</b><span>UNAVAILABLE</span></div> }
function ProjectionMetric({
  label,
  value,
  pending = false,
  signed = false,
  breakdown,
  pick,
}: {
  label: string
  value: number | null | undefined
  pending?: boolean
  signed?: boolean
  breakdown?: ProjectionSourceLine[]
  pick?: (line: ProjectionSourceLine) => number | null | undefined
}) {
  if (pending) return <div><small>{label}</small><b>—</b><span>LOADING</span></div>
  if (value == null) return <UnavailableMetric label={label} />
  return (
    <div className="available" title={signed ? 'Points above a replacement-level player at this position' : undefined}>
      <small>{label}</small>
      <b className={signed ? (value >= 0 ? 'up' : 'down') : undefined}>
        {signed
          ? formatVorp(value)
          : <ProjectionHover value={value} breakdown={breakdown} pick={pick} label={label} />}
      </b>
      <span>{signed ? 'VS REPLACEMENT' : 'PROJECTED'}</span>
    </div>
  )
}
function UsageMetric({ label, value }: { label: string; value: number | null }) { return <Value label={label} value={value == null ? '—' : `${(value * 100).toFixed(1)}%`} /> }
function ago(at: number) { const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000)); return minutes < 1 ? 'Now' : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h` }

function scoringPoints(standard: number, ppr: number, scoringType: KnownScoring, receptionOverride: number | null) { if (receptionOverride != null) return standard + (ppr - standard) * receptionOverride; if (scoringType === 'ppr') return ppr; if (scoringType === 'half_ppr') return standard + (ppr - standard) / 2; return standard }
function HistoricalOutput({ season, title, scoringType, receptionOverride }: { season: HistoricalSeason; title: string; scoringType: KnownScoring; receptionOverride: number | null }) {
  const weekly = season.weekly.map((week) => scoringPoints(week.fantasyPoints, week.fantasyPointsPpr, scoringType, receptionOverride)), total = scoringPoints(season.stats.fantasyPoints, season.stats.fantasyPointsPpr, scoringType, receptionOverride), max = Math.max(...weekly, 1), label = receptionOverride == null ? scoringLabel(scoringType) : `${receptionOverride} PPR premium`
  return <div className="pi-history" title={title}><div><span>{season.season} weekly output <small>({label})</small></span><b>{season.gamesPlayed} G · {total.toFixed(1)} PTS</b></div><div className="pi-bars">{season.weekly.map((week, index) => <i key={week.week} style={{ height: `${Math.max(4, (weekly[index] ?? 0) / max * 100)}%` }}><title>Week {week.week} vs {week.opponent}: {(weekly[index] ?? 0).toFixed(1)} points</title></i>)}</div><footer>{season.weekly.map((week) => <span key={week.week}>{week.week}</span>)}</footer></div>
}
function Unavailable({ title, detail }: { title: string; detail: string }) { return <div className="pi-unavailable"><b>{title}</b><p>{detail}</p></div> }
function NewsFeed({ items, loading, message }: { items: PlayerNewsItem[]; loading: boolean; message: string | null }) {
  if (!items.length) return <Unavailable title="No recent headlines" detail={loading ? 'Loading player news…' : message ?? 'No sourced updates are available.'} />
  return <div className="pi-news">{items.map((item) => {
    const story = item.description && item.description !== item.headline ? item.description : null
    return <article key={item.id}>
      {item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.headline}</a> : <b>{item.headline}</b>}
      {story ? <p>{story}</p> : null}
      <time>{item.source}{item.published ? ` · ${new Date(item.published).toLocaleDateString()}` : ''}</time>
    </article>
  })}</div>
}
function shownStat(value: number | null | undefined, digits = 0) { return value == null ? '—' : value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) }
function shownPercent(value: number | null | undefined) { return value == null ? '—' : `${(value * 100).toFixed(1)}%` }

function HistoricalLibrary({ seasons, scoringType, receptionOverride, loading, message, collapsed, onToggle, onOpen }: { seasons: HistoricalSeason[]; scoringType: KnownScoring; receptionOverride: number | null; loading: boolean; message?: string | null; collapsed: boolean; onToggle: (panel: PiPanel) => void; onOpen: () => void }) {
  const ordered = [...seasons].sort((a, b) => b.season - a.season)
  const games = ordered.reduce((sum, season) => sum + season.gamesPlayed, 0)
  if (!ordered.length) return <DetailPanel panel="historical" title="Historical production" meta="nflverse" collapsed={collapsed} onToggle={onToggle}><Unavailable title={loading ? 'Loading historical seasons' : 'No historical seasons'} detail={message ?? 'No season or weekly records match this player.'} /></DetailPanel>
  return <DetailPanel panel="historical" title="Historical production" meta={`${ordered.length} season${ordered.length === 1 ? '' : 's'} · ${games} games`} collapsed={collapsed} onToggle={onToggle}><div className="pi-career-table"><table><thead><tr><th>Season</th><th>G</th><th>Points</th><th>PPG</th><th>Snap</th></tr></thead><tbody>{ordered.map((season) => { const points = scoringPoints(season.stats.fantasyPoints, season.stats.fantasyPointsPpr, scoringType, receptionOverride); return <tr key={season.season}><td>{season.season}</td><td>{season.gamesPlayed}</td><td>{points.toFixed(1)}</td><td>{season.gamesPlayed ? (points / season.gamesPlayed).toFixed(1) : '—'}</td><td>{shownPercent(season.usage.snapShare)}</td></tr> })}</tbody></table></div><button type="button" className="pi-history-open" onClick={onOpen}>Explore seasons and weekly game logs</button></DetailPanel>
}

function HistoryExplorer({ player, seasons, scoringType, receptionOverride, source, onClose }: { player: Player; seasons: HistoricalSeason[]; scoringType: KnownScoring; receptionOverride: number | null; source: string; onClose: () => void }) {
  const ordered = [...seasons].sort((a, b) => b.season - a.season)
  const [seasonYear, setSeasonYear] = useState(ordered[0]?.season)
  const season = ordered.find((item) => item.season === seasonYear) ?? ordered[0]
  if (!season) return null
  const total = scoringPoints(season.stats.fantasyPoints, season.stats.fantasyPointsPpr, scoringType, receptionOverride)
  const format = scoringLabel(scoringType)
  const statGroups = [
    { title: 'Passing', values: [['Completions', season.stats.completions], ['Attempts', season.stats.attempts], ['Yards', season.stats.passingYards], ['Touchdowns', season.stats.passingTds], ['Interceptions', season.stats.interceptions]] },
    { title: 'Rushing', values: [['Carries', season.stats.carries], ['Yards', season.stats.rushingYards], ['Touchdowns', season.stats.rushingTds]] },
    { title: 'Receiving', values: [['Receptions', season.stats.receptions], ['Targets', season.stats.targets], ['Yards', season.stats.receivingYards], ['Touchdowns', season.stats.receivingTds]] },
  ] as Array<{ title: string; values: Array<[string, number | null | undefined]> }>
  return <div className="pi-history-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="pi-history-explorer" role="dialog" aria-modal="true" aria-label={`${player.fullName} historical data`}>
      <header>
        <div>
          <span className="pi-eyebrow">Season archive</span>
          <h2>{player.fullName}</h2>
          <p>
            <span className={`pi-pos pi-${player.position.toLowerCase()}`}>{player.position}</span>
            {player.team ?? 'Free Agent'} · {format} · {source}
          </p>
        </div>
        <button type="button" aria-label="Close historical data" onClick={onClose}>×</button>
      </header>
      <div className="pi-history-explorer-main">
        <nav className="pi-history-years" aria-label="Historical season">
          {ordered.map((item) => <button type="button" className={item.season === season.season ? 'active' : ''} key={item.season} onClick={() => setSeasonYear(item.season)}>
            {item.season}<small>{item.gamesPlayed} G</small>
          </button>)}
        </nav>
        <div className="pi-history-explorer-body">
          <section className="pi-history-overview">
            <Value label="Games" value={String(season.gamesPlayed)} />
            <Value label={`${format} points`} value={total.toFixed(1)} accent />
            <Value label="Points/game" value={season.gamesPlayed ? (total / season.gamesPlayed).toFixed(1) : '—'} />
            <Value label="Games missed" value={String(season.durability.gamesMissed)} />
          </section>
          <div className="pi-history-stat-groups">{statGroups.map((group) => <section key={group.title}>
            <h3>{group.title}</h3>
            <div>{group.values.map(([label, value]) => <Value key={label} label={label} value={shownStat(value)} />)}</div>
          </section>)}</div>
          <section className="pi-history-usage">
            <h3>Usage and durability</h3>
            <div>
              <Value label="Opportunities" value={shownStat(season.usage.opportunities)} />
              <Value label="Touch share" value={shownPercent(season.usage.touchShare)} />
              <Value label="Red-zone opportunities" value={shownStat(season.usage.redZoneOpportunities)} />
              <Value label="Red-zone share" value={shownPercent(season.usage.redZoneTouchShare)} />
              <Value label="Offense snaps" value={shownStat(season.usage.offenseSnaps)} />
              <Value label="Snap share" value={shownPercent(season.usage.snapShare)} />
            </div>
            <p>Missed weeks: {season.durability.missedWeeks.length ? season.durability.missedWeeks.join(', ') : 'none'} · Status records: {Object.entries(season.durability.byStatus).map(([status, count]) => `${status} ${count}`).join(', ') || 'none'}</p>
          </section>
          <section className="pi-weekly-log">
            <header>
              <h3>{season.season} weekly game log</h3>
              <span>{season.weekly.length} records</span>
            </header>
            <div>
              <table>
                <thead><tr><th>Wk</th><th>Team</th><th>Opp</th><th>{format} pts</th><th>Std</th><th>PPR</th><th>Carries</th><th>Targets</th><th>Snaps</th></tr></thead>
                <tbody>{season.weekly.map((week) => <tr key={`${week.week}-${week.team}`}>
                  <td>{week.week}</td>
                  <td>{week.team || '—'}</td>
                  <td>{week.opponent || '—'}</td>
                  <td className="up">{scoringPoints(week.fantasyPoints, week.fantasyPointsPpr, scoringType, receptionOverride).toFixed(1)}</td>
                  <td>{shownStat(week.fantasyPoints, 1)}</td>
                  <td>{shownStat(week.fantasyPointsPpr, 1)}</td>
                  <td>{shownStat(week.carries)}</td>
                  <td>{shownStat(week.targets)}</td>
                  <td>{shownStat(week.offenseSnaps)}</td>
                </tr>)}</tbody>
              </table>
              {!season.weekly.length ? <div className="pi-empty">No weekly records for this season.</div> : null}
            </div>
          </section>
        </div>
      </div>
    </section>
  </div>
}
function ScheduleCard({ schedule, loading, source, scoringLabel: format, collapsed, onToggle }: { schedule: PlayerScheduleView | null; loading: boolean; source: string; scoringLabel: string; collapsed: boolean; onToggle: (panel: PiPanel) => void }) {
  if (loading && !schedule) return <DetailPanel panel="schedule" title="Schedule" collapsed={collapsed} onToggle={onToggle}><Unavailable title="Loading schedule" detail="Reading upcoming opponents and matchup strength." /></DetailPanel>
  if (!schedule || (schedule.message && !schedule.weeks.length)) return <DetailPanel panel="schedule" title="Schedule" meta="Not synced" collapsed={collapsed} onToggle={onToggle}><Unavailable title="Schedule data not synced" detail={schedule?.message ?? 'Upcoming opponents and matchup strength require the nflverse schedule model.'} /></DetailPanel>
  const window = schedule.window, title = `${source} · ${window.currentGames ? `${window.currentSeason} blended with ${window.priorSeason}` : `${window.priorSeason ?? window.currentSeason} data`}`
  return <DetailPanel panel="schedule" title="Schedule" meta={`${schedule.season} ${schedule.team} · ${format} · ${schedule.weeks.length} weeks`} collapsed={collapsed} onToggle={onToggle}><div title={title}><PlayerScheduleGrid schedule={schedule} /></div></DetailPanel>
}
