/**
 * Client for the dev-server collector endpoint (scripts/vite-scraper-plugin.mjs).
 *
 * The endpoint only exists under `vite dev` / `vite preview`. In a static
 * build the requests fall through to index.html, so a non-JSON response is
 * read as "no collector available here" rather than an error.
 */

export type SourceGroup = 'rotowire' | 'fantasypros' | 'fantasypros-adp' | 'espn'

export const SOURCE_GROUPS: { id: SourceGroup; label: string; detail: string }[] = [
  { id: 'fantasypros', label: 'FantasyPros', detail: '~1,900 rows · 3 boards · ~100 experts' },
  { id: 'fantasypros-adp', label: 'Real-Time ADP', detail: '5 RT formats + Draft Wizard 8/10/12/14/16 × half/ppr/std/rookie' },
  { id: 'rotowire', label: 'RotoWire', detail: '~700 rows · ~70 boards · ADP' },
  { id: 'espn', label: 'ESPN crosswalk', detail: '~4,500 player IDs · improves matching' },
]

export interface ScrapeOptions {
  only: SourceGroup[]
  concurrency: number
  ignoreRobots: boolean
}

export interface ScrapeResult {
  sets: number
  rows: number
  players: number
  espnIdsAttached: number
  failures: { source: string; error: string }[]
  skipped: { source: string; reason: string }[]
}

export interface ScrapeStatus {
  running: boolean
  /**
   * Which half of the run is going. Collecting writes public/; publishing
   * pushes those files to Supabase, which is where the app actually reads
   * them -- so a run is not finished, or usable, until both are done.
   */
  phase: 'collecting' | 'publishing' | null
  startedAt: number | null
  finishedAt: number | null
  exitCode: number | null
  log: { at: number; text: string }[]
  result: ScrapeResult | null
  error: string | null
  /** False when the push failed; null when Supabase is not configured here. */
  published: boolean | null
}

export class NoCollectorError extends Error {
  constructor() {
    super('The collector runs on the dev server, which is not attached to this build.')
    this.name = 'NoCollectorError'
  }
}

async function readJson(response: Response) {
  // A static build serves index.html for unknown paths; that is a missing
  // collector, not a malformed reply.
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new NoCollectorError()
  }
  return response.json()
}

export async function getScrapeStatus(signal?: AbortSignal): Promise<ScrapeStatus> {
  let response: Response
  try {
    response = await fetch('/api/scrape/status', { signal })
  } catch {
    throw new NoCollectorError()
  }
  if (response.status === 404) throw new NoCollectorError()
  return (await readJson(response)) as ScrapeStatus
}

export async function startScrape(options: ScrapeOptions): Promise<ScrapeStatus> {
  const response = await fetch('/api/scrape/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(options),
  })
  if (response.status === 404) throw new NoCollectorError()
  const data = await readJson(response)
  if (!response.ok) throw new Error((data as { error?: string }).error ?? 'Collection failed to start.')
  return data as ScrapeStatus
}
