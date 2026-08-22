import type { Player } from '../providers/types'
import { PositionBadge } from './PositionBadge'

export function DraftQueue({
  players,
  queuedIds,
  onRemove,
  onMove,
  hideHeader = false,
}: {
  players: Player[]
  queuedIds: string[]
  onRemove: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  hideHeader?: boolean
}) {
  const queued = queuedIds
    .map((id) => players.find((p) => p.id === id))
    .filter((p): p is Player => Boolean(p))

  return (
    <section className="min-h-0 flex-1 overflow-auto">
      {hideHeader ? null : (
        <header className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Queue {queued.length ? `(${queued.length})` : ''}
        </header>
      )}
      {queued.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm leading-6 text-muted">
          Queue players from the table or recs so you are ready when the clock
          hits you.
        </p>
      ) : (
        <ol className="flex flex-col gap-1 px-2 py-2">
          {queued.map((player, i) => (
            <li
              key={player.id}
              className="flex items-center gap-1.5 rounded-lg border border-line/80 bg-panel-2 px-2 py-1.5 text-sm"
            >
              <span className="w-4 font-mono text-xs tabular-nums text-muted">
                {i + 1}
              </span>
              <PositionBadge position={player.position} />
              <span className="min-w-0 flex-1 truncate">{player.fullName}</span>
              <button
                type="button"
                className="rounded px-1 text-xs text-muted hover:text-ink disabled:opacity-30"
                onClick={() => onMove(player.id, -1)}
                disabled={i === 0}
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                className="rounded px-1 text-xs text-muted hover:text-ink disabled:opacity-30"
                onClick={() => onMove(player.id, 1)}
                disabled={i === queued.length - 1}
                aria-label="Move down"
              >
                ↓
              </button>
              <button
                type="button"
                className="rounded px-1 text-xs text-danger hover:bg-danger/10"
                onClick={() => onRemove(player.id)}
                aria-label="Remove from queue"
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
