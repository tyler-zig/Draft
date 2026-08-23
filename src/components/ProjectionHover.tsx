import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ProjectionSourceLine } from '../api/collectedProjections'
import { projectionBreakdownRows, projectionBreakdownText, shownProjectionStat } from '../api/projectionBreakdown'

export function ProjectionHover({
  value,
  breakdown,
  pick,
  label = 'Projection',
  className,
  signed = false,
}: {
  value: number | null | undefined
  breakdown?: ProjectionSourceLine[] | null
  pick?: (line: ProjectionSourceLine) => number | null | undefined
  label?: string
  className?: string
  signed?: boolean
}) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [box, setBox] = useState({ top: 0, left: 0 })
  const tipId = useId()
  const shown = shownProjectionStat(value)
  const take = pick ?? ((line: ProjectionSourceLine) => line.points)
  const rows = projectionBreakdownRows(value, breakdown ?? undefined, take)
  const signedShown = signed && value != null && value > 0 ? `+${shown}` : shown
  const text = projectionBreakdownText(value, breakdown ?? undefined, take)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const width = 200
    const height = 28 + rows.length * 22
    let left = rect.left - width - 10
    if (left < 8) left = Math.min(window.innerWidth - width - 8, rect.right + 10)
    let top = rect.top + rect.height / 2 - height / 2
    top = Math.max(8, Math.min(top, window.innerHeight - height - 8))
    setBox({ top, left })
  }, [open, rows.length])

  if (shown == null) return <span className={className}>—</span>
  if (rows.length <= 1) return <span className={className}>{signedShown}</span>

  const tip = open
    ? createPortal(
      <span id={tipId} className="cc-proj-tip" role="tooltip" style={{ top: box.top, left: box.left }}>
        <b>{label}</b>
        {rows.map((row) => (
          <span key={row.label} className={row.consensus ? 'cc-proj-tip-consensus' : undefined}>
            <i>{row.label}</i>
            <em>{row.consensus && signed && value != null && value > 0 ? `+${row.value}` : row.value}</em>
          </span>
        ))}
      </span>,
      themeRoot(triggerRef.current),
    )
    : null

  return (
    <span
      ref={triggerRef}
      className={`cc-proj-hover ${className ?? ''}`.trim()}
      tabIndex={0}
      aria-label={text}
      aria-describedby={open ? tipId : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {signedShown}
      {tip}
    </span>
  )
}

function themeRoot(node: HTMLElement | null) {
  return node?.closest('.draft-command-center, .player-intelligence') ?? document.body
}
