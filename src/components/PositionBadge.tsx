const COLORS: Record<string, string> = {
  QB: 'bg-qb/15 text-qb',
  RB: 'bg-rb/15 text-rb',
  WR: 'bg-wr/15 text-wr',
  TE: 'bg-te/15 text-te',
  K: 'bg-k/15 text-k',
  DEF: 'bg-def/15 text-def',
}

export function PositionBadge({ position }: { position: string }) {
  const color = COLORS[position] ?? 'bg-line text-muted'
  return (
    <span
      className={`inline-flex min-w-8 justify-center rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide ${color}`}
    >
      {position || '—'}
    </span>
  )
}
