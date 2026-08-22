import { useMemo, useState } from 'react'
import { leagueProjections, type TeamGrade } from '../draft/grades'
import type { DraftPick, DraftSession, Player } from '../providers/types'

type SortKey = 'slot' | 'points' | 'value'

function valueOf(grade: TeamGrade, key: SortKey): number {
  if (key === 'slot') return grade.slot
  if (key === 'value') return grade.valueTally
  return grade.lineup.points
}

function formatTally(value: number): string {
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1)
  return value > 0 ? `+${rounded}` : rounded
}

const SORTABLE_HEADS: Array<{ key: SortKey; label: string }> = [
  { key: 'slot', label: 'Team' },
  { key: 'points', label: 'Lineup pts' },
  { key: 'value', label: 'Value gained' },
]

/**
 * Every team's draft so far, graded: projected starting-lineup points and a
 * value-over-market tally per pick. The end-of-mock report -- the same table
 * the room shows on demand.
 */
export function DraftGrades({ session, picks, players, highlightedSlot = null, note }: {
  session: DraftSession
  picks: DraftPick[]
  players: Player[]
  highlightedSlot?: number | null
  note?: string
}) {
  const [sortKey, setSortKey] = useState<SortKey>('points')
  const [ascending, setAscending] = useState(false)

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

  const rows = useMemo(
    () => [...grades].sort((a, b) => (valueOf(a, sortKey) - valueOf(b, sortKey)) * (ascending ? 1 : -1)),
    [grades, sortKey, ascending],
  )

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) { setAscending((current) => !current); return }
    setSortKey(key)
    setAscending(key === 'slot')
  }

  return <div className="cc-grades">
    {note ? <p className="cc-grades-note">{note}</p> : null}
    <div className="cc-grades-scroll">
      {grades.length === 0
        ? <p className="cc-table-empty">No picks made yet.</p>
        : <table className="cc-grades-table">
          <thead>
            <tr>
              {SORTABLE_HEADS.map((head) => <th key={head.key}><button type="button" className="cc-sort-head" aria-label={`Sort by ${head.label}`} onClick={() => toggleSort(head.key)}>{head.label}{sortKey === head.key ? <span>{ascending ? '▲' : '▼'}</span> : null}</button></th>)}
              <th>Coverage</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((grade) => <tr key={grade.slot} className={grade.slot === highlightedSlot ? 'cc-grades-you' : undefined}>
              <td><span className="cc-team-label">{grade.teamName}</span>{grade.slot === highlightedSlot ? <b className="cc-mine">YOU</b> : null}</td>
              <td className="cc-grades-num">{grade.lineup.points.toFixed(1)}</td>
              <td className={`cc-grades-num ${grade.valueTally > 0 ? 'cc-up' : grade.valueTally < 0 ? 'cc-down' : ''}`}>{formatTally(grade.valueTally)}{grade.unvaluedPicks > 0 ? <small> {grade.unvaluedPicks} unvalued</small> : null}</td>
              <td className="cc-grades-num">{grade.lineup.covered}/{grade.lineup.starters}</td>
              <td>{grade.grade ? <span className={`cc-grade cc-grade-${grade.grade.toLowerCase()}`}>{grade.grade}</span> : <span className="cc-empty">—</span>}</td>
            </tr>)}
          </tbody>
        </table>}
    </div>
  </div>
}
