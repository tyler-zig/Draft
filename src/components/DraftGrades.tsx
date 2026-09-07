import { useMemo, useState } from 'react'
import { requestAiDraftGrade } from '../api/draftGrade'
import { getRankingHistoryCatalog, lookupMarketHistory } from '../api/playerIntelligence'
import { buildAiDraftBriefing, type AiDraftGrade, type AiTeamWriteup } from '../draft/aiGrade'
import { byeWeekDistribution, formatByePositions } from '../draft/byeWeeks'
import { leagueProjections, MIN_GRADED_TEAMS, MIN_PICKS_PER_TEAM, type Grade, type TeamGrade } from '../draft/grades'
import { marketBaseline } from '../draft/playerContext'
import type { DraftPick, DraftSession, Player } from '../providers/types'
import { PlayerPhoto } from './PlayerPhoto'
import { TeamLogo } from './TeamLogo'

type SortKey = 'slot' | 'points' | 'value' | 'grade'
type ReportTab = 'overview' | 'roster' | 'rankings'
const CORE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const

function valueOf(grade: TeamGrade, key: SortKey): number {
  if (key === 'slot') return grade.slot
  if (key === 'value') return grade.valueTally
  if (key === 'grade') return grade.z ?? Number.NEGATIVE_INFINITY
  return grade.lineup.points
}

function formatTally(value: number): string {
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1)
  return value > 0 ? `+${rounded}` : rounded
}

function formatPoints(value: number | null | undefined): string {
  return value == null ? '—' : value.toFixed(1)
}

function ordinal(place: number): string {
  const mod100 = place % 100
  if (mod100 >= 11 && mod100 <= 13) return `${place}th`
  if (place % 10 === 1) return `${place}st`
  if (place % 10 === 2) return `${place}nd`
  if (place % 10 === 3) return `${place}rd`
  return `${place}th`
}

function scoringLabel(session: DraftSession): string {
  if (session.scoringType === 'half_ppr') return 'Half PPR'
  if (session.scoringType === 'std') return 'Standard'
  if (session.scoringType === 'ppr') return 'PPR'
  return 'Custom scoring'
}

function gradeScore(grade: TeamGrade, grades: TeamGrade[]): number {
  const values = grade.z == null ? grades.map((row) => row.lineup.points) : grades.map((row) => row.z).filter((value): value is number => value != null)
  const value = grade.z ?? grade.lineup.points
  if (values.length <= 1) return 50
  const below = values.filter((candidate) => candidate < value).length
  const tied = values.filter((candidate) => candidate === value).length
  return Math.round(((below + Math.max(0, tied - 1) / 2) / (values.length - 1)) * 100)
}

function rankFor(value: number, values: number[]): number {
  return [...values].sort((left, right) => right - left).findIndex((candidate) => candidate === value) + 1
}

function percentile(value: number, values: number[]): number {
  if (values.length <= 1) return 50
  const below = values.filter((candidate) => candidate < value).length
  const tied = values.filter((candidate) => candidate === value).length
  return Math.round(((below + Math.max(0, tied - 1) / 2) / (values.length - 1)) * 100)
}

function playerName(player: Player | undefined, pick: DraftPick): string {
  if (player?.fullName) return player.fullName
  return [pick.meta?.firstName, pick.meta?.lastName].filter(Boolean).join(' ') || pick.playerId
}

function positionClass(position: string | undefined): string {
  return `cc-grades-pos-${(position || 'na').toLowerCase().replace('/', '')}`
}

function GradeMark({ grade, large = false }: { grade: Grade | null; large?: boolean }) {
  return <span className={`cc-grade ${large ? 'cc-grade-large ' : ''}${grade ? `cc-grade-${grade.toLowerCase()}` : 'cc-grade-pending'}`}>{grade ?? '—'}</span>
}

function ValueText({ value, unvalued = 0 }: { value: number; unvalued?: number }) {
  const tone = value > 0 ? 'cc-up' : value < 0 ? 'cc-down' : ''
  return <span className={`cc-grades-value ${tone}`}>{formatTally(value)}{unvalued > 0 ? <small>{unvalued} unvalued</small> : null}</span>
}

