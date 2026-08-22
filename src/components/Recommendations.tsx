import type { Recommendation } from '../draft/recommend'
import { PositionBadge } from './PositionBadge'

function adpLabel(player: Recommendation['player']) {
  if (player.adp != null) return player.adp
  if (player.searchRank >= 9000) return '—'
  return Number.isInteger(player.searchRank)
    ? player.searchRank
    : player.searchRank.toFixed(1)
}

export function Recommendations({
  recs,
  canDraft,
  queuedIds,
  onDraft,
  onToggleQueue,
  hideHeader = false,
}: {
  recs: Recommendation[]
  canDraft: boolean
  queuedIds: string[]
  onDraft?: (playerId: string) => void
  onToggleQueue?: (playerId: string) => void
  hideHeader?: boolean
}) {
  const queued = new Set(queuedIds)
  return (
    <section className="min-h-0 flex-1 overflow-auto">
      {hideHeader ? null : (
        <header className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Who to pick
        </header>
      )}
      <ol className="flex flex-col gap-1.5 px-2 py-2">
        {recs.length === 0 ? (
          <li className="px-2 py-6 text-center text-sm text-muted">
            No players left.
          </li>
        ) : (
          recs.map((rec, i) => (
            <li
              key={rec.player.id}
              className="flex items-start gap-2 rounded-lg border border-line/80 bg-panel-2 px-2.5 py-2"
            >
              <span className="mt-0.5 w-5 text-center font-mono text-xs font-bold text-accent">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{rec.player.fullName}</span>
                  <PositionBadge position={rec.player.position} />
                </div>
                <div className="text-xs text-muted">
                  {rec.player.team ?? 'FA'} · ADP {adpLabel(rec.player)}
                </div>
                <div className="mt-1 text-xs font-medium text-accent">
                  {rec.reason}
                </div>
                {rec.reasons.length > 1 ? (
                  <div className="text-[11px] text-muted">
                    {rec.reasons.slice(1).join(' · ')}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => onToggleQueue?.(rec.player.id)}
                  className={`rounded-md px-2 py-1 text-xs font-semibold ${
                    queued.has(rec.player.id)
                      ? 'bg-accent text-bg'
                      : 'border border-line text-muted hover:text-ink'
                  }`}
                >
                  {queued.has(rec.player.id) ? 'Queued' : 'Queue'}
                </button>
                {canDraft ? (
                  <button
                    type="button"
                    onClick={() => onDraft?.(rec.player.id)}
                    className="rounded-md bg-accent px-2 py-1 text-xs font-semibold text-bg hover:opacity-90"
                  >
                    Draft
                  </button>
                ) : null}
              </div>
            </li>
          ))
        )}
      </ol>
    </section>
  )
}
