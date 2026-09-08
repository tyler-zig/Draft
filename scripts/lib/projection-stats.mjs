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
 * CBS `/season/projections/` and FantasySharks' default Segment both flip
 * to Week 1 at kickoff. Sharks CSVs often omit G, so games alone cannot
 * catch a 63-yard Gibbs line. Averaging that into a season consensus
 * halves VORP.
 */
export function isWeeklyProjection(row) {
  const games = row?.games
  if (typeof games === 'number' && games > 0 && games <= 3) return true
  if (typeof games === 'number' && games > 3) return false
  return looksWeeklyVolume(row?.stats)
}

/** Starter-sized week-1 totals. Season backups sit above these floors. */
export function looksWeeklyVolume(stats) {
  if (!stats || typeof stats !== 'object') return false
  const pass = stats.pass_yd
  const rush = stats.rush_yd
  const rec = stats.rec_yd
  const fg = stats.fgm
  const sacks = stats.sack
  const allowed = stats.pts_allow
  if (pass > 800 || rush > 300 || rec > 300 || fg > 10 || sacks > 15 || allowed > 80) return false
  if (typeof pass === 'number' && pass > 0 && pass <= 500) return true
  if (typeof rush === 'number' && rush > 0 && rush <= 180) return true
  if (typeof rec === 'number' && rec > 0 && rec <= 180) return true
  if (typeof fg === 'number' && fg > 0 && fg <= 6) return true
  if (typeof sacks === 'number' && sacks > 0 && sacks <= 8) return true
  if (typeof allowed === 'number' && allowed > 0 && allowed <= 50) return true
  return false
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

/** Drop a source whose PPR volume is under half or over 2.2× the others. */
export const OUTLIER_LOW = 0.45
export const OUTLIER_HIGH = 2.2
export const OUTLIER_MIN_SOURCES = 3

export function volumeScore(stats) {
  if (!stats || typeof stats !== 'object') return 0
  return (stats.pass_yd ?? 0) * 0.04
    + (stats.pass_td ?? 0) * 4
    + (stats.pass_int ?? 0) * -1
    + (stats.rush_yd ?? 0) * 0.1
    + (stats.rush_td ?? 0) * 6
    + (stats.rec ?? 0)
    + (stats.rec_yd ?? 0) * 0.1
    + (stats.rec_td ?? 0) * 6
    + (stats.fgm ?? 0) * 3
    + (stats.xpm ?? 0)
    + (stats.sack ?? 0)
    + (stats.int ?? 0) * 2
    + (stats.fum_rec ?? 0) * 2
    + (stats.def_td ?? 0) * 6
    + (stats.safe ?? 0) * 2
}

export function median(values) {
  const amounts = values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((left, right) => left - right)
  if (!amounts.length) return null
  const mid = Math.floor(amounts.length / 2)
  return amounts.length % 2 ? amounts[mid] : (amounts[mid - 1] + amounts[mid]) / 2
}

/**
 * A single rogue board (week-1 CBS, career totals, a shifted column) should
 * not move consensus. Needs three sources so two-way disagreement stays.
 */
export function rejectOutlierSamples(samples) {
  const rows = (samples ?? []).filter((sample) => sample && hasVolume(sample.stats))
  if (rows.length < OUTLIER_MIN_SOURCES) return rows
  const scored = rows.map((sample) => ({ sample, points: volumeScore(sample.stats) }))
  const mid = median(scored.map((row) => row.points))
  if (!(mid > 0)) return rows
  const kept = scored
    .filter((row) => row.points >= mid * OUTLIER_LOW && row.points <= mid * OUTLIER_HIGH)
    .map((row) => row.sample)
  return kept.length >= 2 ? kept : rows
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