function NoteList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null
  return <div><dt>{label}</dt><dd>{items.map((item) => <span key={item}>{item}</span>)}</dd></div>
}

function TeamWriteup({ writeup }: { writeup: AiTeamWriteup }) {
  return <section className="cc-grades-ai-team" aria-label="AI team summary"><p className="cc-grades-kicker">Scout analysis</p>{writeup.headline ? <h4>{writeup.headline}</h4> : null}{writeup.summary ? <p>{writeup.summary}</p> : null}<dl><NoteList label="Steals" items={writeup.steals} /><NoteList label="Reaches" items={writeup.reaches} /><NoteList label="Risks" items={writeup.risks} /></dl>{writeup.outlook ? <p className="cc-grades-ai-outlook">{writeup.outlook}</p> : null}{writeup.next ? <p className="cc-grades-ai-next"><b>Next</b> {writeup.next}</p> : null}</section>
}

function Metric({ label, value, width, detail, tone }: { label: string; value: string | number; width: number; detail: string; tone?: 'blue' | 'purple' | 'amber' }) {
  return <div className="cc-grades-breakdown"><div><span>{label}</span><b>{value}</b></div><i><u className={tone ? `cc-${tone}` : undefined} style={{ width: `${Math.max(3, Math.min(100, width))}%` }} /></i><small>{detail}</small></div>
}

