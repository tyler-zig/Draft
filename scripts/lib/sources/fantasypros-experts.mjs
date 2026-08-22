/**
 * FantasyPros individual expert boards.
 *
 * The consensus adapter (fantasypros.mjs) collapses ~100 analysts into one ECR
 * number plus a spread. This one takes the analysts themselves: every expert
 * who publishes a draft board gets their own ranking, plus the deviation from
 * consensus that FantasyPros already computes per row.
 *
 * All of this lives under /nfl/rankings/, which robots.txt permits. (The
 * /nfl/ranker/ tool is disallowed and is not used.) FantasyPros publishes
 * Crawl-delay: 5, and 87 experts x 3 formats is 261 pages, so a full sweep is
 * roughly 22 minutes. Collection is therefore incremental: boards fetched
 * inside `maxAgeMs` are reused from the previous snapshot.
 */

import * as cheerio from 'cheerio'

import { fetchText, guard } from '../http.mjs'
import { clean, normalizePos, normalizeTeam, toNumber } from '../text.mjs'

const ORIGIN = 'https://www.fantasypros.com'
const DIRECTORY = `${ORIGIN}/nfl/rankings/`

/** app ScoringType -> FantasyPros `scoring` parameter. */
export const SCORING = {
  ppr: 'PPR',
  half: 'HALF',
  standard: 'STD',
}

/**
 * The directory links every expert. Those publishing their own board carry a
 * `?type=draft` link; the rest only have `-consensus-rankings` variants and are
 * skipped, since they have no ranking of their own to collect.
 */
export async function fetchExpertDirectory(options = {}) {
  const verdict = await guard(DIRECTORY, options)
  if (!verdict.allowed) throw new Error(`robots.txt disallows the rankings directory (${verdict.reason})`)

  const { text } = await fetchText(DIRECTORY, { onRetry: options.onRetry })
  const $ = cheerio.load(text)
  const slugs = new Map()

  $('a').each((_i, a) => {
    const href = $(a).attr('href') ?? ''
    const match = href.match(/^\/nfl\/rankings\/([a-z0-9-]+)\.php\?type=draft/)
    if (!match) return
    const slug = match[1]
    if (slugs.has(slug)) return
    const label = clean($(a).text()).replace(/^View rankings for\s*/i, '')
    slugs.set(slug, label)
  })

  if (slugs.size < 10) {
    throw new Error(`only ${slugs.size} experts found; directory layout may have changed`)
  }
  return [...slugs].map(([slug, label]) => ({ slug, label }))
}

/**
 * "Jason Willan (Gridiron Experts) | Fantasy Football PPR Rankings | ..."
 *
 * Returns null when the title is not an expert page. That is the signal that
 * FantasyPros redirected us to the generic consensus board, which it does when
 * an expert has no ranking for the requested scoring format. Without this
 * check a redirect would be recorded as that expert's personal ranking.
 */
function identityFromTitle(title) {
  const match = clean(title).match(/^(.*?)\s*\((.*?)\)\s*\|/)
  if (!match) return null
  return { name: clean(match[1]), outlet: clean(match[2]) }
}

function positionFrom(posRank) {
  const match = clean(posRank).match(/^([A-Za-z/]+)/)
  return normalizePos(match ? match[1] : null)
}

export function parseExpertBoard(html) {
  const $ = cheerio.load(html)
  const rows = []

  $('table#data tbody tr').each((_i, tr) => {
    const cells = $(tr).find('td')
    if (cells.length < 6) return

    const rank = toNumber($(cells[0]).text())
    const link = $(cells[1]).find('a.fp-player-link').first()
    const idClass = (link.attr('class') ?? '').match(/fp-id-(\d+)/)
    const name = clean(link.text()) || clean($(cells[1]).text())
    if (!rank || !name) return

    rows.push({
      overall: rank,
      name,
      position: positionFrom($(cells[2]).text()),
      team: normalizeTeam($(cells[3]).text()),
      byeWeek: toNumber($(cells[4]).text()),
      // FantasyPros computes these per row: the consensus rank, and how far
      // this expert sits from it. The delta is the whole point of the dataset.
      ecr: toNumber($(cells[5]).text()),
      vsEcr: toNumber($(cells[6]).text()),
      adp: toNumber($(cells[7]).text()),
      vsAdp: toNumber($(cells[8]).text()),
      fantasyProsId: idClass ? idClass[1] : undefined,
    })
  })

  return rows
}

export async function collectExpert(slug, scoring, options = {}) {
  const param = SCORING[scoring]
  if (!param) throw new Error(`unknown scoring "${scoring}"`)
  const url = `${ORIGIN}/nfl/rankings/${slug}.php?type=draft&scoring=${param}`

  const verdict = await guard(url, options)
  if (!verdict.allowed) throw new Error(`robots.txt disallows ${slug} (${verdict.reason})`)

  const { text } = await fetchText(url, { onRetry: options.onRetry })
  const identity = identityFromTitle((text.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? '')
  const rows = parseExpertBoard(text)

  // Not every expert ranks every scoring format. Those pages either serve an
  // empty table or redirect to the consensus board -- both are a normal gap in
  // coverage, not a failure, and must not be recorded as this expert's ranking.
  if (!identity || rows.length === 0) {
    return { slug, scoring, notPublished: true }
  }

  // A board that exists but is unexpectedly thin is a different matter: that
  // looks like the markup moved, and should be loud.
  if (rows.length < 25) {
    throw new Error(`only ${rows.length} rows for ${slug}; page layout may have changed`)
  }

  return {
    slug,
    name: identity.name,
    outlet: identity.outlet,
    scoring,
    sourceUrl: url,
    fetchedAt: Date.now(),
    rows,
  }
}
