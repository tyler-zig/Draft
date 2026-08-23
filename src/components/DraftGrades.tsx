import { useMemo, useState } from 'react'
import {
  leagueProjections,
  MIN_GRADED_TEAMS,
  MIN_PICKS_PER_TEAM,
  type Grade,
  type TeamGrade,
} from '../draft/grades'
import type { FilledSlot } from '../draft/rosterNeeds'
import type { DraftPick, DraftSession, Player } from '../providers/types'
import { PlayerPhoto } from './PlayerPhoto'
import { TeamLogo } from './TeamLogo'

type SortKey = 'slot' | 'points' | 'value' | 'grade'

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

function formatPoints(value: number): string {
  return value.toFixed(1)
}

function ordinal(place: number): string {
  const mod100 = place % 100
  if (mod100 >= 11 && mod100 <= 13) return `${place}th`
  if (place % 10 === 1) return `${place}st`
  if (place % 10 === 2) return `${place}nd`
  if (place % 10 === 3) return `${place}rd`
  return `${place}th`
}

function positionClass(position: string): string {
  return `cc-${position.toLowerCase().replace('/', '')}`
}

function slotLabel(seat: FilledSlot): string {
  if (seat.key === 'FLEX') return 'FLEX'
  if (seat.key === 'SUPER_FLEX') return 'SF'
  return seat.label
}

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'grade', label: 'Grade' },
  { key: 'points', label: 'Lineup pts' },
  { key: 'value', label: 'Value' },
  { key: 'slot', label: 'Team' },
]

function GradeMark({ grade, size = 'md' }: { grade: Grade | null; size?: 'sm' | 'md' | 'lg' }) {
  if (!grade) return <span className={`cc-grade cc-grade-pending cc-grade-${size}`}>—</span>
  return <span className={`cc-grade cc-grade-${grade.toLowerCase()} cc-grade-${size}`}>{grade}</span>
}

function ValueChip({ value, unvalued = 0 }: { value: number; unvalued?: number }) {
  const tone = value > 0 ? 'cc-up' : value < 0 ? 'cc-down' : ''
  return (
    <span className={`cc-grades-value ${tone}`}>
      {formatTally(value)}
      {unvalued > 0 ? <small>{unvalued} unvalued</small> : null}
    </span>
  )
}

function StarterChips({ seats, compact = false }: { seats: FilledSlot[]; compact?: boolean }) {
  const filled = seats.filter((seat) => seat.player)
  if (filled.length === 0) return null
  return (
    <ul className={`cc-grades-starters${compact ? ' cc-grades-starters-compact' : ''}`}>
      {filled.map((seat) => {
        const player = seat.player
        if (!player) return null
        return (
          <li key={`${seat.label}-${player.id}`}>
            <span className={`cc-p ${positionClass(player.position)}`}>{slotLabel(seat)}</span>
            {compact ? null : <PlayerPhoto player={player} />}
            <b>{player.fullName}</b>
            {player.projectedPoints != null ? <em>{formatPoints(player.projectedPoints)}</em> : <i>no proj</i>}
          </li>
        )
      })}
    </ul>
  )
}

function EmptySeats({ seats }: { seats: FilledSlot[] }) {
  const holes = seats.filter((seat) => !seat.player)
  if (holes.length === 0) return null
  return (
    <p className="cc-grades-holes">
      Open: {holes.map((seat) => slotLabel(seat)).join(', ')}
    </p>
  )
}

/**
 * Every team's draft so far, graded: projected starting-lineup points and a
 * value-over-market tally per pick. The end-of-mock report -- the same sheet
 * the room shows on demand.
 */
