/**
 * How far a player has slid past where the market expects them to go.
 *
 * Real ADP is the right yardstick and is used when a collected source supplies
 * one. Consensus rank is the fallback: it answers a related but different
 * question (how good is he, not when does he go), so a player the market
 * reaches for early reads as a bargain under rank and correctly reads as
 * neutral under ADP.
 */
export function adpDelta(
  currentPickNo: number,
  rank: number,
  adp?: number | null,
): { text: string; className: string; title: string } {
  const baseline = adp != null && adp > 0 ? adp : rank
  const source = adp != null && adp > 0 ? 'ADP' : 'consensus rank'

  if (baseline >= 9000 || currentPickNo < 1) {
    return { text: '—', className: 'text-muted', title: 'No ranking data' }
  }

  const delta = Math.round(currentPickNo - baseline)
  const title = `Pick ${currentPickNo} vs ${source} ${baseline.toFixed(1)}`

  // Inside a few picks of the baseline is noise, not a signal.
  if (Math.abs(delta) < 4) {
    return { text: '—', className: 'text-muted', title }
  }
  if (delta > 0) {
    return { text: `+${delta}`, className: 'text-accent', title: `${title} — falling` }
  }
  return { text: `${delta}`, className: 'text-danger', title: `${title} — reach` }
}
