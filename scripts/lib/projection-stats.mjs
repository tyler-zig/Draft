/**
 * Shared projection volume keys and scoring, kept in lockstep with
 * src/api/playerProjections.ts DEFAULT_RATES / SCORING_STAT_KEYS.
 *
 * Consensus averages these stats across sources, then the app rescores the
 * blend to the connected league. Precomputed points* on the artifact are the
 * default PPR / half / standard totals for boards that do not recompute.
 */

export const STAT_KEYS = [
  'pass_att', 'pass_cmp', 'pass_yd', 'pass_td', 'pass_int', 'pass_2pt',
  'rush_att', 'rush_yd', 'rush_td', 'rush_2pt',
  'rec', 'rec_tgt', 'rec_yd', 'rec_td', 'rec_2pt',
  'fum_lost',
  'fgm', 'fga', 'xpm',
  'sack', 'int', 'fum_rec', 'def_td', 'safe', 'pts_allow',
]

const RATES = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -1,
  pass_2pt: 2,
  rush_yd: 0.1,
  rush_td: 6,
  rush_2pt: 2,
  rec_yd: 0.1,
  rec_td: 6,
  rec_2pt: 2,
  fum_lost: -2,
  fgm: 3,
  xpm: 1,
  sack: 1,
  int: 2,
  fum_rec: 2,
  def_td: 6,
  safe: 2,
}

export function seasonFor(date = new Date()) {
  return date.getUTCMonth() >= 4 ? date.getUTCFullYear() : date.getUTCFullYear() - 1
}

/** "Allen, Josh" -> "Josh Allen". Leaves already-forward names alone. */
export function flipLastFirst(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const comma = text.indexOf(',')
  if (comma < 0) return text
  return `${text.slice(comma + 1).trim()} ${text.slice(0, comma).trim()}`.trim()
}

export function pickNumber(row, ...names) {
  for (const name of names) {
    if (row[name] == null || row[name] === '') continue
    const digits = String(row[name]).replace(/[^0-9.-]/g, '')
    if (!digits || !/[0-9]/.test(digits)) continue
    const amount = Number(digits)
    if (Number.isFinite(amount)) return amount
  }
  return null
}

export function compactStats(stats) {
  const compact = {}
  for (const key of STAT_KEYS) {
    const amount = stats[key]
    if (typeof amount === 'number' && Number.isFinite(amount)) compact[key] = amount
  }
  return compact
}

export function hasVolume(stats) {
  return STAT_KEYS.some((key) => typeof stats[key] === 'number')
}

/**
 * Mean of each stat across the sources that published it. A source that omits
 * receptions must not pull the consensus toward zero.
 */
export function averageStats(rows) {
  const sums = {}
  const counts = {}
  for (const stats of rows) {
    for (const key of STAT_KEYS) {
      const amount = stats[key]
      if (typeof amount !== 'number' || !Number.isFinite(amount)) continue
      sums[key] = (sums[key] ?? 0) + amount
      counts[key] = (counts[key] ?? 0) + 1
    }
  }
  const averaged = {}
  for (const key of STAT_KEYS) {
    if (counts[key]) averaged[key] = sums[key] / counts[key]
  }
  return averaged
}

export function averageNumber(values) {
  const amounts = values.filter((value) => typeof value === 'number' && Number.isFinite(value))
  if (!amounts.length) return null
  return amounts.reduce((sum, value) => sum + value, 0) / amounts.length
}

export function pointsFromStats(stats, receptionRate) {
  if (!hasVolume(stats)) return null
  let total = 0
  let matched = false
  for (const [key, rate] of Object.entries(RATES)) {
    const amount = stats[key]
    if (typeof amount !== 'number') continue
    matched = true
    total += amount * rate
  }
  if (typeof stats.rec === 'number') {
    matched = true
    total += stats.rec * receptionRate
  }
  return matched ? total : null
}

export function formatPoints(stats) {
  return {
    pointsPpr: pointsFromStats(stats, 1),
    pointsHalf: pointsFromStats(stats, 0.5),
    pointsStd: pointsFromStats(stats, 0),
  }
}

export const __test__ = { RATES }
