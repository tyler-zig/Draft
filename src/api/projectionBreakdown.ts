import type { ProjectionSourceLine } from './collectedProjections'

export function shownProjectionStat(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function projectionBreakdownRows(
  consensus: number | null | undefined,
  breakdown: ProjectionSourceLine[] | undefined,
  pick: (line: ProjectionSourceLine) => number | null | undefined,
) {
  const rows: Array<{ label: string; value: string; consensus?: boolean }> = []
  const consensusShown = shownProjectionStat(consensus)
  if (consensusShown != null) rows.push({ label: 'Consensus', value: consensusShown, consensus: true })
  for (const line of breakdown ?? []) {
    const shown = shownProjectionStat(pick(line))
    if (shown == null) continue
    rows.push({ label: line.label, value: shown })
  }
  return rows
}

export function projectionBreakdownText(
  consensus: number | null | undefined,
  breakdown: ProjectionSourceLine[] | undefined,
  pick: (line: ProjectionSourceLine) => number | null | undefined,
) {
  return projectionBreakdownRows(consensus, breakdown, pick)
    .map((row) => `${row.label} ${row.value}`)
    .join('\n')
}
