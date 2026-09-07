export type SleeperRef =
  | { kind: 'draft'; id: string }
  | { kind: 'league'; id: string }

const DRAFT_PATH = /\/(?:beta\/)?draft\/(?:nfl\/)?(\d{6,})/i
const LEAGUE_PATH = /\/leagues\/(\d{6,})/i
const SNOWFLAKE = /^\d{6,}$/

/**
 * Accepts a Sleeper mock/live draft URL, a league predraft URL, or a raw
 * draft id. Bare snowflakes are treated as draft ids -- that is what the
 * `/beta/draft/nfl/{id}` mock lobby copies.
 */
export function parseSleeperRef(raw: string): SleeperRef | null {
  const value = raw.trim()
  if (!value) return null
  if (SNOWFLAKE.test(value)) return { kind: 'draft', id: value }

  const path = (() => {
    try {
      const url = new URL(value.includes('://') ? value : `https://${value}`)
      return `${url.pathname}${url.search}`
    } catch {
      return value
    }
  })()

  const draft = path.match(DRAFT_PATH)
  if (draft?.[1]) return { kind: 'draft', id: draft[1] }
  const league = path.match(LEAGUE_PATH)
  if (league?.[1]) return { kind: 'league', id: league[1] }
  return null
}
