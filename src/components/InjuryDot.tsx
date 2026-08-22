import { injuryTone } from '../draft/injuryStatus'

export function InjuryDot({
  status,
  always = false,
}: {
  status: string | null | undefined
  /** Best-available keeps a green healthy dot; the board only marks designations. */
  always?: boolean
}) {
  const tone = injuryTone(status)
  if (!tone && !always) return null
  const extra = tone === 'out' ? ' cc-out' : tone === 'warn' ? ' cc-warn' : ''
  return <i className={`cc-status${extra}`} title={status || undefined} aria-label={status || undefined} />
}
