import { useCallback, useEffect, useMemo, useState } from 'react'
import { useInfiniteScroll } from '../hooks/useInfiniteScroll'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { DraftPick, Player, PlayoffWeeks, ScoringType } from '../providers/types'
import type { PlayerDraftContext } from '../draft/playerContext'
import { getPlayerIntelligence, playerIntelligenceQueryKey } from '../api/playerIntelligence'
import { PlayerDetail } from './PlayerDetail'
import { PlayerPhoto } from './PlayerPhoto'
import { TABLE_COLUMNS, type TableColumnKey } from '../preferences'
import { nflTeamLogoUrl } from '../draft/playerPhoto'
import { InjuryDot } from './InjuryDot'
import { shownTier, tierColorClass } from '../rankings/tiers'
import { TeamLogo } from './TeamLogo'
import { twitterCatalogQuery } from './PlayerTwitterLink'
import { Select } from './Select'
import { matchupTone, ordinal } from '../intelligence/calculations/matchup'

function TeamLabel({ team, fallback }: { team: string | null; fallback: string }) {
  const label = team ?? fallback
  const src = nflTeamLogoUrl(team)
  return <span className="cc-team-label">{src ? <TeamLogo src={src} label={label} decorative /> : null}{label}</span>
}

const FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
export type PositionFilter = (typeof FILTERS)[number]
export function isBoardPositionFilter(value: string): value is Exclude<PositionFilter, 'ALL'> {
  return value !== 'ALL' && (FILTERS as readonly string[]).includes(value)
}
const PAGE_SIZE = 14
type SortKey = TableColumnKey
const rankValue = (player: Player) => player.searchRank > 0 ? player.searchRank : 9999
const shownRank = (player: Player) => rankValue(player) >= 9000 ? '—' : Number.isInteger(player.searchRank) ? player.searchRank : player.searchRank.toFixed(1)
const tierFor = (player: Player, fallback = 1) => shownTier(player, fallback)

