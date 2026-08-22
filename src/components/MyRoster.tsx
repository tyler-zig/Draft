import type { FilledSlot } from '../draft/rosterNeeds'
import { PositionBadge } from './PositionBadge'

export function MyRoster({
  slots,
  hideHeader = false,
}: {
  slots: FilledSlot[]
  hideHeader?: boolean
}) {
  return (
    <section className="min-h-0 flex-1 overflow-auto">
      {hideHeader ? null : (
        <header className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Your roster
        </header>
      )}
      <ul className="flex flex-col px-2 py-1">
        {slots.map((slot, i) => (
          <li
            key={`${slot.key}-${i}`}
            className="flex items-center gap-2 border-b border-line/50 px-2 py-1.5 text-sm last:border-b-0"
          >
            <span className="w-12 shrink-0 font-mono text-[11px] font-semibold text-muted">
              {slot.label}
            </span>
            {slot.player ? (
              <>
                <PositionBadge position={slot.player.position} />
                <span className="min-w-0 truncate">{slot.player.fullName}</span>
                <span className="ml-auto text-xs text-muted">
                  {slot.player.team ?? 'FA'}
                </span>
              </>
            ) : (
              <span className="text-muted/70">Empty</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
