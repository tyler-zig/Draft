import { useState, type ReactNode } from 'react'
import type { Recommendation } from '../draft/recommend'
import { marketBaseline } from '../draft/playerContext'
import { InjuryDot } from './InjuryDot'
import { PlayerPhoto } from './PlayerPhoto'
import { ProjectionHover } from './ProjectionHover'

const positionClass = (position: string) => `cc-${position.toLowerCase().replace('/', '')}`

export function BestAvailable({
  recs,
  currentPickNo,
  targetPickNo,
  onSelect,
}: {
  recs: Recommendation[]
  currentPickNo: number
  /** Your next seat. When that is still ahead, recs and value are priced there. */
  targetPickNo?: number | null
  onSelect: (playerId: string) => void
}) {
  const horizonPickNo = targetPickNo != null && targetPickNo > currentPickNo ? targetPickNo : currentPickNo
  const waiting = horizonPickNo > currentPickNo
  const title = waiting ? `Best at pick ${horizonPickNo}` : 'Best available'
  const bestRec = recs[0]
  const others = recs.slice(1)
  const featuredId = bestRec?.player.id ?? null
  const [openedId, setOpenedId] = useState<string | null>(null)
  const expandedId = openedId && recs.some((rec) => rec.player.id === openedId) ? openedId : featuredId
  const featuredOpen = expandedId === featuredId

  if (!bestRec || !featuredId) {
    return (
      <section className="cc-card">
        <div className="cc-card-head"><div className="cc-card-title">{title}</div></div>
        <div className="cc-empty-card">No players available.</div>
      </section>
    )
  }

  const best = bestRec.player

  return (
    <section className="cc-card">
      <div className="cc-card-head"><div className="cc-card-title">{title}</div></div>
      <div className={`cc-best-block${featuredOpen ? '' : ' cc-best-closed'}`}>
        <div className="cc-best-row">
          <button type="button" className="cc-best-player" onClick={() => onSelect(best.id)}>
            <PlayerPhoto player={best} className="cc-avatar-lg" />
            <div>
              <strong>{best.fullName}<InjuryDot status={best.injuryStatus} always /></strong>
              <p><b>{best.position}</b>　{best.team ?? 'Free Agent'}</p>
              {bestRec.reason !== 'Best available' ? <small className="cc-best-reason">{bestRec.reason}</small> : null}
            </div>
          </button>
          {others.length && !featuredOpen ? (
            <ExpandButton
              name={best.fullName}
              expanded={false}
              onClick={() => setOpenedId(featuredId)}
            />
          ) : null}
        </div>
        {featuredOpen ? <SuggestionStats rec={bestRec} horizonPickNo={horizonPickNo} /> : null}
      </div>
      {others.length ? (
        <div className="cc-also">
          <div className="cc-also-head">Also consider</div>
          {others.map((rec, index) => {
            const open = expandedId === rec.player.id
            return (
              <div className={`cc-also-item${open ? ' cc-also-open' : ''}`} key={rec.player.id}>
                <div className="cc-also-row">
                  <button
                    type="button"
                    className="cc-also-pick"
                    onClick={() => onSelect(rec.player.id)}
                  >
                    <span className="cc-n">{index + 2}</span>
                    <PlayerPhoto player={rec.player} />
                    <span className="cc-also-who">
                      <span className="cc-also-line">
                        <span className="cc-also-name">{rec.player.fullName}</span>
                        <span className={`cc-p ${positionClass(rec.player.position)}`}>{rec.player.position}</span>
                      </span>
                      <small>{rec.reason}</small>
                    </span>
                  </button>
                  <ExpandButton
                    name={rec.player.fullName}
                    expanded={open}
                    onClick={() => setOpenedId(open ? featuredId : rec.player.id)}
                  />
                </div>
                {open ? <SuggestionStats rec={rec} horizonPickNo={horizonPickNo} /> : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

function ExpandButton({ name, expanded, onClick }: { name: string; expanded: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="cc-also-expand"
      aria-expanded={expanded}
      aria-label={expanded ? `Collapse ${name} suggestion` : `Expand ${name} suggestion`}
      onClick={onClick}
    >
      {expanded ? '▴' : '▾'}
    </button>
  )
}

function SuggestionStats({ rec, horizonPickNo }: { rec: Recommendation; horizonPickNo: number }) {
  const player = rec.player
  const baseline = marketBaseline(player)
  const value = baseline ? horizonPickNo - baseline.value : null

  return (
    <>
      {rec.breakdown.length > 1 ? (
        <details className="cc-score-breakdown">
          <summary>Why this score ({Math.round(rec.score)})</summary>
          <ul>
            {rec.breakdown.map((term, index) => (
              <li key={`${term.label}-${index}`}>
                <span>{term.label}</span>
                <b className={term.delta >= 0 ? 'cc-up' : 'cc-down'}>
                  {term.delta >= 0 ? '+' : ''}{Math.round(term.delta)}
                </b>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="cc-why">
        <h3>Why he’s a value</h3>
        <Meter
          label={baseline ? `Value vs ${baseline.source}` : 'Value vs ADP'}
          hint="How many picks later than the market this player is still available: current pick minus his draft position. Positive is a value; negative is a reach. Blank when no source publishes a draft position for him."
          value={value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}`}
          tone={value == null || value >= 0 ? 'green' : 'red'}
          width={value == null ? 8 : Math.max(8, Math.min(92, 50 + value * 4))}
          scale={['-10', '0', '+10']}
        />
        <Meter
          label="Projected Points"
          hint={player.projectedPoints != null
            ? "Consensus season projection scored to this league's format — the same figure behind VORP. Hover the number for each source's line."
            : 'No season projection is published for this player.'}
          value={<ProjectionHover value={player.projectedPoints} breakdown={player.projectionBreakdown} label="Projected points" />}
          tone="blue"
          width={player.projectedPoints == null ? 8 : Math.max(8, Math.min(92, player.projectedPoints / 4))}
          scale={['80', '200', '320']}
        />
        <Meter
          label="Tier Dropoff"
          hint="How costly it is to miss this player’s tier. A higher number means the next group is a steeper drop, so waiting is riskier."
          value={(Math.max(1, player.tier ?? 4) * 2.8).toFixed(1)}
          tone="green"
          width={62}
          scale={['0', '10', '20']}
        />
      </div>
    </>
  )
}

function Meter({ label, value, tone, width, scale, hint }: { label: string; value: ReactNode; tone: 'green' | 'blue' | 'red'; width: number; scale: [string, string, string]; hint?: string }) {
  return (
    <div className="cc-meter">
      <div className="cc-meter-top">
        <span className={hint ? 'cc-meter-label' : undefined} title={hint}>
          {label}{hint ? <i className="cc-hint" aria-hidden="true">ⓘ</i> : null}
        </span>
        <b className={`cc-${tone}`}>{value}</b>
      </div>
      <div className="cc-track">
        <i className={`cc-${tone}`} style={{ width: `${width}%` }} />
        <u style={{ left: `${width}%` }} />
      </div>
      <div className="cc-scale">
        <span>{scale[0]}</span>
        <span>{scale[1]}</span>
        <span>{scale[2]}</span>
      </div>
    </div>
  )
}