export function PlayerTable({ players, picks, canDraft, canMutateDraft, providerLabel, currentPickNo, queuedIds, selectedId, selectedContext, scoringType = 'ppr', playoffWeeks, visibleColumnKeys, onVisibleColumnKeysChange, onSelect, onDraft, onToggleQueue, positionFilter, onPositionFilterChange }: {
  players: Player[]; picks: DraftPick[]; canDraft: boolean; currentPickNo: number; queuedIds: string[]
  /** Draft standing of the selected player, for the detail dialog. */
  selectedContext?: PlayerDraftContext | null
  scoringType?: ScoringType
  playoffWeeks?: PlayoffWeeks | null
  canMutateDraft: boolean; providerLabel: string; visibleColumnKeys: TableColumnKey[]; onVisibleColumnKeysChange: (columns: TableColumnKey[]) => void
  selectedId: string | null; onSelect: (playerId: string | null) => void
  onDraft?: (playerId: string) => void; onToggleQueue?: (playerId: string) => void
  positionFilter?: PositionFilter
  onPositionFilterChange?: (position: PositionFilter) => void
}) {
  const [query, setQuery] = useState(''), [internalPos, setInternalPos] = useState<PositionFilter>('ALL'), [tier, setTier] = useState('ALL'), [team, setTeam] = useState('ALL')
  const pos = positionFilter ?? internalPos
  function setPos(next: PositionFilter) {
    onPositionFilterChange?.(next)
    if (positionFilter == null) setInternalPos(next)
  }
  const [availableOnly, setAvailableOnly] = useState(true), [hideInjured, setHideInjured] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('rank'), [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc'), [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [filterOpen, setFilterOpen] = useState(false), [customizeOpen, setCustomizeOpen] = useState(false)
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [pos])
  const queryClient = useQueryClient()
  useQuery(twitterCatalogQuery)
  const visibleColumns = useMemo(() => new Set(visibleColumnKeys), [visibleColumnKeys])
  const queued = useMemo(() => new Set(queuedIds), [queuedIds]), taken = useMemo(() => new Set(picks.map((pick) => pick.playerId)), [picks])
  const kept = useMemo(() => new Set(picks.filter((pick) => pick.isKeeper).map((pick) => pick.playerId)), [picks])
  const teams = useMemo(() => [...new Set(players.map((player) => player.team).filter((value): value is string => Boolean(value)))].sort(), [players])
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = players.filter((player) => (!availableOnly || !taken.has(player.id)) && (pos === 'ALL' || player.position === pos) && (tier === 'ALL' || tierFor(player) === Number(tier)) && (team === 'ALL' || player.team === team) && (!hideInjured || !player.injuryStatus) && (!needle || player.fullName.toLowerCase().includes(needle) || (player.team ?? '').toLowerCase().includes(needle)))
    const direction = sortDirection === 'asc' ? 1 : -1
    return filtered.sort((a, b) => {
      const value = (player: Player): string | number => sortKey === 'player' ? player.fullName : sortKey === 'position' ? player.position : sortKey === 'team' ? player.team ?? 'ZZZ' : sortKey === 'tier' ? tierFor(player) : sortKey === 'adp' ? player.adp ?? rankValue(player) : sortKey === 'liveAdp' ? player.liveAdp ?? Infinity : sortKey === 'projection' ? player.projectedPoints ?? -Infinity : sortKey === 'vorp' ? player.vorp ?? -Infinity : sortKey === 'value' ? currentPickNo - (player.adp ?? rankValue(player)) : sortKey === 'sos' ? player.playoffSos?.rank ?? Infinity : rankValue(player)
      const left = value(a), right = value(b), result = typeof left === 'string' && typeof right === 'string' ? left.localeCompare(right) : Number(left) - Number(right)
      return result * direction || rankValue(a) - rankValue(b)
    })
  }, [availableOnly, currentPickNo, hideInjured, players, pos, query, sortDirection, sortKey, taken, team, tier])
  const pageRows = rows.slice(0, visibleCount), selected = selectedId ? players.find((player) => player.id === selectedId) ?? null : null
  const hasMore = visibleCount < rows.length
  const loadMore = useCallback(() => setVisibleCount((count) => Math.min(rows.length, count + PAGE_SIZE)), [rows.length])
  const { rootRef, sentinelRef } = useInfiniteScroll(hasMore, loadMore, visibleCount)
  function changeSort(next: SortKey) { if (sortKey === next) setSortDirection((value) => value === 'asc' ? 'desc' : 'asc'); else { setSortKey(next); setSortDirection('asc') } }
  function toggleColumn(key: TableColumnKey) { if (key === 'player') return; const next = visibleColumnKeys.includes(key) ? visibleColumnKeys.filter((column) => column !== key) : [...visibleColumnKeys, key]; onVisibleColumnKeysChange(next) }
  function prefetch(player: Player) {
    void queryClient.prefetchQuery({ queryKey: ['player-intelligence', playerIntelligenceQueryKey(player)], queryFn: ({ signal }) => getPlayerIntelligence(player, signal), staleTime: 300_000 })
  }

  return <main className="cc-center">
    <div className="cc-toolbar">
      <label className="cc-search"><input id="player-search" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE) }} placeholder="Search players..." /><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></label>
      <label className="cc-picker"><Select aria-label="Position filter" value={pos} onChange={(event) => { setPos(event.target.value as PositionFilter); setVisibleCount(PAGE_SIZE) }}>{FILTERS.map((filter) => <option key={filter} value={filter}>{filter === 'ALL' ? 'All Positions' : filter}</option>)}</Select></label>
      <label className="cc-picker"><Select aria-label="Tier filter" value={tier} onChange={(event) => { setTier(event.target.value); setVisibleCount(PAGE_SIZE) }}><option value="ALL">All Tiers</option>{[1,2,3,4,5,6].map((value) => <option key={value} value={value}>Tier {value}</option>)}</Select></label>
      <label className="cc-check"><input type="checkbox" checked={availableOnly} onChange={(event) => { setAvailableOnly(event.target.checked); setVisibleCount(PAGE_SIZE) }} /> Available Only</label>
      <div className="cc-tool-wrap cc-spacer"><button type="button" className={`cc-tool ${filterOpen ? 'cc-tool-on' : ''}`} aria-label="Sort and filter" aria-expanded={filterOpen} onClick={() => { setFilterOpen((open) => !open); setCustomizeOpen(false) }}>☷</button>{filterOpen ? <div className="cc-popover cc-filter-popover"><b>Sort &amp; filter</b><label>Sort by<Select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>{TABLE_COLUMNS.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}</Select></label><label>Direction<Select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as 'asc' | 'desc')}><option value="asc">Ascending</option><option value="desc">Descending</option></Select></label><label>Team<Select value={team} onChange={(event) => { setTeam(event.target.value); setVisibleCount(PAGE_SIZE) }}><option value="ALL">All teams</option>{teams.map((value) => <option key={value}>{value}</option>)}</Select></label><label className="cc-check"><input type="checkbox" checked={hideInjured} onChange={(event) => { setHideInjured(event.target.checked); setVisibleCount(PAGE_SIZE) }} /> Hide injury-designated</label><button type="button" className="cc-reset" onClick={() => { setTeam('ALL'); setHideInjured(false); setSortKey('rank'); setSortDirection('asc'); setVisibleCount(PAGE_SIZE) }}>Reset</button></div> : null}</div>
      <div className="cc-tool-wrap"><button type="button" className={`cc-tool cc-tool-text ${customizeOpen ? 'cc-tool-on' : ''}`} aria-expanded={customizeOpen} onClick={() => { setCustomizeOpen((open) => !open); setFilterOpen(false) }}>Customize</button>{customizeOpen ? <div className="cc-popover cc-customize-popover"><b>Visible columns</b>{TABLE_COLUMNS.map((column) => <label className="cc-check" key={column.key}><input type="checkbox" checked={visibleColumns.has(column.key)} disabled={column.required} onChange={() => toggleColumn(column.key)} /> {column.label}</label>)}</div> : null}</div>
    </div>
    {selected ? <PlayerDetail player={selected} context={selectedContext ?? null} scoringType={scoringType} playoffWeeks={playoffWeeks} isTaken={taken.has(selected.id)} isKeeper={kept.has(selected.id)} isQueued={queued.has(selected.id)} canDraft={canDraft} canMutateDraft={canMutateDraft} providerLabel={providerLabel} onClose={() => onSelect(null)} onDraft={onDraft} onToggleQueue={onToggleQueue} /> : null}
    <div className="cc-table-wrap" ref={rootRef}><table className="cc-player-table"><thead><tr>{TABLE_COLUMNS.filter((column) => visibleColumns.has(column.key)).map((column) => <th key={column.key}><button type="button" className="cc-sort-head" title={column.hint} onClick={() => changeSort(column.key)}>{column.label}{column.hint ? <i className="cc-hint" aria-hidden="true">ⓘ</i> : null}{sortKey === column.key ? <span>{sortDirection === 'asc' ? '▲' : '▼'}</span> : null}</button></th>)}</tr></thead><tbody>
      {pageRows.map((player, index) => {
        const inQueue = queued.has(player.id), isTaken = taken.has(player.id), base = player.adp ?? rankValue(player), value = base >= 9000 ? null : currentPickNo - base
        const playerTier = tierFor(player, index + 1), projection = player.projectedPoints
        const cells: Record<TableColumnKey, React.ReactNode> = {
          rank: <div className="cc-rank"><button type="button" disabled={isTaken} className={`cc-star ${inQueue ? 'cc-on' : ''}`} onClick={(event) => { event.stopPropagation(); onToggleQueue?.(player.id) }} aria-label={inQueue ? 'Remove from queue' : 'Add to queue'}>★</button>{shownRank(player)}</div>,
          player: <div className="cc-player"><PlayerPhoto player={player} className="cc-avatar-md" /><span><span className="cc-player-name">{player.fullName}<InjuryDot status={player.injuryStatus} /></span><span className="cc-player-team">{kept.has(player.id) ? 'Kept' : isTaken ? 'Drafted' : <TeamLabel team={player.team} fallback="Free Agent" />}</span></span></div>,
          position: <span className={`cc-pos cc-${player.position.toLowerCase()}`}>{player.position}</span>, team: <span className="cc-num"><TeamLabel team={player.team} fallback="FA" /></span>, tier: <span className={`cc-tier-pill ${tierColorClass(playerTier)}`}>Tier {playerTier}</span>, adp: <span className="cc-num">{player.adp != null ? player.adp.toFixed(1) : '—'}</span>, liveAdp: <span className="cc-num">{player.liveAdp != null ? player.liveAdp.toFixed(1) : '—'}</span>, projection: <span className="cc-num">{projection == null ? '—' : projection.toFixed(1)}</span>, vorp: <span className={`cc-num ${player.vorp == null ? '' : player.vorp >= 0 ? 'cc-up' : 'cc-down'}`}>{player.vorp == null ? '—' : `${player.vorp >= 0 ? '+' : ''}${player.vorp.toFixed(1)}`}</span>, value: <span className={`cc-num ${(value ?? 0) >= 0 ? 'cc-up' : 'cc-down'}`}>{value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}`}</span>, sos: <span className={`cc-num cc-sos-${matchupTone(player.playoffSos?.rank)}`}>{player.playoffSos?.rank != null ? ordinal(player.playoffSos.rank) : '—'}</span>,
        }
        return <tr key={player.id} className={`${selectedId === player.id ? 'cc-selected' : ''} ${isTaken ? 'cc-taken' : ''}`} onMouseEnter={() => prefetch(player)} onFocus={() => prefetch(player)} onPointerDown={() => prefetch(player)} onClick={() => onSelect(player.id)} onDoubleClick={() => !isTaken && canDraft && onDraft?.(player.id)}>{TABLE_COLUMNS.filter((column) => visibleColumns.has(column.key)).map((column) => <td key={column.key}>{cells[column.key]}</td>)}</tr>
      })}
    </tbody></table>{hasMore ? <div ref={sentinelRef} className="cc-infinite-sentinel" aria-hidden="true" /> : null}{!pageRows.length ? <div className="cc-table-empty">No players match these filters.</div> : hasMore ? <div className="cc-list-end">Loading more players…</div> : <div className="cc-list-end">All matching players loaded</div>}</div>
    <div className="cc-pager"><span>Showing {Math.min(visibleCount, rows.length)} of {rows.length} players{hasMore ? ' · Scroll to load more' : ''}</span></div>
  </main>
}

