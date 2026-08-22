export type InjuryTone = 'warn' | 'out'

const SEVERE = /^(out|ir|pup|nfi|dnr|sus|susp|suspended|suspension|injury reserve|injured reserve)$/i

function normalizeInjury(status: string) {
  return status.trim().replace(/[_\s-]+/g, ' ')
}

/**
 * Questionable / doubtful stay a caution. IR, PUP, out, and suspensions are a
 * different designation -- those players are not available this week.
 */
export function injuryTone(status: string | null | undefined): InjuryTone | null {
  if (!status) return null
  const key = normalizeInjury(status)
  if (!key || /^active$/i.test(key)) return null
  return SEVERE.test(key) ? 'out' : 'warn'
}

export function isSevereInjury(status: string | null | undefined): status is string {
  return injuryTone(status) === 'out'
}