export function DraftGrades({ session, picks, players, highlightedSlot = null, note }: {
  session: DraftSession
  picks: DraftPick[]
  players: Player[]
  highlightedSlot?: number | null
  note?: string
}) {
  const [sortOverride, setSortOverride] = useState<SortKey | null>(null)
  const [ascending, setAscending] = useState(false)
  const [openSlot, setOpenSlot] = useState<number | null>(highlightedSlot)

  const avatarBySlot = useMemo(
    () => new Map(session.order.map((slot) => [slot.slot, slot.avatar ?? null])),
    [session.order],
  )

  const grades = useMemo(() => {
    const playersById = new Map(players.map((player) => [player.id, player]))
    const teamNameBySlot = new Map(
      session.order.map((slot) => [slot.slot, slot.teamName || slot.displayName]),
    )
    return leagueProjections({
      picks,
      playersById,
      teams: session.teams,
      slots: session.slots,
      teamNameBySlot,
    })
  }, [session, picks, players])

  const lettersReady = grades.some((grade) => grade.grade != null)
  const sortKey = sortOverride ?? (lettersReady ? 'grade' : 'points')
  const rows = useMemo(
    () => [...grades].sort((a, b) => (valueOf(a, sortKey) - valueOf(b, sortKey)) * (ascending ? 1 : -1)),
    [grades, sortKey, ascending],
  )

  const yours = highlightedSlot != null
    ? grades.find((grade) => grade.slot === highlightedSlot) ?? null
    : null
  const maxPoints = Math.max(...grades.map((grade) => grade.lineup.points), 1)
  const yourPlace = yours
    ? [...grades].sort((a, b) => b.lineup.points - a.lineup.points).findIndex((grade) => grade.slot === yours.slot) + 1
    : 0
  const readyCount = grades.filter((grade) => grade.picks.length >= MIN_PICKS_PER_TEAM).length

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setAscending((current) => !current)
      return
    }
    setSortOverride(key)
    setAscending(key === 'slot')
  }

  return (
    <div className="cc-grades">
      {note ? <p className="cc-grades-note">{note}</p> : null}
      <div className="cc-grades-scroll">
        {grades.length === 0 ? (
          <p className="cc-table-empty">No picks made yet.</p>
        ) : (
          <>
            {yours ? (
              <section className="cc-grades-hero" aria-label={`${yours.teamName} draft report`}>
                <GradeMark grade={yours.grade} size="lg" />
                <div className="cc-grades-hero-who">
                  <p className="cc-eyebrow">Your draft</p>
                  <h3>
                    <TeamLogo src={avatarBySlot.get(yours.slot)} label={yours.teamName} />
                    {yours.teamName}
                    <b className="cc-mine">YOU</b>
                  </h3>
                  <p className="cc-grades-hero-place">
                    {lettersReady
                      ? `${ordinal(yourPlace)} of ${grades.length} by projected lineup`
                      : `${yours.picks.length} pick${yours.picks.length === 1 ? '' : 's'} in · letters after ${MIN_PICKS_PER_TEAM} picks from ${MIN_GRADED_TEAMS} teams`}
                  </p>
                </div>
                <dl className="cc-grades-hero-stats">
                  <div>
                    <dt>Lineup pts</dt>
                    <dd>{formatPoints(yours.lineup.points)}</dd>
                  </div>
                  <div>
                    <dt>Value</dt>
                    <dd><ValueChip value={yours.valueTally} unvalued={yours.unvaluedPicks} /></dd>
                  </div>
                  <div>
                    <dt>Coverage</dt>
                    <dd>{yours.lineup.covered}/{yours.lineup.starters}</dd>
                  </div>
                </dl>
                <StarterChips seats={yours.lineup.seats} compact />
                <EmptySeats seats={yours.lineup.seats} />
              </section>
            ) : null}

            <div className="cc-grades-toolbar">
              <p className="cc-grades-legend">
                {lettersReady
                  ? 'Letter is 70% projected lineup, 30% ADP value, scored against this room.'
                  : `Letters lock in after ${MIN_PICKS_PER_TEAM} picks from ${MIN_GRADED_TEAMS} teams · ${readyCount} ready.`}
              </p>
              <div className="cc-grades-sorts">
                {SORTS.map((sort) => (
                  <button
                    key={sort.key}
                    type="button"
                    className={sortKey === sort.key ? 'on' : undefined}
                    aria-label={`Sort by ${sort.label}`}
                    aria-pressed={sortKey === sort.key}
                    onClick={() => toggleSort(sort.key)}
                  >
                    {sort.label}
                    {sortKey === sort.key ? <span>{ascending ? '▲' : '▼'}</span> : null}
                  </button>
                ))}
              </div>
            </div>

            <ol className="cc-grades-list">
              {rows.map((grade, index) => {
                const mine = grade.slot === highlightedSlot
                const open = openSlot === grade.slot
                const bar = Math.max(4, Math.round((grade.lineup.points / maxPoints) * 100))
                return (
                  <li key={grade.slot}>
                    <button
                      type="button"
                      className={`cc-grades-row${mine ? ' cc-grades-you' : ''}${open ? ' cc-grades-open' : ''}`}
                      aria-expanded={open}
                      aria-label={`${grade.teamName} details`}
                      onClick={() => setOpenSlot(open ? null : grade.slot)}
                    >
                      <span className="cc-grades-place">{index + 1}</span>
                      <GradeMark grade={grade.grade} size="md" />
                      <span className="cc-grades-team">
                        <TeamLogo src={avatarBySlot.get(grade.slot)} label={grade.teamName} />
                        <span className="cc-team-label">{grade.teamName}</span>
                        {mine ? <b className="cc-mine">YOU</b> : null}
                      </span>
                      <span className="cc-grades-metric">
                        <strong>{formatPoints(grade.lineup.points)}</strong>
                        <span className="cc-grades-bar" aria-hidden="true"><i style={{ width: `${bar}%` }} /></span>
                      </span>
                      <ValueChip value={grade.valueTally} unvalued={grade.unvaluedPicks} />
                      <span className="cc-grades-cover">{grade.lineup.covered}/{grade.lineup.starters}</span>
                    </button>
                    {open ? (
                      <div className="cc-grades-lineup">
                        <StarterChips seats={grade.lineup.seats} />
                        <EmptySeats seats={grade.lineup.seats} />
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ol>
          </>
        )}
      </div>
    </div>
  )
}
