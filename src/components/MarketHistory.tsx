import { marketHistoryMode, withLiveObservation, type PlayerMarketHistory } from '../api/playerIntelligence'
import './market-history.css'

const rank = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1)
const date = (value: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(value)

const MODE_LABEL = { liveAdp: 'Live ADP', adp: 'ADP', rank: 'Consensus rank' } as const

export function MarketHistory({ history, loading = false, compact = false, live = null }: { history?: PlayerMarketHistory; loading?: boolean; compact?: boolean; live?: { at: number; value: number } | null }) {
  if (loading) return <div className="market-history-empty">Loading ranking history…</div>
  const observed = history?.points ?? []
  // The room's live snapshot is newer than any collected observation on disk,
  // so the freshest board value rides along as the trailing point.
  const pointsWithLive = withLiveObservation(observed, live)
  // Live ADP wins only after two collected snapshots have a live-ADP value.
  // Today's board can trail that series; it cannot start one by itself.
  const mode = marketHistoryMode(pointsWithLive)
  const label = MODE_LABEL[mode]
  const points = pointsWithLive.flatMap((point) => {
    const value = point[mode]
    return value == null ? [] : [{ ...point, value }]
  }).slice(-30)
  if (points.length < 2) return <div className="market-history-empty">{history?.message ?? 'At least two collected observations are needed for a trend.'}</div>

  const values = points.map((point) => point.value)
  const low = Math.min(...values), high = Math.max(...values), spread = Math.max(1, high - low)
  // A chart of a value that has not moved is 150px of flat line. Say so in a
  // sentence instead -- collected rankings are often all from the same run.
  if (low === high) {
    return <div className="market-history-empty">
      {label} has not moved — {rank(low)} across {points.length} observations since {date(points[0].at)}.
    </div>
  }
  const firstAt = points[0].at, lastAt = points.at(-1)?.at ?? firstAt, timeSpread = Math.max(1, lastAt - firstAt)
  const x = (at: number, index: number) => lastAt === firstAt ? 12 + index * (296 / Math.max(1, points.length - 1)) : 12 + ((at - firstAt) / timeSpread) * 296
  const y = (value: number) => 12 + ((value - low) / spread) * 62
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(point.at, index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ')
  const latest = points.at(-1)!

  return <figure className={`market-history ${compact ? 'market-history-compact' : ''}`}>
    <figcaption><span>{label} history</span><b>Now {rank(latest.value)}</b></figcaption>
    <svg viewBox="0 0 320 88" role="img" aria-label={`${label} history from ${date(firstAt)} to ${date(lastAt)}`}><line x1="12" y1="12" x2="308" y2="12"/><line x1="12" y1="43" x2="308" y2="43"/><line x1="12" y1="74" x2="308" y2="74"/><path d={path}/>{points.map((point, index) => <circle key={`${point.at}-${index}`} cx={x(point.at, index)} cy={y(point.value)} r="2.5"><title>{date(point.at)}: {rank(point.value)}{point.sourceCount ? ` · ${point.sourceCount} source rows` : ' · live board'}</title></circle>)}</svg>
    <footer><span>{date(firstAt)}</span><small>{history?.source}</small><span>{date(lastAt)}</span></footer>
  </figure>
}
