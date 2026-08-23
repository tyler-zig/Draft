/**
 * Live pick-clock helpers.
 *
 * ESPN's league payload only publishes the configured timeout. The remaining
 * seconds come from the draft-room page (DOM / socket) as `endsAt`, so the
 * app can tick locally without a message every second.
 */
export type PickClock = {
  remaining: number
  endsAt: number | null
  paused?: boolean
}

export function formatPickClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safe / 60)
  return `${minutes}:${String(safe % 60).padStart(2, '0')}`
}

export function remainingPickSeconds(
  clock: PickClock | null | undefined,
  now = Date.now(),
): number | null {
  if (!clock) return null
  if (clock.paused || clock.endsAt == null) return Math.max(0, Math.round(clock.remaining))
  return Math.max(0, Math.ceil((clock.endsAt - now) / 1000))
}
