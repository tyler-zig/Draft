import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getPlayerIntelligence, playerIntelligenceQueryKey } from '../api/playerIntelligence'
import { playerScheduleFromHistorical, type HistoricalSeason } from '../api/playerHistorical'
import { getNflProjections, lookupPlayerProjection, projectedPointsFor, projectionSeason, scoreBreakdown, type PlayerProjection } from '../api/playerProjections'
import { ProjectionHover } from './ProjectionHover'
import { byeWeekFromSchedule } from '../intelligence/calculations/matchup'
import type { Player, PlayoffWeeks, ScoringType } from '../providers/types'
import { PlayerScheduleGrid } from './PlayerSchedule'
import { injuryTone } from '../draft/injuryStatus'
import type { PlayerDraftContext } from '../draft/playerContext'
import { loadCurrentDraft, playerIntelligenceHref, scoringLabel } from '../draft/currentDraft'
import { MarketHistory } from './MarketHistory'
import { PlayerPhoto } from './PlayerPhoto'
import { PlayerTwitterLink } from './PlayerTwitterLink'
const UNRANKED = 9999
const rankValue = (player: Player) => (player.searchRank > 0 ? player.searchRank : UNRANKED)

function shownRank(player: Player) {
  const value = rankValue(player)
  if (value >= 9000) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function shownNumber(value: number | null | undefined) {
  return value == null ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function percent(value: number | null) {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}

function historicalPoints(season: HistoricalSeason, scoringType: ScoringType) {
  if (scoringType === 'std') return season.stats.fantasyPoints
  if (scoringType === 'half_ppr') return season.stats.fantasyPoints + (season.stats.fantasyPointsPpr - season.stats.fantasyPoints) / 2
  return season.stats.fantasyPointsPpr
}

/** Sleeper reports height as bare inches, which reads as a jersey number. */
function shownHeight(raw: string | null | undefined) {
  if (!raw) return '—'
  const inches = Number(raw)
  if (!Number.isFinite(inches) || inches <= 0) return raw
  return `${Math.floor(inches / 12)}'${inches % 12}"`
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <div><small>{label}</small><b className={accent ? 'pd-teal' : undefined}>{value}</b></div>
}

function combinedStat(...values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => value != null)
  return present.length ? present.reduce((total, value) => total + value, 0) : null
}

/**
 * Which counting stats matter depends on the position -- a QB's carries and a
 * receiver's attempts are both noise, and showing every column to everyone is
 * how the old modal ended up saying nothing loudly.
 */
function productionColumns(position: string): Array<{
  key: string
  label: string
  get: (season: HistoricalSeason) => number
  project: (row: PlayerProjection) => number | null
}> {
  const shared = [{ key: 'g', label: 'G', get: (season: HistoricalSeason) => season.gamesPlayed, project: (row: PlayerProjection) => row.games }]
  if (position === 'QB') {
    return [
      ...shared,
      { key: 'pyd', label: 'Pass yd', get: (s) => s.stats.passingYards, project: (row) => row.stats.pass_yd ?? null },
      { key: 'ptd', label: 'Pass TD', get: (s) => s.stats.passingTds, project: (row) => row.stats.pass_td ?? null },
      { key: 'int', label: 'INT', get: (s) => s.stats.interceptions, project: (row) => row.stats.pass_int ?? null },
      { key: 'ryd', label: 'Rush yd', get: (s) => s.stats.rushingYards, project: (row) => row.stats.rush_yd ?? null },
    ]
  }
  if (position === 'RB') {
    return [
      ...shared,
      { key: 'car', label: 'Car', get: (s) => s.stats.carries, project: (row) => row.stats.rush_att ?? null },
      { key: 'ryd', label: 'Rush yd', get: (s) => s.stats.rushingYards, project: (row) => row.stats.rush_yd ?? null },
      { key: 'rec', label: 'Rec', get: (s) => s.stats.receptions, project: (row) => row.stats.rec ?? null },
      { key: 'td', label: 'TD', get: (s) => s.stats.rushingTds + s.stats.receivingTds, project: (row) => combinedStat(row.stats.rush_td, row.stats.rec_td) },
    ]
  }
  return [
    ...shared,
    { key: 'tgt', label: 'Tgt', get: (s) => s.stats.targets, project: (row) => row.stats.rec_tgt ?? null },
    { key: 'rec', label: 'Rec', get: (s) => s.stats.receptions, project: (row) => row.stats.rec ?? null },
    { key: 'yd', label: 'Rec yd', get: (s) => s.stats.receivingYards, project: (row) => row.stats.rec_yd ?? null },
    { key: 'td', label: 'TD', get: (s) => s.stats.receivingTds, project: (row) => row.stats.rec_td ?? null },
  ]
}

interface Chip {
  key: string
  label: string
  value: string
  tone: 'good' | 'bad' | 'warn' | 'flat'
}

/**
 * The verdict strip: everything the draft knows about this player, stated
 * plainly. No composite score -- each chip is a fact you can check.
 */
function verdictChips(player: Player, context: PlayerDraftContext): Chip[] {
  const chips: Chip[] = []

  // Once he is gone, "should last until your pick" is advice about a decision
  // nobody can make any more. Report what happened instead.
  if (context.takenBy) {
    return [
      {
        key: 'gone',
        label: `${player.position}s gone`,
        value: String(context.positionDrafted),
        tone: 'flat',
      },
    ]
  }

  chips.push({
    key: 'pos',
    label: 'On the board',
    value: `${player.position}${context.positionRank}`,
    tone: context.positionRank <= 3 ? 'good' : 'flat',
  })

  if (context.valueVsPick != null) {
    const delta = context.valueVsPick
    const source = context.baselineSource ?? 'market'
    chips.push({
      key: 'value',
      label: `vs ${source}`,
      value: Math.abs(delta) < 4 ? 'On the money' : delta > 0 ? `Falling ${delta}` : `Reach ${Math.abs(delta)}`,
      tone: Math.abs(delta) < 4 ? 'flat' : delta > 0 ? 'good' : 'bad',
    })
  }

  if (player.tier != null && context.tierRemaining != null) {
    chips.push({
      key: 'tier',
      label: `Tier ${player.tier}`,
      value: context.tierRemaining <= 1 ? 'Last one' : `${context.tierRemaining} left`,
      tone: context.tierRemaining <= 1 ? 'warn' : context.tierRemaining <= 3 ? 'warn' : 'flat',
    })
  }

  chips.push({
    key: 'need',
    label: 'Your roster',
    value: context.need.label,
    tone: context.need.kind === 'starter' ? 'good' : context.need.kind === 'bench' ? 'flat' : 'warn',
  })

  return chips
}

function draftCall(player: Player, context: PlayerDraftContext | null, status: string | null): Chip & { note?: string } | null {
  if (context?.takenBy) {
    const { takenBy } = context
    const when = takenBy.isKeeper && takenBy.pickNo < 1
      ? 'Does not cost a pick'
      : `${takenBy.pickNo} · round ${takenBy.round}`
    return {
      key: 'taken',
      label: takenBy.isKeeper ? 'Kept by' : 'Drafted by',
      value: takenBy.teamName,
      tone: 'flat',
      note: when,
    }
  }
  if (context?.lastsUntilYourPick != null && context.yourNextPickNo != null) {
    const source = context.baselineSource === 'live ADP' && player.liveAdp != null
      ? `Live ADP ${player.liveAdp.toFixed(1)}`
      : context.baselineSource === 'ADP' && player.adp != null
        ? `ADP ${player.adp.toFixed(1)}`
        : null
    const odds = context.survivalProbability != null ? `${percent(context.survivalProbability)} likely to last` : null
    const note = [source, odds].filter(Boolean).join(' · ') || undefined
    return {
      key: 'lasts',
      label: `Your pick ${context.yourNextPickNo}`,
      value: context.lastsUntilYourPick ? 'Should last' : 'Gone by then',
      tone: context.lastsUntilYourPick ? 'good' : 'bad',
      note,
    }
  }
  if (status) return { key: 'status', label: 'Status', value: status, tone: 'flat' }
  return null
}

export function PlayerDetail({ player, context, scoringType = 'ppr', playoffWeeks, isTaken, isKeeper, isQueued, canDraft, canMutateDraft, providerLabel, onClose, onDraft, onToggleQueue }: {
  player: Player
  context: PlayerDraftContext | null
  scoringType?: ScoringType
  playoffWeeks?: PlayoffWeeks | null
  isTaken: boolean
  isKeeper: boolean
  isQueued: boolean
  canDraft: boolean
  canMutateDraft: boolean
  providerLabel: string
  onClose: () => void
  onDraft?: (id: string) => void
  onToggleQueue?: (id: string) => void
}) {
  const currentDraft = loadCurrentDraft()
  const profileId = player.espnId ?? player.sleeperId ?? player.id
  const fullProfileHref = currentDraft
    ? playerIntelligenceHref(currentDraft, profileId)
    : `/players?playerId=${encodeURIComponent(profileId)}`
  const intelligence = useQuery({ queryKey: ['player-intelligence', playerIntelligenceQueryKey(player)], queryFn: ({ signal }) => getPlayerIntelligence(player, signal), staleTime: 300_000, retry: false })
  const seasonYear = projectionSeason(currentDraft?.season)
  const projectionsQuery = useQuery({ queryKey: ['nfl-projections', seasonYear], queryFn: ({ signal }) => getNflProjections(seasonYear, signal), staleTime: 3_600_000, retry: false })
  const data = intelligence.data
  const seasons = [...(data?.historical?.seasons ?? [])].sort((a, b) => b.season - a.season).slice(0, 4)
  const gamesMissed = (data?.historical?.seasons ?? []).reduce((total, season) => total + season.durability.gamesMissed, 0)
  const columns = productionColumns(player.position)
  const projectionRow = lookupPlayerProjection(player, projectionsQuery.data)
  const receptionOverride = scoringType === currentDraft?.scoringType
    ? currentDraft.receptionPremium?.find((premium) => premium.position === player.position)?.points ?? null
    : null
  const projectedPoints = projectionRow
    ? projectedPointsFor(projectionRow, scoringType, currentDraft?.scoringSettings ?? null, currentDraft?.scoringSettings ? null : receptionOverride)
    : null
  const projectedPpg = projectedPoints != null && projectionRow?.games != null && projectionRow.games > 0 ? projectedPoints / projectionRow.games : null
  const projectionBreakdown = projectionRow
    ? scoreBreakdown(projectionRow, scoringType, currentDraft?.scoringSettings ?? null, currentDraft?.scoringSettings ? null : receptionOverride)
    : []
  const chips = context ? verdictChips(player, context) : []
  const status = isKeeper ? 'Kept' : isTaken ? 'Drafted' : null
  const call = draftCall(player, context, status)
  const depth = player.depthChartOrder == null ? null : `${player.depthChartPosition ?? player.position}${player.depthChartOrder}`
  const posClass = player.position.toLowerCase().replace('/', '')
  const schedule = data?.historical ? playerScheduleFromHistorical(data.historical, player, scoringType) : null
  const byeWeek = byeWeekFromSchedule(schedule?.weeks) ?? player.bye

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  return <div className="pd-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="pd" role="dialog" aria-modal="true" aria-label={`${player.fullName} details`}>
      <button type="button" className="pd-close" onClick={onClose} aria-label="Close player details">×</button>
      <header className={`pd-hero pd-hero-${posClass}`}>
        <div className="pd-top">
          <div className="pd-who">
            <PlayerPhoto player={player} className="pd-photo" priority />
            <div className="pd-id">
              <h2>{player.fullName}</h2>
              <p className="pd-meta">
                <span className={`pd-pos cc-pos cc-${posClass}`}>{player.position}</span>
                <span>{player.team ?? 'Free Agent'}</span>
                <span>Bye {byeWeek ?? '—'}</span>
                {player.age != null ? <span>{player.age} yr old</span> : null}
                {player.yearsExp != null ? <span>{player.yearsExp === 0 ? 'Rookie' : `${player.yearsExp} yr exp`}</span> : null}
                {player.injuryStatus ? <span className={`pd-injury ${injuryTone(player.injuryStatus) === 'out' ? 'pd-out' : 'pd-warn'}`}>{player.injuryStatus}</span> : null}
                <PlayerTwitterLink player={player} />
              </p>
            </div>
          </div>
          {call ? <div className={`pd-call pd-${call.tone}`}>
            <small>{call.label}</small>
            <b>{call.value}</b>
            {call.note ? <p>{call.note}</p> : null}
          </div> : null}
        </div>
        <section className="pd-stats" aria-label="Profile and market">
          <Stat label="Height" value={shownHeight(player.height)} />
          <Stat label="Weight" value={player.weight == null ? '—' : `${player.weight} lb`} />
          <Stat label="Depth" value={depth ?? '—'} />
          <Stat label="Consensus" value={player.consensusCount ? shownRank(player) : '—'} accent />
          <Stat label="ADP" value={player.adp?.toFixed(1) ?? '—'} />
          <Stat label="Live ADP" value={player.liveAdp?.toFixed(1) ?? '—'} accent />
          <Stat label="Range" value={player.rankLow == null ? '—' : `${shownNumber(player.rankLow)}–${shownNumber(player.rankHigh)}`} />
        </section>
        <p className="pd-note">Profile source: Sleeper</p>
        {chips.length ? <section className="pd-verdict" aria-label="Draft context">
          {chips.map((chip) => <div className={`pd-chip pd-${chip.tone}`} key={chip.key}>
            <small>{chip.label}</small>
            <b>{chip.value}</b>
          </div>)}
        </section> : null}
      </header>

      <div className="pd-body">
        <div className="pd-col pd-col-main">
          <section className="pd-block">
            <h3>Production</h3>
            {seasons.length || projectionsQuery.isPending || projectionsQuery.isFetched ? <>
              <div className="pd-table-wrap pd-settle">
                <table className="pd-table">
                  <thead><tr>
                    <th>Season</th>
                    {columns.map((column) => <th key={column.key}>{column.label}</th>)}
                    <th>Snap</th><th>{scoringLabel(scoringType)}</th><th>PPG</th>
                  </tr></thead>
                  <tbody>
                    <tr className="pd-proj">
                      <td className="pd-season">{projectionRow?.season ?? seasonYear} <small className="pd-proj-tag">proj</small></td>
                      {projectionsQuery.isPending ? <td colSpan={columns.length + 3}>Loading season projection…</td> : <>
                        {columns.map((column) => <td key={column.key}>{projectionRow
                          ? <ProjectionHover
                              value={column.project(projectionRow)}
                              breakdown={projectionBreakdown}
                              label={column.label}
                              pick={(line) => column.project({ ...projectionRow, stats: { ...projectionRow.stats, ...line.stats }, games: line.games ?? projectionRow.games })}
                            />
                          : '—'}</td>)}
                        <td>—</td>
                        <td className="pd-strong"><ProjectionHover value={projectedPoints} breakdown={projectionBreakdown} label={scoringLabel(scoringType)} /></td>
                        <td className="pd-strong"><ProjectionHover
                          value={projectedPpg}
                          breakdown={projectionBreakdown}
                          label="PPG"
                          pick={(line) => line.points != null && line.games ? line.points / line.games : null}
                        /></td>
                      </>}
                    </tr>
                    {seasons.map((season) => {
                    const points = historicalPoints(season, scoringType)
                    return <tr key={season.season}>
                      <td className="pd-season">{season.season}</td>
                      {columns.map((column) => <td key={column.key}>{column.get(season)}</td>)}
                      <td>{percent(season.usage.snapShare)}</td>
                      <td className="pd-strong">{points.toFixed(1)}</td>
                      <td className="pd-strong">{season.gamesPlayed ? (points / season.gamesPlayed).toFixed(1) : '—'}</td>
                    </tr>
                  })}
                  </tbody>
                </table>
              </div>
              <p className="pd-note">
                {projectionRow
                  ? `${projectionRow.season} line is a ${projectionRow.source} season projection, not observed production.`
                  : projectionsQuery.isError ? 'Season projection is temporarily unavailable.'
                    : projectionsQuery.isFetched ? `No Sleeper projection published for ${seasonYear}.`
                      : 'Loading season projection…'}
                {seasons.length ? ` ${gamesMissed ? `${gamesMissed} game${gamesMissed === 1 ? '' : 's'} missed across ${data?.historical?.seasons.length} seasons` : 'No games missed on record'}${seasons[0]?.usage.touchShare != null ? ` · ${percent(seasons[0].usage.touchShare)} of team touches in ${seasons[0].season}` : ''}${data?.historical?.source ? ` · ${data.historical.source}` : ''}` : intelligence.isLoading ? ' Loading nflverse history…' : data?.historical?.message ? ` ${data.historical.message}` : ''}
              </p>
            </> : intelligence.isLoading ? <div className="pd-pending pd-pending-table" role="status"><span>Loading nflverse history…</span></div> : <p className="pd-empty">{data?.historical?.message ?? 'No historical production on record.'}</p>}
          </section>

          <section className="pd-block">
            <h3>News</h3>
            {data?.news.length ? <ul className="pd-news pd-settle">{data.news.slice(0, 3).map((item) => <li key={item.id}>
              {item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.headline}</a> : <span>{item.headline}</span>}
              <small>{item.source}{item.published ? ` · ${new Date(item.published).toLocaleDateString()}` : ''}</small>
            </li>)}</ul> : intelligence.isLoading ? <div className="pd-pending pd-pending-news" role="status"><span>Loading news…</span></div> : <p className="pd-empty">{data?.newsMessage ?? 'No recent headlines.'}</p>}
          </section>
        </div>

        <aside className="pd-col pd-col-side">
          <section className="pd-block">
            <h3>Schedule</h3>
            {intelligence.isLoading && !schedule ? <div className="pd-pending pd-pending-schedule" role="status"><span>Loading schedule…</span></div>
              : !schedule || (schedule.message && !schedule.weeks.length) ? <p className="pd-empty">{schedule?.message ?? 'Schedule has not been synced.'}</p>
              : <div className="pd-settle"><PlayerScheduleGrid schedule={schedule} playoffWeeks={playoffWeeks} /></div>}
          </section>

          <section className="pd-block">
            <h3>ADP over time</h3>
            <div className="pd-trend"><MarketHistory compact history={data?.marketHistory} loading={intelligence.isLoading} live={player.liveAdp != null ? { at: Date.now(), value: player.liveAdp } : null} /></div>
            {player.rankingSources?.length ? <div className="pd-sources">
              {player.rankingSources.map((source) => <small key={source.id} title={`Updated ${new Date(source.fetchedAt).toLocaleString()}`}>
                {source.label} <b>{shownNumber(source.rank)}</b>
              </small>)}
            </div> : <p className="pd-empty">No enabled ranking source reports this player.</p>}
          </section>
        </aside>
      </div>

      <footer className="pd-actions">
        <Link className="pd-ghost" to={fullProfileHref}>Full profile</Link>
        <button
          type="button"
          className={isQueued && !isTaken ? 'pd-queued' : undefined}
          disabled={isTaken}
          title={isTaken ? `${player.fullName} is already off the board.` : undefined}
          onClick={() => onToggleQueue?.(player.id)}
        >{isTaken ? 'Off the board' : isQueued ? 'In queue · remove' : 'Add to queue'}</button>
        {canMutateDraft
          ? <button
              type="button"
              className="pd-primary"
              disabled={!canDraft || isTaken}
              title={!canDraft ? 'Wait until you are on the clock in the demo draft.' : undefined}
              onClick={() => onDraft?.(player.id)}
            >{isTaken ? 'Already drafted' : canDraft ? 'Draft player' : 'Not your pick yet'}</button>
          : <span className="pd-readonly">{providerLabel} is read-only · draft on the league site</span>}
      </footer>
    </section>
  </div>
}
