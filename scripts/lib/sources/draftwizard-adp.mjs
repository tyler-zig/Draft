/**
 * Draft Wizard live ADP by league size and format.
 *
 * FantasyPros's real-time ADP API ignores a teams filter — 8- and 16-team
 * requests return the same ranks. Draft Wizard publishes a separate mock-draft
 * ADP table per size and scoring at /football/adp/mock-drafts/overall/default-
 * {half|ppr|std|rookie}-N-teams, which is the public board the site's own
 * dropdowns load. Dynasty is not a real scoring slug there (it falls through
 * to standard), so that format stays on the FantasyPros real-time board.
 * Avg Pick is printed as round.pick (9.07 = round 9, pick 7); we convert that
 * to an overall pick number in that league so it can sit next to the clock.
 *
 * Mirrors supabase/functions/_shared/ranking-collector.ts; keep the two in sync.
 */

import { fetchText, guard } from '../http.mjs'
import { clean, normalizePos, normalizeTeam, toNumber } from '../text.mjs'

const ORIGIN = 'https://draftwizard.fantasypros.com'
export const LIVE_ADP_TEAM_COUNTS = [8, 10, 12, 14, 16]
export const LIVE_ADP_FORMATS = [
  { slug: 'half', scoring: 'half', label: 'Half PPR', minRows: 50 },
  { slug: 'ppr', scoring: 'ppr', label: 'PPR', minRows: 50 },
  { slug: 'std', scoring: 'standard', label: 'Standard', minRows: 50 },
  { slug: 'rookie', scoring: 'rookie', label: 'Rookie', minRows: 20 },
]

export function draftWizardAdpSetId(teams, scoring = 'half') {
  return scoring === 'half' ? `draftwizard-adp-${teams}` : `draftwizard-adp-${scoring}-${teams}`
}

export function draftWizardAdpUrl(teams, scoring = 'half') {
  return `${ORIGIN}/football/adp/mock-drafts/overall/default-${scoring}-${teams}-teams`
}

/**
 * Draft Wizard prints ADP as round.pick (1.01, 9.07, 12.00). 12.00 means
 * the start of that round — the hundredths slot is missing, not pick 0.
 */
export function overallPickFromRoundPick(value, teams) {
  if (!(value > 0) || !(teams > 0)) return null
  const round = Math.floor(value)
  let slot = Math.round((value - round) * 100)
  if (slot <= 0) slot = 1
  if (slot > teams) slot = teams
  return (round - 1) * teams + slot
}

function cellText(html) {
  return clean(String(html ?? '').replace(/<[^>]*>/g, ' '))
}

function formatFor(scoring) {
  return LIVE_ADP_FORMATS.find((format) => format.slug === scoring || format.scoring === scoring) ?? LIVE_ADP_FORMATS[0]
}

export function parseDraftWizardAdp(html, teams) {
  const table = String(html ?? '').split('id="adpTable"')[1]
  if (!table) return []
  const body = table.split(/<tbody[^>]*>/i)[1]
  if (!body) return []

  return body.split('<tr').slice(1).flatMap((block) => {
    const cells = [...block.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1])
    if (cells.length < 5) return []
    const nameMatch = String(cells[2] ?? '').match(/\/nfl\/players\/([^"/]+)\.php"[^>]*>([^<]+)/)
    const playerName = clean(nameMatch?.[2])
    if (!playerName) return []
    const position = normalizePos(cellText(cells[0]).replace(/\d+/g, ''))
    const team = normalizeTeam(cellText(cells[3]).replace(/\(\d+\)/g, ''))
    const overallRank = toNumber(cells[1])
    const avgPick = toNumber(cells[4])
    const adp = overallPickFromRoundPick(avgPick, teams) ?? overallRank
    if (adp == null || adp <= 0) return []
    return [{
      name: playerName,
      team,
      position,
      overall: overallRank ?? adp,
      adp,
      best: overallPickFromRoundPick(toNumber(cells[5]), teams),
      worst: overallPickFromRoundPick(toNumber(cells[6]), teams),
      average: adp,
      stdDev: toNumber(cells[7]),
      tier: null,
      positionRank: cellText(cells[0]) || null,
      byeWeek: toNumber((cellText(cells[3]).match(/\((\d+)\)/) ?? [])[1]),
      fantasyProsSlug: nameMatch?.[1] ?? undefined,
    }]
  })
}

async function collectBoard(teams, format, options) {
  const sourceUrl = draftWizardAdpUrl(teams, format.slug)
  const verdict = await guard(sourceUrl, options)
  if (!verdict.allowed) throw new Error(`robots.txt disallows ${new URL(sourceUrl).pathname} (${verdict.reason})`)

  const { text } = await fetchText(sourceUrl, { onRetry: options.onRetry })
  const rows = parseDraftWizardAdp(text, teams)
  if (rows.length < format.minRows) {
    throw new Error(`only ${rows.length} rows parsed from ${teams}-team ${format.label} Draft Wizard ADP`)
  }

  return {
    id: draftWizardAdpSetId(teams, format.slug),
    label: format.slug === 'half'
      ? `Draft Wizard ADP (${teams}-team)`
      : `Draft Wizard ADP (${teams}-team ${format.label})`,
    scoring: format.scoring,
    sourceUrl,
    fetchedAt: Date.now(),
    meta: { teams, scoring: format.slug, format: format.slug === 'rookie' ? 'rookie' : `redraft-${format.slug}`, count: rows.length },
    rows,
  }
}

export function draftWizardAdpTasks(options = {}) {
  return LIVE_ADP_TEAM_COUNTS.flatMap((teams) => LIVE_ADP_FORMATS.map((format) => ({
    id: draftWizardAdpSetId(teams, format.slug),
    run: () => collectBoard(teams, format, options),
  })))
}

export const __test__ = {
  LIVE_ADP_TEAM_COUNTS,
  LIVE_ADP_FORMATS,
  draftWizardAdpSetId,
  draftWizardAdpUrl,
  overallPickFromRoundPick,
  parseDraftWizardAdp,
  formatFor,
}