/** A post-draft report with transparent room-relative grades and actionable roster context. */
export function DraftGrades({ session, picks, players, highlightedSlot = null, note }: {
  session: DraftSession
  picks: DraftPick[]
  players: Player[]
  highlightedSlot?: number | null
  note?: string
}) {
  const [tab, setTab] = useState<ReportTab>('overview')
  const [sortOverride, setSortOverride] = useState<SortKey | null>(null)
  const [ascending, setAscending] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<number | null>(highlightedSlot)
  const [aiGrade, setAiGrade] = useState<AiDraftGrade | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)

  const playersById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players])
  const avatarBySlot = useMemo(() => new Map(session.order.map((slot) => [slot.slot, slot.avatar ?? null])), [session.order])
  const grades = useMemo(() => {
    const teamNameBySlot = new Map(session.order.map((slot) => [slot.slot, slot.teamName || slot.displayName]))
    return leagueProjections({ picks, playersById, teams: session.teams, slots: session.slots, teamNameBySlot })
  }, [session, picks, playersById])
  const lettersReady = grades.some((grade) => grade.grade != null)
  const sortKey = sortOverride ?? (lettersReady ? 'grade' : 'points')
  const rows = useMemo(() => [...grades].sort((a, b) => (valueOf(a, sortKey) - valueOf(b, sortKey)) * (ascending ? 1 : -1)), [grades, sortKey, ascending])
  const standings = useMemo(
    () => [...grades].sort((a, b) => lettersReady
      ? (b.z ?? Number.NEGATIVE_INFINITY) - (a.z ?? Number.NEGATIVE_INFINITY)
      : b.lineup.points - a.lineup.points),
    [grades, lettersReady],
  )
  const selected = grades.find((grade) => grade.slot === selectedSlot) ?? grades.find((grade) => grade.slot === highlightedSlot) ?? standings[0] ?? null
  const readyCount = grades.filter((grade) => grade.picks.length >= MIN_PICKS_PER_TEAM).length
  const selectedPlace = selected ? standings.findIndex((grade) => grade.slot === selected.slot) + 1 : 0
  const mineSelected = selected != null && selected.slot === highlightedSlot
  const selectedRoster = selected?.picks.map((pick) => playersById.get(pick.playerId)).filter((player): player is Player => Boolean(player)) ?? []
  const selectedPicks = selected ? [...selected.picks].sort((a, b) => a.pickNo - b.pickNo) : []
  const selectedWriteup = aiGrade?.teams.find((team) => team.slot === selected?.slot) ?? null
  const lineupValues = grades.map((grade) => grade.lineup.points)
  const valueValues = grades.map((grade) => grade.valueTally)
  const lineupRank = selected ? rankFor(selected.lineup.points, lineupValues) : 0
  const valueRank = selected ? rankFor(selected.valueTally, valueValues) : 0
  const lineupScore = selected ? percentile(selected.lineup.points, lineupValues) : 0
  const valueScore = selected ? percentile(selected.valueTally, valueValues) : 0
  const totalStarterSeats = selected?.lineup.seats.length ?? 0
  const coverageScore = selected && totalStarterSeats ? Math.round((selected.lineup.starters / totalStarterSeats) * 100) : 0
  const benchCount = Math.max(0, selectedRoster.length - (selected?.lineup.starters ?? 0))
  const depthScore = session.slots.BN ? Math.min(100, Math.round((benchCount / session.slots.BN) * 100)) : 100
  const valuedPicks = selectedPicks.flatMap((pick) => {
    if (pick.pickNo <= 0) return []
    const player = playersById.get(pick.playerId)
    const baseline = player ? marketBaseline(player) : null
    return baseline ? [{ pick, player, baseline: baseline.value, delta: pick.pickNo - baseline.value }] : []
  })
  const bestPick = [...valuedPicks].sort((a, b) => b.delta - a.delta)[0]
  const worstPick = valuedPicks.length > 1 ? [...valuedPicks].sort((a, b) => a.delta - b.delta)[0] : undefined
  const byeRows = byeWeekDistribution(selectedRoster)
  const busiestBye = [...byeRows].sort((a, b) => b.count - a.count)[0]
  const counts = new Map<string, number>()
  for (const player of selectedRoster) counts.set(player.position, (counts.get(player.position) ?? 0) + 1)
  const weakest = CORE_POSITIONS.map((position) => ({ position, count: counts.get(position) ?? 0, required: session.slots[position] })).sort((a, b) => (a.count - a.required) - (b.count - b.required))[0]
  const emptySeats = selected?.lineup.seats.filter((seat) => !seat.player).map((seat) => seat.label) ?? []

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setAscending((current) => !current)
    else { setSortOverride(key); setAscending(key === 'slot') }
  }
  const writeAiSummary = async () => {
    if (aiBusy) return
    setAiBusy(true); setAiError(null)
    try {
      // Collected ranking history is one small artifact, memoized after the
      // first read, so the recap gets real market movement per player without
      // the room paying for it until a summary is asked for.
      const catalog = await Promise.race([
        getRankingHistoryCatalog().catch(() => undefined),
        new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), 250)),
      ])
      const briefing = buildAiDraftBriefing({
        session,
        picks,
        players,
        yourSlot: highlightedSlot,
        marketHistory: catalog ? (player) => lookupMarketHistory(catalog, player).points : undefined,
      })
      setAiGrade(await requestAiDraftGrade(briefing))
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'DeepSeek could not grade this draft.')
    } finally { setAiBusy(false) }
  }

  if (grades.length === 0) return <div className="cc-grades cc-grades-empty">{note ? <p className="cc-grades-meta">{note}</p> : null}<p className="cc-table-empty">No picks made yet.</p></div>

  return <div className="cc-grades">
    <header className="cc-grades-report-head"><div><p className="cc-grades-kicker">Post-draft intelligence</p><div><h2>Draft report</h2><span>{picks.length} picks · {session.teams} teams</span><b>{scoringLabel(session)}</b>{note ? <em>{note}</em> : null}</div></div><nav aria-label="Draft report sections">{([['overview', 'Overview'], ['roster', 'Roster analysis'], ['rankings', 'Room rankings']] as const).map(([key, label]) => <button type="button" key={key} className={tab === key ? 'on' : undefined} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</nav></header>
    {aiError ? <p className="cc-grades-ai-error" role="alert">{aiError}</p> : null}

    {tab === 'overview' && selected ? <div className="cc-grades-overview">
      {aiGrade ? <section className="cc-grades-ai" aria-label="AI draft summary"><div><p className="cc-grades-kicker">Room summary</p>{aiGrade.headline ? <h4>{aiGrade.headline}</h4> : null}{aiGrade.summary ? <p>{aiGrade.summary}</p> : null}</div>{aiGrade.themes.length ? <ul>{aiGrade.themes.map((theme) => <li key={theme}>{theme}</li>)}</ul> : null}{aiGrade.superlatives.length ? <dl className="cc-grades-ai-supers">{aiGrade.superlatives.map((item) => <div key={`${item.label}-${item.team}`}><dt>{item.label}</dt><dd><b>{item.team}</b>{item.note ? ` — ${item.note}` : null}</dd></div>)}</dl> : null}</section> : null}
      <div className="cc-grades-overview-grid">
        <section className="cc-grades-hero"><div className="cc-grades-hero-mark"><GradeMark grade={selected.grade} large /><b>{ordinal(selectedPlace)} of {grades.length}</b><span>{lettersReady ? `${gradeScore(selected, grades)}th percentile` : `${selected.picks.length} picks graded`}</span></div><div className="cc-grades-hero-copy"><p className="cc-grades-kicker">{mineSelected ? 'Your draft' : `Draft slot ${selected.slot}`}</p><h3><TeamLogo src={avatarBySlot.get(selected.slot)} label={selected.teamName} />{selected.teamName}{mineSelected ? <b className="cc-mine">YOU</b> : null}</h3><p>{lettersReady ? lineupRank <= valueRank ? `A ${ordinal(lineupRank)}-place projected lineup drives this grade. The room-relative value tally is ${formatTally(selected.valueTally)}.` : `Draft-day value is the strength of this build, ranking ${ordinal(valueRank)} in the room with a ${formatTally(selected.valueTally)} tally.` : `Grades unlock after ${MIN_PICKS_PER_TEAM} picks from ${MIN_GRADED_TEAMS} teams. ${readyCount} teams are ready now.`}</p><div className="cc-grades-breakdowns"><Metric label="Starters" value={lineupScore} width={lineupScore} detail={`${ordinal(lineupRank)} in projected points`} /><Metric label="Value" value={valueScore} width={valueScore} detail={`${formatTally(selected.valueTally)} picks vs market`} tone="blue" /><Metric label="Coverage" value={coverageScore} width={coverageScore} detail={`${selected.lineup.starters}/${totalStarterSeats} starter slots`} tone="purple" /><Metric label="Depth" value={depthScore} width={depthScore} detail={`${benchCount}/${session.slots.BN} bench spots`} tone="amber" /></div><small className="cc-grades-formula">Letter grade: 70% projected starting lineup · 30% ADP value · relative to this room</small></div></section>
        <aside className="cc-grades-room-card"><div className="cc-grades-card-head"><h3>Room standings</h3><span>Click a team to inspect</span></div><div className="cc-grades-sortbar"><span>#</span>{([['slot', 'Team'], ['grade', 'Grade'], ['points', 'Lineup pts'], ['value', 'Value']] as const).map(([key, label]) => <button type="button" key={key} className={sortKey === key ? 'on' : undefined} aria-label={`Sort by ${label}`} onClick={() => toggleSort(key)}>{label}{sortKey === key ? <i>{ascending ? '▲' : '▼'}</i> : null}</button>)}</div><ol className="cc-grades-list">{rows.map((grade, index) => { const mine = grade.slot === highlightedSlot; const active = grade.slot === selected.slot; return <li key={grade.slot}><button type="button" className={`cc-grades-row${mine ? ' cc-grades-you' : ''}${active ? ' cc-grades-on' : ''}`} aria-pressed={active} aria-label={`${grade.teamName} details`} onClick={() => setSelectedSlot(grade.slot)}><span className="cc-grades-place">{index + 1}</span><span className="cc-grades-team"><TeamLogo src={avatarBySlot.get(grade.slot)} label={grade.teamName} /><span>{grade.teamName}</span>{mine ? <b className="cc-mine">YOU</b> : null}</span><GradeMark grade={grade.grade} /><span className="cc-grades-points"><b>{formatPoints(grade.lineup.points)}</b><small>pts</small></span><ValueText value={grade.valueTally} unvalued={grade.unvaluedPicks} /></button></li> })}</ol></aside>
        <div className="cc-grades-story"><div className="cc-grades-insights"><article><p className="cc-grades-kicker cc-good">What worked</p><h3>{lineupRank <= valueRank ? 'Projected lineup leads' : 'Found draft-day value'}</h3><p>{lineupRank <= valueRank ? `${ordinal(lineupRank)} in the room with ${formatPoints(selected.lineup.points)} projected starter points.` : `${ordinal(valueRank)} in room value with ${formatTally(selected.valueTally)} picks gained against the market.`}</p><span>{lineupRank <= valueRank ? 'Lineup strength' : 'Market discipline'}</span></article><article><p className="cc-grades-kicker cc-risk">Watchout</p><h3>{emptySeats.length ? 'Starting spots remain open' : `${weakest.position} is the thinnest room`}</h3><p>{emptySeats.length ? `${emptySeats.slice(0, 3).join(', ')}${emptySeats.length > 3 ? ` and ${emptySeats.length - 3} more` : ''} still need a player.` : `${weakest.count} ${weakest.position}s for ${weakest.required} dedicated starter spot${weakest.required === 1 ? '' : 's'}.`}</p><span>{emptySeats.length ? `${emptySeats.length} open` : `${weakest.position} depth`}</span></article><article><p className="cc-grades-kicker cc-next">Next move</p><h3>{emptySeats.length ? 'Finish the starting lineup' : `Monitor ${weakest.position} depth`}</h3><p>{emptySeats.length ? 'Prioritize playable starters before adding luxury depth.' : `Use waivers or surplus at stronger positions to protect the ${weakest.position} room.`}</p><span>{busiestBye ? `Week ${busiestBye.week}: ${busiestBye.count} byes` : 'Waiver plan'}</span></article></div>
          {(bestPick || worstPick) ? <div className="cc-grades-pick-cards">{bestPick ? <article>{bestPick.player ? <PlayerPhoto player={bestPick.player} /> : null}<div><p className="cc-grades-kicker cc-good">Best value · Round {bestPick.pick.round}</p><h4>{playerName(bestPick.player, bestPick.pick)}</h4><span>{bestPick.player?.position ?? bestPick.pick.meta?.position ?? '—'} · Pick {bestPick.pick.pickNo}</span></div><b className="cc-up">{formatTally(bestPick.delta)}<small>vs market</small></b></article> : null}{worstPick ? <article>{worstPick.player ? <PlayerPhoto player={worstPick.player} /> : null}<div><p className="cc-grades-kicker cc-risk">{worstPick.delta < 0 ? 'Biggest reach' : 'Least value'} · Round {worstPick.pick.round}</p><h4>{playerName(worstPick.player, worstPick.pick)}</h4><span>{worstPick.player?.position ?? worstPick.pick.meta?.position ?? '—'} · Pick {worstPick.pick.pickNo}</span></div><b className={worstPick.delta < 0 ? 'cc-down' : 'cc-up'}>{formatTally(worstPick.delta)}<small>vs market</small></b></article> : null}</div> : null}
          {selectedWriteup ? <TeamWriteup writeup={selectedWriteup} /> : null}<section className="cc-grades-ai-strip"><span>✦</span><div><b>Scout’s summary</b><p>Generate a personalized room recap with steals, reaches, risks, and next moves.</p></div><button type="button" className="cc-grades-ai-btn" onClick={() => { void writeAiSummary() }} disabled={aiBusy} aria-busy={aiBusy}>{aiBusy ? 'Writing…' : aiGrade ? 'Rewrite' : 'AI summary'}</button></section></div>
      </div>
    </div> : null}

    {tab === 'roster' && selected ? <div className="cc-grades-roster-tab"><section className="cc-grades-roster-table"><div className="cc-grades-card-head"><h3>{selected.teamName} · Pick by pick</h3><span>Market value at draft time</span></div><div className="cc-grades-pick-head"><span>Rd</span><span>Player</span><span>Pos</span><span>Pick</span><span>Market</span><span>Value</span><span>Proj</span></div>{selectedPicks.map((pick) => { const player = playersById.get(pick.playerId); const baseline = player ? marketBaseline(player) : null; const delta = pick.pickNo > 0 && baseline ? pick.pickNo - baseline.value : null; const position = player?.position ?? pick.meta?.position ?? '—'; return <div className="cc-grades-pick-row" key={`${pick.pickNo}-${pick.playerId}`}><span>{pick.round}</span><span className="cc-grades-pick-player">{player ? <PlayerPhoto player={player} /> : null}<b>{playerName(player, pick)}<small>{player?.team ?? pick.meta?.team ?? 'FA'}{pick.isKeeper ? ' · Keeper' : ''}</small></b></span><span className={`cc-grades-pos ${positionClass(position)}`}>{position}</span><span>{pick.pickNo > 0 ? pick.pickNo : 'K'}</span><span>{baseline ? baseline.value.toFixed(1) : '—'}</span><span className={delta == null ? '' : delta >= 0 ? 'cc-up' : 'cc-down'}>{delta == null ? '—' : formatTally(delta)}</span><span>{formatPoints(player?.projectedPoints)}</span></div> })}</section><aside><section className="cc-grades-construction"><div className="cc-grades-card-head"><h3>Roster construction</h3><span>vs starters</span></div><div>{CORE_POSITIONS.map((position) => { const count = counts.get(position) ?? 0; const required = session.slots[position]; const width = required ? Math.min(100, Math.round(count / Math.max(required + 1, 1) * 100)) : count ? 100 : 0; return <div className="cc-grades-construction-row" key={position}><b>{position}</b><i><u className={positionClass(position)} style={{ width: `${width}%` }} /></i><span>{count} drafted · {required} start</span></div> })}</div></section><section className="cc-grades-byes"><div className="cc-grades-card-head"><h3>Bye-week pressure</h3><span>{byeRows.filter((row) => row.stacked).length} conflicts</span></div>{byeRows.length ? <div>{byeRows.map((row) => <p key={row.week} className={row.stacked ? 'stacked' : undefined}><b>Week {row.week}</b><i><u style={{ width: `${Math.max(8, row.count / Math.max(1, selectedRoster.length) * 100)}%` }} /></i><span>{row.count} · {formatByePositions(row.byPosition)}</span></p>)}</div> : <p className="cc-grades-none">No bye-week data for this roster.</p>}</section></aside></div> : null}

    {tab === 'rankings' ? <div className="cc-grades-rankings-tab"><section><div className="cc-grades-card-head"><h3>Full room rankings</h3><span>Formula shown for transparency</span></div><div className="cc-grades-rank-head"><span>Rank</span><span>Team</span><span>Grade</span><span>Projected lineup</span><span>Draft value</span><span>Coverage</span></div>{standings.map((grade, index) => { const mine = grade.slot === highlightedSlot; const coverage = grade.lineup.seats.length ? Math.round(grade.lineup.starters / grade.lineup.seats.length * 100) : 0; return <div className={`cc-grades-rank-row${mine ? ' mine' : ''}`} key={grade.slot}><b>{index + 1}</b><span className="cc-grades-team"><TeamLogo src={avatarBySlot.get(grade.slot)} label={grade.teamName} /><span>{grade.teamName}</span>{mine ? <b className="cc-mine">YOU</b> : null}</span><GradeMark grade={grade.grade} /><span><b>{formatPoints(grade.lineup.points)}</b><small>{ordinal(rankFor(grade.lineup.points, lineupValues))} in room</small></span><ValueText value={grade.valueTally} unvalued={grade.unvaluedPicks} /><span><b>{coverage}%</b><small>{grade.lineup.starters}/{grade.lineup.seats.length} slots</small></span></div> })}</section></div> : null}
  </div>
}
